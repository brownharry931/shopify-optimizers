import assert from "node:assert/strict";
import test from "node:test";
import { parseStrictInteger } from "./form-validation";

test("strictly parses only bounded decimal integer form values", () => {
  assert.equal(parseStrictInteger("0"), 0);
  assert.equal(parseStrictInteger("42"), 42);

  for (const value of [
    "",
    "-1",
    "1.5",
    "1e3",
    " 1",
    "999999999999999999999",
    "12345678901",
  ]) {
    assert.equal(parseStrictInteger(value), undefined, value);
  }
});
