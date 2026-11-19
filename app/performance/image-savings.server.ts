import type { ReportImage } from "./lighthouse-report";
import {
  formatFromContentType,
  isShopifyCdnImage,
  requestedWidth,
  sniffImageSize,
  targetWidthFor,
  variantUrl,
  type ImageSaving,
} from "./image-savings";

// Same Accept header Chrome (and therefore Lighthouse) sends for images, so
// Shopify's CDN negotiates the format a real visitor receives.
const CHROME_IMAGE_ACCEPT =
  "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
// A non-AVIF Accept lets us read dimensions from the image header.
const SNIFF_ACCEPT = "image/webp,image/png,image/jpeg,image/gif;q=0.9";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES = 8;

type Fetched = { bytes: number; contentType: string | null; head: Uint8Array };

async function fetchImage(url: string, accept: string, headOnly = false): Promise<Fetched> {
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "SpeedBoost image audit" },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("Image is too large to measure");
    }
    if (headOnly && total >= 64 * 1024) {
      await reader.cancel();
      break;
    }
  }
  const head = new Uint8Array(Math.min(total, 64 * 1024));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= head.length) break;
    const slice = chunk.subarray(0, head.length - offset);
    head.set(slice, offset);
    offset += slice.length;
  }
  return { bytes: total, contentType: response.headers.get("content-type"), head };
}

async function measureOne(image: ReportImage, hosts: string[]): Promise<ImageSaving> {
  const base: ImageSaving = {
    url: image.url,
    status: "skipped",
    reason: null,
    beforeBytes: null,
    beforeWidth: null,
    beforeFormat: null,
    afterUrl: null,
    afterBytes: null,
    afterWidth: null,
    afterFormat: null,
    lighthouseBytes: image.totalBytes,
    lighthouseWastedBytes: image.wastedBytes,
  };
  if (!isShopifyCdnImage(image.url, hosts)) {
    return {
      ...base,
      reason: "Hosted outside Shopify's image CDN, so a resized variant cannot be requested.",
    };
  }
  try {
    const before = await fetchImage(image.url, CHROME_IMAGE_ACCEPT);
    let naturalWidth = requestedWidth(image.url);
    if (!naturalWidth) {
      const sniffSource = await fetchImage(image.url, SNIFF_ACCEPT, true);
      naturalWidth = sniffImageSize(sniffSource.head)?.width ?? null;
    }
    if (!naturalWidth) {
      return { ...base, beforeBytes: before.bytes, beforeFormat: formatFromContentType(before.contentType), reason: "Image dimensions could not be read." };
    }
    const responsiveWaste = image.sources.includes("uses-responsive-images") || image.sources.includes("image-delivery-insight")
      ? image.wastedPercent
      : null;
    const width = targetWidthFor(naturalWidth, responsiveWaste);
    const afterUrl = variantUrl(image.url, width);
    const after = await fetchImage(afterUrl, CHROME_IMAGE_ACCEPT);
    const optimized = after.bytes < before.bytes * 0.97;
    return {
      ...base,
      status: optimized ? "optimized" : "already-optimal",
      reason: optimized ? null : "Shopify's CDN is already serving a right-sized modern format.",
      beforeBytes: before.bytes,
      beforeWidth: naturalWidth,
      beforeFormat: formatFromContentType(before.contentType),
      afterUrl,
      afterBytes: after.bytes,
      afterWidth: width,
      afterFormat: formatFromContentType(after.contentType),
    };
  } catch (error) {
    return {
      ...base,
      reason: `Could not measure this image (${error instanceof Error ? error.message : "network error"}).`,
    };
  }
}

/** Measure real bytes for the flagged images and a right-sized CDN variant. */
export async function measureImageSavings(images: ReportImage[], storefrontHosts: string[]) {
  const hosts = storefrontHosts.map((host) => host.toLowerCase());
  const queue = images.slice(0, MAX_IMAGES);
  const results: ImageSaving[] = new Array(queue.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (next < queue.length) {
        const index = next++;
        results[index] = await measureOne(queue[index], hosts);
      }
    }),
  );
  return results;
}
