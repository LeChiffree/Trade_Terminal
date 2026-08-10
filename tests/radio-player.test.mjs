import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const radioSource = await readFile(
  new URL("../app/radio-player.tsx", import.meta.url),
  "utf8",
);
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("radio player exposes a curated HTTPS-only Türkiye station list", () => {
  const streamUrls = [
    ...radioSource.matchAll(/streamUrl:\s*"([^"]+)"/g),
  ].map((match) => match[1]);

  assert.equal(streamUrls.length, 12);
  assert.ok(streamUrls.every((url) => url.startsWith("https://")));
  assert.ok(streamUrls.every((url) => !url.includes(".m3u8")));
});

test("radio player is mounted in the top bar with responsive styling", () => {
  assert.match(pageSource, /import RadioPlayer from "\.\/radio-player"/);
  assert.match(pageSource, /<div className="top-actions"><RadioPlayer \/>/);
  assert.match(styles, /\.radio-panel\s*\{/);
  assert.match(styles, /\.radio-trigger\.playing/);
  assert.match(styles, /\.radio-status\.error/);
});
