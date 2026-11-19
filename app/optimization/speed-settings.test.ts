import assert from "node:assert/strict";
import test from "node:test";
import {
  ALWAYS_ALLOWED_PATTERNS,
  DEFAULT_SPEED_SETTINGS,
  KNOWN_TRACKER_PATTERNS,
  parseSpeedSettings,
  readSpeedSettings,
  storefrontPayload,
} from "./speed-settings";

test("every booster is off by default", () => {
  const settings = parseSpeedSettings({});
  assert.deepEqual(settings, DEFAULT_SPEED_SETTINGS);
});

test("parses toggles, patterns and options", () => {
  const settings = parseSpeedSettings({
    delayAppScripts: true,
    loadingBar: "on",
    delayTimeoutMs: 5000,
    delayPatterns: "Widget.Example.com\nwidget.example.com, other.io/x.js",
    loadingBarColor: "#AABBCC",
  });
  assert.equal(settings.delayAppScripts, true);
  assert.equal(settings.loadingBar, true);
  assert.equal(settings.instantPage, false);
  assert.equal(settings.delayTimeoutMs, 5000);
  assert.deepEqual(settings.delayPatterns, ["widget.example.com", "other.io/x.js"]);
  assert.equal(settings.loadingBarColor, "#aabbcc");
});

test("rejects values that would be unsafe inside the storefront embed", () => {
  assert.throws(() => parseSpeedSettings({ delayPatterns: ["</script><script>"] }));
  assert.throws(() => parseSpeedSettings({ loadingBarColor: "red;}" }));
  assert.throws(() => parseSpeedSettings({ lcpImageSizes: "100vw\"><script>" }));
  assert.throws(() => parseSpeedSettings({ delayTimeoutMs: 999999 }));
});

test("stored values fall back to defaults when unreadable", () => {
  assert.deepEqual(readSpeedSettings("not json"), DEFAULT_SPEED_SETTINGS);
  assert.equal(readSpeedSettings(JSON.stringify({ lazyMedia: true })).lazyMedia, true);
});

test("storefront payload resolves the script lists", () => {
  const off = storefrontPayload(parseSpeedSettings({ delayPatterns: ["a.io"] }));
  assert.deepEqual(off.resolvedDelay, ["a.io"]);
  const on = storefrontPayload(parseSpeedSettings({ delayTrackers: true, neverDelayPatterns: ["b.io"] }));
  assert.deepEqual(on.resolvedDelay, KNOWN_TRACKER_PATTERNS);
  assert.deepEqual(on.resolvedNever, [...ALWAYS_ALLOWED_PATTERNS, "b.io"]);
});
