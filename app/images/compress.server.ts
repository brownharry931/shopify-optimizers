import sharp from "sharp";
import {
  MIN_SAVING_RATIO,
  minPsnrFor,
  type MaxDimension,
  type QualityLevel,
  type SupportedMime,
} from "./compress-options";

// Keep memory predictable on small servers.
sharp.concurrency(1);
sharp.cache(false);

const MAX_INPUT_BYTES = 25 * 1024 * 1024;

const SETTINGS: Record<QualityLevel, { jpeg: number; webp: number; pngPalette: boolean; pngQuality: number }> = {
  maximum: { jpeg: 90, webp: 90, pngPalette: false, pngQuality: 100 },
  balanced: { jpeg: 82, webp: 82, pngPalette: false, pngQuality: 100 },
  small: { jpeg: 74, webp: 74, pngPalette: true, pngQuality: 85 },
};

export type CompressionResult = {
  buffer: Buffer;
  bytes: number;
  originalBytes: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  psnr: number | null;
  accepted: boolean;
  reason: string | null;
};

/** PSNR between two images, compared at the same (reduced) size in RGB. */
export async function psnr(a: Buffer, b: Buffer, size = 512) {
  const prepare = (input: Buffer) =>
    sharp(input)
      .rotate()
      .resize(size, size, { fit: "fill" })
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .raw()
      .toBuffer();
  const [left, right] = await Promise.all([prepare(a), prepare(b)]);
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) {
    const diff = left[i] - right[i];
    sum += diff * diff;
  }
  const mse = sum / left.length;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/**
 * Re-encode an image in the same format (Shopify requires the file extension
 * to stay the same) with high-quality encoders, optionally capping its
 * longest side. Rejects results that save too little or fall below the
 * quality threshold for the chosen level.
 */
export async function compressImage(
  input: Buffer,
  mimeType: SupportedMime,
  level: QualityLevel,
  maxDimension: MaxDimension,
): Promise<CompressionResult> {
  if (input.length > MAX_INPUT_BYTES) throw new Error("Images over 25 MB can't be compressed here.");
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error("The image dimensions couldn't be read.");
  if ((meta.pages ?? 1) > 1) throw new Error("Animated images are skipped to keep their animation.");

  const settings = SETTINGS[level];
  let pipeline = sharp(input, { failOn: "error" }).rotate().keepIccProfile();
  if (maxDimension && Math.max(meta.width, meta.height) > maxDimension) {
    pipeline = pipeline.resize(maxDimension, maxDimension, { fit: "inside", withoutEnlargement: true });
  }
  if (mimeType === "image/jpeg") {
    pipeline = pipeline.jpeg({ quality: settings.jpeg, mozjpeg: true, progressive: true, chromaSubsampling: level === "maximum" ? "4:4:4" : "4:2:0" });
  } else if (mimeType === "image/png") {
    pipeline = settings.pngPalette
      ? pipeline.png({ palette: true, quality: settings.pngQuality, effort: 10, compressionLevel: 9 })
      : pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 });
  } else {
    pipeline = pipeline.webp({ quality: settings.webp, effort: 6, smartSubsample: true });
  }
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  // Compare at the original aspect ratio; a resize is not a quality loss.
  const quality = await psnr(input, data);
  const saving = 1 - data.length / input.length;
  let reason: string | null = null;
  if (saving < MIN_SAVING_RATIO) {
    reason = "Already well optimized — compressing would save less than 5%.";
  } else if (quality < minPsnrFor(level)) {
    reason = "Skipped to protect quality: the compressed version would look different. Try “Maximum quality”.";
  }
  return {
    buffer: data,
    bytes: data.length,
    originalBytes: input.length,
    width: info.width,
    height: info.height,
    originalWidth: meta.width,
    originalHeight: meta.height,
    psnr: Number.isFinite(quality) ? Math.round(quality * 10) / 10 : null,
    accepted: reason === null,
    reason,
  };
}

/** Before/after previews: a scaled full view and a 1:1 crop from the centre. */
export async function previewPair(original: Buffer, compressed: Buffer) {
  const meta = await sharp(compressed).metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const crop = {
    width: Math.min(560, width),
    height: Math.min(380, height),
    left: Math.max(0, Math.round(width / 2 - Math.min(560, width) / 2)),
    top: Math.max(0, Math.round(height / 2 - Math.min(380, height) / 2)),
  };
  // Previews are WebP: near-lossless for the scaled view and fully lossless
  // for the 1:1 crop, so the crop shows the real compression result.
  const view = (input: Buffer, mode: "full" | "crop") => {
    let pipeline = sharp(input).rotate().resize(width, height, { fit: "fill" });
    pipeline =
      mode === "crop"
        ? pipeline.extract(crop).webp({ lossless: true, effort: 2 })
        : pipeline.resize(900, 900, { fit: "inside", withoutEnlargement: true }).webp({ quality: 92, effort: 2 });
    return pipeline.toBuffer().then((buffer) => `data:image/webp;base64,${buffer.toString("base64")}`);
  };
  const [beforeFull, afterFull, beforeCrop, afterCrop] = await Promise.all([
    view(original, "full"),
    view(compressed, "full"),
    view(original, "crop"),
    view(compressed, "crop"),
  ]);
  return { beforeFull, afterFull, beforeCrop, afterCrop };
}
