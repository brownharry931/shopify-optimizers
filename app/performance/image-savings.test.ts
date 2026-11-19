import assert from "node:assert/strict";
import test from "node:test";
import {
  isShopifyCdnImage,
  sniffImageSize,
  targetWidthFor,
  variantUrl,
} from "./image-savings";

test("reads PNG, GIF, JPEG and WebP dimensions", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, 1200);
  new DataView(png.buffer).setUint32(20, 800);
  assert.deepEqual(sniffImageSize(png), { format: "png", width: 1200, height: 800 });

  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
  assert.deepEqual(sniffImageSize(gif), { format: "gif", width: 320, height: 240 });

  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03,
  ]);
  assert.deepEqual(sniffImageSize(jpeg), { format: "jpeg", width: 800, height: 600 });

  const webp = new Uint8Array(30);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  webp.set([0xff, 0x03, 0x00, 0x57, 0x02, 0x00], 24); // 1024 × 600
  assert.deepEqual(sniffImageSize(webp), { format: "webp", width: 1024, height: 600 });

  assert.equal(sniffImageSize(new Uint8Array([1, 2, 3])), null);
});

test("only Shopify CDN image URLs are fetched", () => {
  const hosts = ["shop.example", "demo.myshopify.com"];
  assert.equal(isShopifyCdnImage("https://cdn.shopify.com/s/files/1/a.jpg", hosts), true);
  assert.equal(isShopifyCdnImage("https://shop.example/cdn/shop/files/a.jpg?v=1", hosts), true);
  assert.equal(isShopifyCdnImage("https://shop.example/admin/a.jpg", hosts), false);
  assert.equal(isShopifyCdnImage("https://cdn.shopify.com/other/a.jpg", hosts), false);
  assert.equal(isShopifyCdnImage("https://evil.example/cdn/shop/a.jpg", hosts), false);
  assert.equal(isShopifyCdnImage("http://cdn.shopify.com/s/files/a.jpg", hosts), false);
  assert.equal(isShopifyCdnImage("https://cdn.shopify.com:8443/s/files/a.jpg", hosts), false);
});

test("target width removes Lighthouse's measured oversize", () => {
  // 75% wasted area → half the side length.
  assert.equal(targetWidthFor(2000, 75), 1000);
  assert.equal(targetWidthFor(2000, null), 2000);
  assert.equal(targetWidthFor(100, 99.9), 64);
});

test("variant URLs keep other parameters and scale height", () => {
  const url = new URL(variantUrl("https://cdn.shopify.com/s/files/a.jpg?v=9&width=2000&height=1000", 500));
  assert.equal(url.searchParams.get("v"), "9");
  assert.equal(url.searchParams.get("width"), "500");
  assert.equal(url.searchParams.get("height"), "250");
});
