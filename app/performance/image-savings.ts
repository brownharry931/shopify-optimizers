/**
 * Pure helpers for measuring real before/after image delivery on Shopify's
 * image CDN. No network access here; see image-savings.server.ts.
 */

export type SniffedImage = {
  format: "png" | "jpeg" | "gif" | "webp";
  width: number;
  height: number;
};

/** Read pixel dimensions from the first bytes of PNG, JPEG, GIF or WebP. */
export function sniffImageSize(bytes: Uint8Array): SniffedImage | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (offset: number) => (offset < bytes.length ? bytes[offset] : -1);

  // PNG: 89 50 4E 47, IHDR width/height big-endian at 16/20.
  if (bytes.length >= 24 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return { format: "png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF: "GIF8", little-endian logical screen size at 6/8.
  if (bytes.length >= 10 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) {
    return { format: "gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 30 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    const chunk = String.fromCharCode(at(12), at(13), at(14), at(15));
    if (chunk === "VP8X") {
      const width = 1 + (at(24) | (at(25) << 8) | (at(26) << 16));
      const height = 1 + (at(27) | (at(28) << 8) | (at(29) << 16));
      return { format: "webp", width, height };
    }
    if (chunk === "VP8 ") {
      return {
        format: "webp",
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === "VP8L") {
      const b0 = at(21), b1 = at(22), b2 = at(23), b3 = at(24);
      return {
        format: "webp",
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    return null;
  }
  // JPEG: walk segments to the first SOFn marker.
  if (bytes.length >= 4 && at(0) === 0xff && at(1) === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (at(offset) !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = at(offset + 1);
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      const length = view.getUint16(offset + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return {
          format: "jpeg",
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      }
      if (length < 2) return null;
      offset += 2 + length;
    }
  }
  return null;
}

/**
 * Only Shopify-hosted image CDN URLs are fetched: cdn.shopify.com/s/files/…
 * or the store's own /cdn/shop/… path. Everything else is skipped (SSRF-safe).
 */
export function isShopifyCdnImage(rawUrl: string, storefrontHosts: string[]) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === "cdn.shopify.com") return url.pathname.startsWith("/s/files/");
  return (
    storefrontHosts.includes(host) && url.pathname.startsWith("/cdn/shop/")
  );
}

export function requestedWidth(rawUrl: string) {
  const width = Number(new URL(rawUrl).searchParams.get("width"));
  return Number.isInteger(width) && width > 0 ? width : null;
}

/**
 * Width that removes Lighthouse's measured oversize. Lighthouse reports
 * wastedPercent = 1 − displayedArea / naturalArea, so the side scale is
 * √(1 − wasted).
 */
export function targetWidthFor(naturalWidth: number, wastedPercent: number | null) {
  if (!wastedPercent || wastedPercent <= 0) return naturalWidth;
  const scale = Math.sqrt(Math.max(0, 1 - wastedPercent / 100));
  const target = Math.ceil((naturalWidth * scale) / 10) * 10;
  return Math.max(64, Math.min(naturalWidth, target));
}

export function variantUrl(rawUrl: string, width: number) {
  const url = new URL(rawUrl);
  const oldWidth = Number(url.searchParams.get("width"));
  const oldHeight = Number(url.searchParams.get("height"));
  url.searchParams.set("width", String(width));
  if (oldHeight > 0 && oldWidth > 0) {
    url.searchParams.set("height", String(Math.round((oldHeight * width) / oldWidth)));
  } else {
    url.searchParams.delete("height");
  }
  return url.toString();
}

export type ImageSaving = {
  url: string;
  status: "optimized" | "already-optimal" | "skipped";
  reason: string | null;
  beforeBytes: number | null;
  beforeWidth: number | null;
  beforeFormat: string | null;
  afterUrl: string | null;
  afterBytes: number | null;
  afterWidth: number | null;
  afterFormat: string | null;
  lighthouseBytes: number | null;
  lighthouseWastedBytes: number | null;
};

export function formatFromContentType(value: string | null) {
  const type = (value ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) return null;
  return type.slice("image/".length).replace("jpg", "jpeg").toUpperCase();
}
