import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// In the embedded admin a plain <a href="/app/..."> reloads the iframe
// without Shopify's session parameters and breaks authentication. In-app
// navigation must use react-router's <Link>; external links must open in a
// new tab or the top window.
const files = ["app/routes", "app/components"].flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => join(dir, name)),
);

test("no plain anchors for in-app navigation", () => {
  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<a\s[^>]*>/g)) {
      const tag = match[0];
      if (/target=/.test(tag)) continue;
      if (/href="https?:\/\//.test(tag)) continue;
      offenders.push(`${file}: ${tag.slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
