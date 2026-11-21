/**
 * Image compressor options shared by server and browser. Pure module.
 */

export type QualityLevel = "maximum" | "balanced" | "small";
export type MaxDimension = 0 | 3000 | 2400 | 2048;

export const QUALITY_LEVELS: Array<{
  id: QualityLevel;
  label: string;
  description: string;
  /** Minimum PSNR (dB) the result must reach, otherwise it is rejected. */
  minPsnr: number;
}> = [
  {
    id: "maximum",
    label: "Maximum quality",
    description: "Visually identical. Smaller savings.",
    minPsnr: 42,
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Recommended. No visible difference for shoppers.",
    minPsnr: 38,
  },
  {
    id: "small",
    label: "Smallest files",
    description: "Biggest savings. Fine detail may soften slightly.",
    minPsnr: 34,
  },
];

export const MAX_DIMENSIONS: Array<{ value: MaxDimension; label: string }> = [
  { value: 0, label: "Keep original size" },
  { value: 3000, label: "Max 3000 px" },
  { value: 2400, label: "Max 2400 px" },
  { value: 2048, label: "Max 2048 px" },
];

export const SUPPORTED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportedMime = (typeof SUPPORTED_MIME)[number];

/** Minimum saving before a compressed file replaces the original. */
export const MIN_SAVING_RATIO = 0.05;

export function parseQuality(value: unknown): QualityLevel {
  return value === "maximum" || value === "small" ? value : "balanced";
}

export function parseMaxDimension(value: unknown): MaxDimension {
  const number = Number(value);
  return number === 3000 || number === 2400 || number === 2048 ? number : 0;
}

export function minPsnrFor(level: QualityLevel) {
  return QUALITY_LEVELS.find((item) => item.id === level)!.minPsnr;
}

/** Merchant-facing label for a PSNR value. */
export function qualityVerdict(psnr: number | null) {
  if (psnr === null || !Number.isFinite(psnr)) return "Identical";
  if (psnr >= 42) return "Visually identical";
  if (psnr >= 38) return "Excellent";
  if (psnr >= 34) return "Very good";
  return "Noticeable change";
}

/** Filename (with extension) from a Shopify CDN URL. */
export function filenameFromUrl(url: string) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image");
    return name.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "image";
  } catch {
    return "image";
  }
}
