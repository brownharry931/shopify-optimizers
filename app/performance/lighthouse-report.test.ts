import assert from "node:assert/strict";
import test from "node:test";
import {
  extractLighthouseReport,
  formatBytesToKiB,
  formatMilliseconds,
  pageSpeedWebUrl,
  readStoredReport,
  toDisplayScore,
} from "./lighthouse-report";

const PIXEL = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

function payload() {
  return {
    loadingExperience: { overall_category: "AVERAGE" },
    lighthouseResult: {
      lighthouseVersion: "12.8.2",
      fetchTime: "2026-11-19T10:00:00.000Z",
      requestedUrl: "https://shop.example/",
      finalDisplayedUrl: "https://shop.example/",
      runWarnings: [],
      configSettings: {
        formFactor: "mobile",
        throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
      },
      environment: {
        networkUserAgent:
          "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 Chrome/137.0 Mobile Safari/537.36",
      },
      categories: {
        performance: {
          id: "performance",
          title: "Performance",
          score: 0.445,
          auditRefs: [
            { id: "largest-contentful-paint", group: "metrics", weight: 25 },
            { id: "render-blocking-insight", group: "insights" },
            { id: "uses-responsive-images", group: "insights" },
            { id: "dom-size-insight", group: "diagnostics" },
            { id: "font-display-insight", group: "insights" },
            { id: "viewport-insight", group: "insights" },
            { id: "screenshot-thumbnails", group: "hidden" },
          ],
        },
        accessibility: { id: "accessibility", title: "Accessibility", score: 0.875, auditRefs: [] },
        "best-practices": { id: "best-practices", title: "Best Practices", score: 1, auditRefs: [] },
        seo: { id: "seo", title: "SEO", score: 0.92, auditRefs: [] },
      },
      categoryGroups: {
        insights: { title: "Insights" },
        diagnostics: { title: "Diagnostics" },
      },
      audits: {
        "largest-contentful-paint": {
          title: "Largest Contentful Paint",
          description: "LCP marks the time…",
          score: 0.31,
          scoreDisplayMode: "numeric",
          displayValue: "5.3 s",
          numericValue: 5312.4,
        },
        "render-blocking-insight": {
          title: "Render blocking requests",
          description: "Requests are blocking the page's initial render. [Learn more](https://developer.chrome.com/x)",
          score: 0,
          scoreDisplayMode: "metricSavings",
          displayValue: "Est savings of 600 ms",
          metricSavings: { FCP: 600, LCP: 600 },
          details: {
            type: "table",
            headings: [
              { key: "url", valueType: "url", label: "URL" },
              { key: "totalBytes", valueType: "bytes", label: "Transfer Size" },
              { key: "wastedMs", valueType: "ms", label: "Duration" },
            ],
            items: [{ url: "https://shop.example/cdn/shop/t/1/assets/base.css", totalBytes: 20480, wastedMs: 604, secret: "drop" }],
          },
        },
        "uses-responsive-images": {
          title: "Properly size images",
          description: "Serve images that are appropriately-sized.",
          score: 0.5,
          scoreDisplayMode: "metricSavings",
          displayValue: "Est savings of 120 KiB",
          details: {
            headings: [{ key: "url", valueType: "url", label: "URL" }],
            items: [{ url: "https://cdn.shopify.com/s/files/1/hero.jpg?width=2000", totalBytes: 200000, wastedBytes: 120000, wastedPercent: 60 }],
          },
        },
        "dom-size-insight": {
          title: "Optimize DOM size",
          description: "A large DOM…",
          score: null,
          scoreDisplayMode: "informative",
        },
        "font-display-insight": { title: "Font display", score: 1, scoreDisplayMode: "metricSavings" },
        "viewport-insight": { title: "Optimize viewport for mobile", score: null, scoreDisplayMode: "notApplicable" },
        "final-screenshot": { details: { type: "screenshot", data: PIXEL } },
        "screenshot-thumbnails": {
          details: { items: [{ timing: 300, data: PIXEL }, { timing: 600, data: "javascript:alert(1)" }] },
        },
      },
    },
  };
}

test("scores use the Lighthouse renderer's rounding", () => {
  assert.equal(toDisplayScore(0.445), 45);
  assert.equal(toDisplayScore(0.875), 88);
  assert.equal(toDisplayScore(null), null);
});

test("extracts categories, metrics and audits verbatim", () => {
  const report = extractLighthouseReport(payload());
  assert.ok(report);
  assert.deepEqual(
    report.categories.map((category) => [category.title, category.score]),
    [["Performance", 45], ["Accessibility", 88], ["Best Practices", 100], ["SEO", 92]],
  );
  const lcp = report.metrics.find((metric) => metric.id === "largest-contentful-paint");
  assert.equal(lcp?.displayValue, "5.3 s");
  assert.equal(lcp?.rating, "fail");
  assert.equal(report.device, "Emulated Moto G Power");
  assert.equal(report.network, "Slow 4G throttling");

  assert.deepEqual(report.audits.map((audit) => audit.id), [
    "render-blocking-insight",
    "uses-responsive-images",
    "dom-size-insight",
  ]);
  const blocking = report.audits[0];
  assert.equal(blocking.title, "Render blocking requests");
  assert.equal(blocking.displayValue, "Est savings of 600 ms");
  assert.deepEqual(blocking.metricSavings, { FCP: 600, LCP: 600 });
  assert.deepEqual(Object.keys(blocking.items[0]).sort(), ["totalBytes", "url", "wastedMs"]);
  assert.deepEqual(report.passedAudits.map((audit) => audit.id), ["font-display-insight"]);
  assert.equal(report.groups.insights, "Insights");
});

test("keeps only safe data-image screenshots", () => {
  const report = extractLighthouseReport(payload());
  assert.equal(report?.screenshot, PIXEL);
  assert.deepEqual(report?.filmstrip.map((frame) => frame.timing), [300]);
});

test("collects flagged images with Lighthouse savings", () => {
  const report = extractLighthouseReport(payload());
  assert.equal(report?.images.length, 1);
  assert.equal(report?.images[0].wastedPercent, 60);
  assert.deepEqual(report?.images[0].sources, ["uses-responsive-images"]);
});

test("returns null for incomplete payloads and older stored rows", () => {
  assert.equal(extractLighthouseReport({}), null);
  assert.equal(readStoredReport({ version: 1 }), null);
  assert.equal(readStoredReport(null), null);
});

test("formats values like the Lighthouse report", () => {
  assert.equal(formatBytesToKiB(20480), "20.0 KiB");
  assert.equal(formatBytesToKiB(1_234_567), "1,205.6 KiB");
  assert.equal(formatMilliseconds(604), "600 ms");
  assert.equal(formatMilliseconds(1234), "1,230 ms");
});

test("links to the same URL and device on PageSpeed Insights", () => {
  const url = new URL(pageSpeedWebUrl("https://shop.example/products/a", "desktop"));
  assert.equal(url.hostname, "pagespeed.web.dev");
  assert.equal(url.searchParams.get("url"), "https://shop.example/products/a");
  assert.equal(url.searchParams.get("form_factor"), "desktop");
});
