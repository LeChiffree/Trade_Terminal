import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/state-upstream.ts", import.meta.url);

test("requires an HTTPS path-specific state upstream and keeps auth server-side", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(moduleUrl, "utf8");

  assert.match(source, /url\.protocol !== "https:"/);
  assert.match(source, /url\.pathname !== expectedPath/);
  assert.match(source, /OAI-Sites-Authorization/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /response\.redirected/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_/);
});
