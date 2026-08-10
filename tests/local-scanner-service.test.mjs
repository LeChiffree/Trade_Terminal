import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const servicePath = new URL("../scripts/local-scanner-service.ps1", import.meta.url);
const configPath = new URL("../deploy/local/scanner-worker.jsonc", import.meta.url);

test("local scanner supervisor keeps secrets in env.local and avoids stripped environments", async () => {
  const source = await readFile(servicePath, "utf8");

  assert.match(source, /--env-file/);
  assert.match(source, /\.env\.local/);
  assert.match(source, /SystemRoot/);
  assert.match(source, /LOCALAPPDATA/);
  assert.match(source, /System\.Diagnostics\.ProcessStartInfo/);
  assert.doesNotMatch(source, /UseNewEnvironment/);
  assert.doesNotMatch(source, /BINANCE_API_KEY\s*=/);
  assert.doesNotMatch(source, /BINANCE_API_SECRET\s*=/);
});

test("local scanner configuration points at the built worker and persistent D1", async () => {
  const source = await readFile(configPath, "utf8");

  assert.match(source, /\.\.\/\.\.\/dist\/server\/index\.js/);
  assert.match(source, /"binding": "DB"/);
  assert.match(source, /"crons": \["\* \* \* \* \*"\]/);
});
