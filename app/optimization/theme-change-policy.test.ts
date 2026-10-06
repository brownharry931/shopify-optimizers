import assert from "node:assert/strict";
import test from "node:test";
import {
  canWriteThemeRole,
  verifyThemeChangeState,
} from "./theme-change-policy";

const source = "original-sha256";
const optimized = "optimized-sha256";

test("only unpublished and development themes are writable", () => {
  assert.equal(canWriteThemeRole("UNPUBLISHED"), true);
  assert.equal(canWriteThemeRole("DEVELOPMENT"), true);
  assert.equal(canWriteThemeRole("MAIN"), false);
  assert.equal(canWriteThemeRole("UNKNOWN"), false);
});

test("a completed apply is recognized only when the optimized checksum matches", () => {
  assert.equal(
    verifyThemeChangeState("SUBMITTED", optimized, source, optimized),
    "applied",
  );
  assert.equal(
    verifyThemeChangeState("SUBMITTED", source, source, optimized),
    "pending",
  );
  assert.equal(
    verifyThemeChangeState("SUBMITTED", "merchant-edit", source, optimized),
    "conflict",
  );
});

test("interrupted prepared writes retry only while the original is unchanged", () => {
  assert.equal(
    verifyThemeChangeState("PREPARED", source, source, optimized),
    "retry-apply",
  );
  assert.equal(
    verifyThemeChangeState("PREPARED", optimized, source, optimized),
    "applied",
  );
  assert.equal(
    verifyThemeChangeState("PREPARED", "merchant-edit", source, optimized),
    "conflict",
  );
});

test("rollback confirms the original and never overwrites an intervening edit", () => {
  assert.equal(
    verifyThemeChangeState("ROLLBACK_SUBMITTED", source, source, optimized),
    "rolled-back",
  );
  assert.equal(
    verifyThemeChangeState("ROLLBACK_SUBMITTED", optimized, source, optimized),
    "pending",
  );
  assert.equal(
    verifyThemeChangeState(
      "ROLLBACK_SUBMITTED",
      "merchant-edit",
      source,
      optimized,
    ),
    "conflict",
  );
});

test("completed and failed records are not treated as pending writes", () => {
  assert.equal(
    verifyThemeChangeState("APPLIED", optimized, source, optimized),
    "not-pending",
  );
  assert.equal(
    verifyThemeChangeState("FAILED", source, source, optimized),
    "not-pending",
  );
});
