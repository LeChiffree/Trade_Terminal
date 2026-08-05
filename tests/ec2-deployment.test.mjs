import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  dockerfile: new URL("../deploy/ec2/Dockerfile", import.meta.url),
  compose: new URL("../deploy/ec2/compose.yaml", import.meta.url),
  entrypoint: new URL("../deploy/ec2/scanner-entrypoint.sh", import.meta.url),
  worker: new URL("../deploy/ec2/scanner-worker.jsonc", import.meta.url),
  secrets: new URL("../deploy/ec2/scanner.env.example", import.meta.url),
  dockerignore: new URL("../.dockerignore", import.meta.url),
};

test("packages an EC2 scanner without publishing its private listener", async () => {
  const [dockerfile, compose, entrypoint, workerText] = await Promise.all([
    readFile(files.dockerfile, "utf8"),
    readFile(files.compose, "utf8"),
    readFile(files.entrypoint, "utf8"),
    readFile(files.worker, "utf8"),
  ]);
  const worker = JSON.parse(workerText);

  assert.match(dockerfile, /USER quantscope/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.doesNotMatch(compose, /^\s*ports:/m);
  assert.match(entrypoint, /--ip 127\.0\.0\.1/);
  assert.match(entrypoint, /\/__scheduled/);
  assert.match(entrypoint, /OAI-Sites-Authorization: Bearer/);
  assert.deepEqual(worker.triggers.crons, ["* * * * *"]);
  assert.equal(worker.d1_databases[0].binding, "DB");
});

test("keeps EC2 credentials outside the image and tracked configuration", async () => {
  const contents = await Promise.all(
    Object.values(files).map((file) => readFile(file, "utf8")),
  );
  const combined = contents.join("\n");

  assert.doesNotMatch(combined, /AIza[0-9A-Za-z_-]{20,}/);
  assert.doesNotMatch(combined, /gpt[a-z0-9]{12,}/i);
  assert.doesNotMatch(combined, /Bearer\s+[0-9A-Za-z_-]{20,}/);
  assert.match(
    await readFile(files.secrets, "utf8"),
    /^SITES_SYNC_BEARER_TOKEN=$/m,
  );
  const dockerignore = await readFile(files.dockerignore, "utf8");
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^\.scanner-service\.ps1$/m);
  assert.match(dockerignore, /^\.wrangler$/m);
});
