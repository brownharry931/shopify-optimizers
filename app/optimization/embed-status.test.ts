import assert from "node:assert/strict";
import test from "node:test";
import {
  embedIsActive,
  embedStateFromSettingsData,
  isSpeedBoostEmbedType,
  stripJsonComments,
} from "./embed-status";

const TYPE = "shopify://apps/speedboost/blocks/performance-pro-embed/0199c2c2-1b6a-7d2e-9c6f-3f0a1d2b4c5e";
const HEADER = `/*
 * IMPORTANT: The contents of this file are auto-generated.
 * This file may be updated by the Shopify admin theme editor
 * or related systems. Please exercise caution as any changes
 * made to this file may be overwritten.
 */
`;

function settings(blocks: Record<string, unknown>) {
  return HEADER + JSON.stringify({ current: { logo_width: 90, blocks, sections: {} } }, null, 2);
}

test("strips Shopify's comment header but keeps strings with slashes", () => {
  const json = stripJsonComments(`${HEADER}{"url":"https://x.test/a//b","n":"/* not a comment */"}`);
  assert.deepEqual(JSON.parse(json), { url: "https://x.test/a//b", n: "/* not a comment */" });
});

test("detects an enabled embed (Dawn/Horizon style settings)", () => {
  const source = settings({
    "123": { type: "shopify://apps/judge-me/blocks/judgeme_core/61ccd3b1", disabled: false },
    "456": { type: TYPE, disabled: false, settings: {} },
  });
  assert.equal(embedStateFromSettingsData(source), "enabled");
});

test("an embed without a disabled flag counts as enabled", () => {
  assert.equal(embedStateFromSettingsData(settings({ a: { type: TYPE, settings: {} } })), "enabled");
});

test("reports a saved-but-switched-off embed as disabled", () => {
  assert.equal(embedStateFromSettingsData(settings({ a: { type: TYPE, disabled: true } })), "disabled");
});

test("reports not-added when the theme has no SpeedBoost block", () => {
  assert.equal(embedStateFromSettingsData(settings({})), "not-added");
  assert.equal(embedStateFromSettingsData(`${HEADER}{"current":{}}`), "not-added");
});

test("older themes that store current as a preset name are supported", () => {
  const source = JSON.stringify({
    current: "Default",
    presets: { Default: { blocks: { a: { type: TYPE, disabled: false } } } },
  });
  assert.equal(embedStateFromSettingsData(source), "enabled");
});

test("only SpeedBoost's block handle matches", () => {
  assert.equal(isSpeedBoostEmbedType(TYPE), true);
  assert.equal(isSpeedBoostEmbedType("shopify://apps/other/blocks/app-embed/1"), false);
  assert.equal(isSpeedBoostEmbedType("shopify://apps/x/blocks/performance-pro-embed-extra/1"), false);
  assert.equal(isSpeedBoostEmbedType(null), false);
});

test("unparseable files throw so callers report 'unknown', never 'not enabled'", () => {
  assert.throws(() => embedStateFromSettingsData("{ broken"));
});

test("a failed theme read only counts as active when the runtime is reporting", () => {
  const base = { themeName: null, lastSeenAt: null, error: "x" };
  assert.equal(embedIsActive({ ...base, theme: "unknown", live: true }), true);
  assert.equal(embedIsActive({ ...base, theme: "unknown", live: false }), false);
  assert.equal(embedIsActive({ ...base, theme: "enabled", live: false }), true);
});
