import assert from "node:assert/strict";
import test from "node:test";
import { auditTheme, minifyCandidates } from "./theme-audit";

const layout = `<!doctype html>
<html>
<head>
  <link rel="preconnect" href="https://cdn.shopify.com" crossorigin>
  <script src="{{ 'constants.js' | asset_url }}" defer="defer"></script>
  <script src="{{ 'vendor.js' | asset_url }}"></script>
  {{ 'global.js' | asset_url | script_tag }}
  <script type="module" src="{{ 'module.js' | asset_url }}"></script>
  <script type="application/json" id="data">{}</script>
  {% comment %}<script src="old.js"></script>{% endcomment %}
  {{ settings.type_body_font | font_face }}
  {{ settings.type_header_font | font_face: font_display: 'swap' }}
</head>
<body><script src="late.js"></script></body>
</html>`;

const section = `<div>
  <img src="{{ section.settings.image | image_url: width: 800 }}" alt="">
  <img src="x.png" width="10" height="10" loading="lazy">
  <iframe src="https://www.youtube.com/embed/x"></iframe>
</div>`;

test("finds blocking head scripts but not deferred, module, JSON, commented or body scripts", () => {
  const findings = auditTheme([{ filename: "layout/theme.liquid", size: layout.length, content: layout }]);
  const blocking = findings.filter((finding) => finding.id.startsWith("blocking-script"));
  assert.equal(blocking.length, 2);
  const vendor = blocking.find((finding) => finding.current?.includes("vendor.js"));
  assert.equal(vendor?.line, 6);
  assert.match(vendor?.fix ?? "", /^<script defer src=/);
  const scriptTag = blocking.find((finding) => finding.current?.includes("script_tag"));
  assert.equal(scriptTag?.fix, `<script src="{{ 'global.js' | asset_url }}" defer="defer"></script>`);
  assert.equal(blocking.every((finding) => finding.severity === "high"), true);
});

test("flags font_face without swap and a missing font preconnect", () => {
  const findings = auditTheme([{ filename: "layout/theme.liquid", size: layout.length, content: layout }]);
  const fonts = findings.filter((finding) => finding.category === "fonts");
  assert.equal(fonts.filter((finding) => finding.id.startsWith("font-face")).length, 1);
  assert.equal(fonts.find((finding) => finding.id.startsWith("font-face"))?.fix, "{{ settings.type_body_font | font_face: font_display: 'swap' }}");
  assert.equal(fonts.some((finding) => finding.id.startsWith("preconnect")), true);
});

test("flags images without lazy loading or size and iframes without lazy loading", () => {
  const findings = auditTheme([{ filename: "sections/gallery.liquid", size: section.length, content: section }]);
  const images = findings.filter((finding) => finding.category === "images");
  assert.equal(images.length, 2);
  assert.match(images.find((finding) => finding.id.startsWith("img"))?.fix ?? "", /loading="lazy"/);
  assert.match(images.find((finding) => finding.id.startsWith("iframe"))?.fix ?? "", /<iframe loading="lazy"/);
});

test("css @font-face without font-display is reported", () => {
  const css = "@font-face{font-family:X;src:url(x.woff2)}\n@font-face{font-family:Y;font-display:swap;src:url(y.woff2)}";
  const findings = auditTheme([{ filename: "assets/base.css", size: css.length, content: css }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0].fix ?? "", /font-display: swap;/);
});

test("minify findings use measured sizes and ignore tiny savings", () => {
  const findings = auditTheme([], [
    { filename: "assets/global.js", sourceBytes: 60_000, minifiedBytes: 30_000 },
    { filename: "assets/base.css", sourceBytes: 10_000, minifiedBytes: 7_000 },
    { filename: "assets/tiny.js", sourceBytes: 5_000, minifiedBytes: 4_500 },
  ]);
  assert.deepEqual(findings.map((finding) => [finding.file, finding.severity]), [
    ["assets/global.js", "high"],
    ["assets/base.css", "medium"],
  ]);
  assert.deepEqual(findings[0].bytes, { before: 60_000, after: 30_000 });
});

test("large theme image assets are reported", () => {
  const findings = auditTheme([{ filename: "assets/banner.png", size: 700 * 1024 }]);
  assert.equal(findings[0].severity, "high");
  assert.equal(findings[0].category, "images");
});

test("unused snippets are reported only when every render call is static", () => {
  const files = [
    { filename: "snippets/used.liquid", size: 10, content: "x" },
    { filename: "snippets/old-app.liquid", size: 10, content: "x" },
    { filename: "sections/a.liquid", size: 10, content: "{% render 'used' %}" },
  ];
  assert.deepEqual(auditTheme(files).map((finding) => finding.file), ["snippets/old-app.liquid"]);
  const dynamic = [...files, { filename: "sections/b.liquid", size: 10, content: "{% render block.type %}" }];
  assert.equal(auditTheme(dynamic).length, 0);
});

test("findings are sorted high → low", () => {
  const findings = auditTheme([
    { filename: "layout/theme.liquid", size: layout.length, content: layout },
    { filename: "sections/hero.liquid", size: section.length, content: section },
  ]);
  const order = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < findings.length; i += 1) {
    assert.ok(order[findings[i - 1].severity] <= order[findings[i].severity]);
  }
});

test("minify candidates skip Liquid, already-minified and tiny files", () => {
  const picked = minifyCandidates([
    { filename: "assets/a.js", size: 50_000 },
    { filename: "assets/a.min.js", size: 50_000 },
    { filename: "assets/b.css.liquid", size: 50_000 },
    { filename: "assets/c.css", size: 1_000 },
    { filename: "assets/d.css", size: 20_000 },
  ]).map((file) => file.filename);
  assert.deepEqual(picked, ["assets/a.js", "assets/d.css"]);
});

test("inert <template> markup and above-the-fold sections are not flagged for lazy loading", () => {
  const video = `<template><iframe src="https://www.youtube.com/embed/x"></iframe></template>`;
  const banner = `<img srcset="{%- if image.width >= 165 -%}{{ image | image_url: width: 165 }} 165w{%- endif -%}" width="{{ image.width }}" height="{{ image.height }}">`;
  const findings = auditTheme([
    { filename: "sections/video.liquid", size: video.length, content: video },
    { filename: "sections/image-banner.liquid", size: banner.length, content: banner },
  ]);
  assert.deepEqual(findings, []);
});

test("Liquid comparisons inside a tag don't end the tag early", () => {
  const card = `<img srcset="{%- if img.width > 165 -%}a 165w{%- endif -%}" loading="lazy" width="1" height="1">`;
  assert.deepEqual(auditTheme([{ filename: "sections/card.liquid", size: card.length, content: card }]), []);
});
