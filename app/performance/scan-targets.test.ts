import assert from "node:assert/strict";
import test from "node:test";
import { selectCruxFieldData } from "./field-data";
import {
  buildTargetUrl,
  normalizeTargetPath,
  parseStrategies,
} from "./scan-targets";

test("normalizes supported Shopify storefront page templates", () => {
  assert.deepEqual(normalizeTargetPath("/"), {
    targetPath: "/",
    template: "home",
  });
  assert.deepEqual(normalizeTargetPath("/products/linen-shirt"), {
    targetPath: "/products/linen-shirt",
    template: "product",
  });
  assert.deepEqual(normalizeTargetPath("/collections/summer"), {
    targetPath: "/collections/summer",
    template: "collection",
  });
  assert.deepEqual(normalizeTargetPath("/pages/shipping"), {
    targetPath: "/pages/shipping",
    template: "page",
  });
  assert.deepEqual(normalizeTargetPath("/blogs/news/store-update"), {
    targetPath: "/blogs/news/store-update",
    template: "blog",
  });
});

test("rejects external URLs, open redirects, queries, fragments, and traversal", () => {
  for (const input of [
    "https://attacker.example/",
    "//attacker.example/products/x",
    "/products/x?email=customer@example.com",
    "/products/x#reviews",
    "/products/%2f%2fevil",
    "/products/../account",
    "/cart",
    "/products/handle\\\\@attacker.example",
  ]) {
    assert.throws(() => normalizeTargetPath(input), input);
  }
});

test("limits the path length and accepts only supported Shopify route shapes", () => {
  assert.throws(() => normalizeTargetPath(`/${"a".repeat(251)}`), /path/i);
  assert.throws(() => normalizeTargetPath("/blogs/one"), /Supported targets/);
  assert.throws(
    () => normalizeTargetPath("/collections/a/b"),
    /Supported targets/,
  );
});

test("builds target URLs only from clean HTTPS origins", () => {
  assert.equal(
    buildTargetUrl("https://shop.example", "/products/linen-shirt"),
    "https://shop.example/products/linen-shirt",
  );
  for (const origin of [
    "http://shop.example",
    "https://user:pass@shop.example",
    "https://shop.example:8443",
    "https://shop.example/store",
    "https://shop.example/?token=x",
  ]) {
    assert.throws(() => buildTargetUrl(origin, "/"));
  }
});

test("accepts only supported device strategy choices", () => {
  assert.deepEqual(parseStrategies("mobile"), ["mobile"]);
  assert.deepEqual(parseStrategies("desktop"), ["desktop"]);
  assert.deepEqual(parseStrategies("both"), ["mobile", "desktop"]);
  assert.throws(() => parseStrategies("tablet"), /Select mobile/);
});

test("prefers page-level CrUX data and scales its CLS percentile", () => {
  const field = selectCruxFieldData(
    {
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2400, category: "FAST" },
        INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: "FAST" },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12, category: "AVERAGE" },
      },
    },
    {
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4000, category: "SLOW" },
      },
    },
  );
  assert.equal(field?.source, "URL");
  assert.equal(field?.metrics.lcpP75Ms, 2400);
  assert.equal(field?.metrics.inpP75Ms, 180);
  assert.equal(field?.metrics.clsP75, 0.12);
  assert.equal(field?.metrics.clsCategory, "AVERAGE");
});

test("uses origin CrUX data only as an explicitly labeled fallback", () => {
  const field = selectCruxFieldData(undefined, {
    metrics: {
      FIRST_CONTENTFUL_PAINT_MS: { percentile: 1700, category: "AVERAGE" },
      EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 600, category: "SLOW" },
    },
  });
  assert.equal(field?.source, "ORIGIN");
  assert.equal(field?.metrics.fcpP75Ms, 1700);
  assert.equal(field?.metrics.ttfbP75Ms, 600);
});

test("does not invent field data when the provider has no qualifying samples", () => {
  assert.equal(selectCruxFieldData(undefined, undefined), null);
  assert.equal(selectCruxFieldData({ metrics: {} }, { metrics: {} }), null);
  assert.equal(
    selectCruxFieldData(
      {
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: {
            percentile: Number.NaN,
            category: "NONE",
          },
        },
      },
      undefined,
    ),
    null,
  );
});
