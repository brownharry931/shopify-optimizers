import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import test from "node:test";
import {
  minifyCssAsset,
  minifyJavaScriptAsset,
} from "./asset-transform.server";

test("minifies CSS and reports the actual UTF-8 byte change", () => {
  const source = `/* keep this comment? */\n.card { color: #ffffff; margin: 0px 0px; }`;
  const result = minifyCssAsset(source);

  assert.equal(result.kind, "css");
  assert.equal(result.sourceBytes, Buffer.byteLength(source, "utf8"));
  assert.equal(result.outputBytes, Buffer.byteLength(result.code, "utf8"));
  assert.ok(result.outputBytes < result.sourceBytes);
  assert.equal(result.savedBytes, result.sourceBytes - result.outputBytes);
  assert.match(result.code, /\.card/);
  assert.match(result.code, /color/);
});

test("minifies JavaScript without changing the sample program's result", async () => {
  const source = `function add(left, right) {\n  return left + right;\n}\nglobalThis.result = add(20, 22);`;
  const result = await minifyJavaScriptAsset(source);
  const originalContext: Record<string, unknown> = {};
  const minifiedContext: Record<string, unknown> = {};

  runInNewContext(source, originalContext);
  runInNewContext(result.code, minifiedContext);

  assert.equal(originalContext.result, 42);
  assert.equal(minifiedContext.result, originalContext.result);
  assert.ok(result.outputBytes < result.sourceBytes);
  assert.equal(result.kind, "javascript");
});

test("rejects invalid JavaScript instead of returning a partial asset", async () => {
  await assert.rejects(
    minifyJavaScriptAsset("function { this is not valid JavaScript"),
  );
});

test("rejects empty or oversized source before transforming", async () => {
  assert.throws(() => minifyCssAsset(""), /non-empty/);
  await assert.rejects(minifyJavaScriptAsset(""), /non-empty/);

  const oversized = "a".repeat(8 * 1024 * 1024 + 1);
  assert.throws(() => minifyCssAsset(oversized), /safe 8 MB transform limit/);
  await assert.rejects(
    minifyJavaScriptAsset(oversized),
    /safe 8 MB transform limit/,
  );
});
