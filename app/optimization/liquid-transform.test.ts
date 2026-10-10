import assert from "node:assert/strict";
import test from "node:test";
import {
  deferCompatibleThemeScripts,
  inspectShopifyImageTags,
  optimizeShopifyImageTags,
} from "./liquid-transform.server";

test("defers only compatible local theme scripts while preserving script order", () => {
  const source = `
{{ 'theme.js' | asset_url | script_tag }}
<script src="{{ 'cart.js' | asset_url }}"></script>
<script async src="{{ 'analytics.js' | asset_url }}"></script>
<script type="module" src="{{ 'module.js' | asset_url }}"></script>
<script src="https://cdn.example.test/vendor.js"></script>
<script src="{{ 'inline.js' | asset_url }}">window.init();</script>
<!-- <script src="{{ 'commented.js' | asset_url }}"></script> -->
`;
  const result = deferCompatibleThemeScripts(source);

  assert.equal(result.changedCount, 2);
  assert.match(result.code, /<script defer src="\{\{ 'theme\.js' \| asset_url \}\}"><\/script>/);
  assert.match(result.code, /<script src="\{\{ 'cart\.js' \| asset_url \}\}" defer><\/script>/);
  assert.match(result.code, /<script async src="\{\{ 'analytics\.js' \| asset_url \}\}"><\/script>/);
  assert.match(result.code, /<script type="module" src="\{\{ 'module\.js' \| asset_url \}\}"><\/script>/);
  assert.match(result.code, /<script src="https:\/\/cdn\.example\.test\/vendor\.js"><\/script>/);
  assert.match(result.code, /commented\.js/);
});

test("does not change executable Liquid comments or other dynamic script URLs", () => {
  const source = `{% comment %}{{ 'comment.js' | asset_url | script_tag }}{% endcomment %}
<script src="{{ selected_script | asset_url }}"></script>`;
  const result = deferCompatibleThemeScripts(source);

  assert.equal(result.changedCount, 0);
  assert.equal(result.code, source);
});

test("lazy-loads only Shopify image_tag expressions selected for below-fold content", () => {
  const source = `{% comment %}{{ product | image_url | image_tag }}{% endcomment %}
{{ product.featured_image | image_url: width: 1200 | image_tag: class: 'card-image' }}
{{ section.settings.hero | image_url: width: 1800 | image_tag: loading: 'eager', fetchpriority: 'high' }}
<img src="{{ product.featured_image | image_url }}">`;
  const candidates = inspectShopifyImageTags(source);
  const result = optimizeShopifyImageTags(source, "lazy-images");

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].index, 0);
  assert.equal(candidates[1].loading, "eager");
  assert.equal(result.candidateCount, 2);
  assert.equal(result.changedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.match(
    result.code,
    /image_tag: class: 'card-image', loading: 'lazy', decoding: 'async'/,
  );
  assert.match(result.code, /loading: 'eager', fetchpriority: 'high'/);
  assert.match(result.code, /<img src=/);
  assert.match(
    result.code,
    /\{% comment %\}\{\{ product \| image_url \| image_tag \}\}\{% endcomment %\}/,
  );
});

test("prioritizes exactly one chosen LCP image and safely updates literal loading hints", () => {
  const source = `
{{ section.settings.hero_image | image_url: width: 1800 | image_tag: loading: 'lazy', class: 'hero' }}
{{ product.featured_image | image_url: width: 1200 | image_tag }}
`;
  const result = optimizeShopifyImageTags(source, "prioritize-lcp", 0);

  assert.equal(result.candidateCount, 1);
  assert.equal(result.changedCount, 1);
  assert.match(result.code, /loading: 'eager', class: 'hero', fetchpriority: 'high'/);
  assert.match(result.code, /product\.featured_image[^\n]*\| image_tag \}\}/);
});

test("does not confuse commas or Liquid filter text inside option strings with syntax", () => {
  const source = `{{ hero | image_url: width: 1600 | image_tag: alt: 'Main, | image_tag, loading: preserve this', class: 'hero' }}`;
  const result = optimizeShopifyImageTags(source, "prioritize-lcp", 0);

  assert.equal(result.changedCount, 1);
  assert.match(
    result.code,
    /alt: 'Main, \| image_tag, loading: preserve this', class: 'hero', loading: 'eager', fetchpriority: 'high'/,
  );
});

test("adds a high fetch priority to a selected LCP image with existing options", () => {
  const source = `{{ hero | image_url: width: 1600 | image_tag: alt: 'Main hero' }}`;
  const result = optimizeShopifyImageTags(source, "prioritize-lcp", 0);

  assert.equal(result.changedCount, 1);
  assert.match(
    result.code,
    /image_tag: alt: 'Main hero', loading: 'eager', fetchpriority: 'high'/,
  );
});

test("leaves dynamic image loading options unchanged instead of guessing", () => {
  const source = `{{ image | image_url | image_tag: loading: section.settings.image_loading }}`;
  const result = optimizeShopifyImageTags(source, "lazy-images");

  assert.equal(result.changedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.code, source);
});

test("rejects an out-of-range LCP expression selection", () => {
  assert.throws(
    () => optimizeShopifyImageTags("{{ image | image_tag }}", "prioritize-lcp", 4),
    /Choose a valid Shopify image_tag expression/,
  );
});
