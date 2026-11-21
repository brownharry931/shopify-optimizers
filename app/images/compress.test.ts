import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { compressImage } from "./compress.server";
import { filenameFromUrl, parseMaxDimension, parseQuality, qualityVerdict } from "./compress-options";

// A photo-like test image: smooth gradients plus noise, saved at JPEG q98.
async function photo(width = 1600, height = 1000) {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      const noise = ((x * 7919 + y * 104729) % 23) - 11;
      raw[i] = Math.max(0, Math.min(255, (x / width) * 255 + noise));
      raw[i + 1] = Math.max(0, Math.min(255, (y / height) * 255 + noise));
      raw[i + 2] = Math.max(0, Math.min(255, 128 + 60 * Math.sin(x / 40) + noise));
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).jpeg({ quality: 98 }).toBuffer();
}

test("compresses a heavy JPEG while keeping quality above the threshold", async () => {
  const input = await photo();
  const result = await compressImage(input, "image/jpeg", "balanced", 0);
  assert.equal(result.accepted, true);
  assert.ok(result.bytes < input.length * 0.8, "at least 20% smaller");
  assert.ok((result.psnr ?? 99) >= 38);
  assert.equal(result.width, 1600);
  assert.equal(result.height, 1000);
});

test("PNG at balanced is lossless", async () => {
  // Graphics-style PNG (flat areas), stored without compression.
  const width = 600;
  const height = 400;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 1) raw[i] = Math.floor(i / 9000) % 256;
  const input = await sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  const result = await compressImage(input, "image/png", "balanced", 0);
  assert.equal(result.accepted, true);
  assert.equal(result.psnr, null); // identical pixels → infinite PSNR
});

test("resizing caps the longest side and never enlarges", async () => {
  const input = await photo(3200, 1200);
  const capped = await compressImage(input, "image/jpeg", "balanced", 2048);
  assert.equal(capped.width, 2048);
  assert.equal(capped.height, 768);
  const small = await photo(800, 600);
  const untouched = await compressImage(small, "image/jpeg", "balanced", 2048);
  assert.equal(untouched.width, 800);
});

test("an already-optimized file is not replaced", async () => {
  const input = await sharp(await photo(800, 600)).jpeg({ quality: 60, mozjpeg: true }).toBuffer();
  const result = await compressImage(input, "image/jpeg", "maximum", 0);
  assert.equal(result.accepted, false);
  assert.match(result.reason ?? "", /less than 5%|protect quality/);
});

test("option parsing and labels", () => {
  assert.equal(parseQuality("small"), "small");
  assert.equal(parseQuality("nonsense"), "balanced");
  assert.equal(parseMaxDimension("2048"), 2048);
  assert.equal(parseMaxDimension("999"), 0);
  assert.equal(qualityVerdict(45), "Visually identical");
  assert.equal(qualityVerdict(36), "Very good");
  assert.equal(filenameFromUrl("https://cdn.shopify.com/s/files/1/2/files/My%20Photo.jpg?v=1"), "My Photo.jpg");
});
