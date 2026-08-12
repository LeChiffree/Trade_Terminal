import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const entrypoint = await readFile(
  new URL("../deploy/ec2/scanner-entrypoint.sh", import.meta.url),
  "utf8",
);

test("restarts a persistently unavailable local scanner worker", () => {
  assert.match(entrypoint, /consecutive_worker_failures=0/);
  assert.match(entrypoint, /max_worker_failures=4/);
  assert.match(entrypoint, /return 10/);
  assert.match(entrypoint, /return 11/);
  assert.match(entrypoint, /return 12/);
  assert.match(entrypoint, /exiting so Docker can restart it/);
  assert.match(entrypoint, /exit 1/);
});

test("does not restart the local worker for a remote sync outage", () => {
  assert.match(entrypoint, /return 20/);
  assert.match(entrypoint, /return 21/);
  assert.match(entrypoint, /20\|21\)/);
  assert.match(entrypoint, /remote sync failed; the local scanner will keep running/);
});
