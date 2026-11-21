import assert from "node:assert/strict";
import test from "node:test";
import { guidanceForFinding } from "./recommendations";

test("image guidance points to the read-only theme audit", () => {
  const guidance = guidanceForFinding("uses-optimized-images");

  assert.equal(guidance.area, "Images");
  assert.match(guidance.nextStep, /above the fold/i);
  assert.match(guidance.automation, /Theme audit/i);
  assert.doesNotMatch(guidance.automation, /draft theme|rollback/i);
});

test("unused CSS guidance warns against deleting from one test", () => {
  const guidance = guidanceForFinding("unused-css-rules");

  assert.match(guidance.nextStep, /not proof that a stylesheet is safe to delete/i);
  assert.match(guidance.automation, /never removed automatically/i);
});

test("unknown findings receive cautious, non-invented guidance", () => {
  const guidance = guidanceForFinding("future-provider-audit-id");

  assert.equal(guidance.area, "Storefront diagnostic");
  assert.match(guidance.nextStep, /provider's finding/i);
  assert.match(guidance.automation, /No automatic storefront change/i);
});
