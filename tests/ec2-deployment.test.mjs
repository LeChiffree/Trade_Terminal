import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  dockerfile: new URL("../deploy/ec2/Dockerfile", import.meta.url),
  compose: new URL("../deploy/ec2/compose.yaml", import.meta.url),
  fullCompose: new URL("../deploy/ec2/compose-full.yaml", import.meta.url),
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
  assert.match(entrypoint, /bind_address="\$\{BIND_ADDRESS:-127\.0\.0\.1\}"/);
  assert.match(entrypoint, /--ip "\$bind_address"/);
  assert.match(entrypoint, /\/__scheduled/);
  assert.match(entrypoint, /OAI-Sites-Authorization: Bearer/);
  assert.deepEqual(worker.triggers.crons, ["* * * * *"]);
  assert.equal(worker.d1_databases[0].binding, "DB");
});

test("serves the EC2 frontend and scanner from one state-owning process", async () => {
  const fullCompose = await readFile(files.fullCompose, "utf8");

  assert.match(fullCompose, /BIND_ADDRESS: 0\.0\.0\.0/);
  assert.match(fullCompose, /- "80:8791"/);
  assert.match(fullCompose, /scanner_env/);
  assert.match(fullCompose, /source: \$\{QUANTSCOPE_DATA_DIR:-\/opt\/quantscope\/data\}/);
  assert.equal((fullCompose.match(/target: \/data/g) ?? []).length, 1);
  assert.match(fullCompose, /\/app\/\.wrangler:size=/);
  assert.match(fullCompose, /\/app\/node_modules\/\.mf:size=/);
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
  assert.match(
    await readFile(files.secrets, "utf8"),
    /^BINANCE_API_KEY=$/m,
  );
  assert.match(
    await readFile(files.secrets, "utf8"),
    /^BINANCE_API_SECRET=$/m,
  );
  assert.match(combined, /BINANCE_FUTURES_DEMO_ONLY/);
  assert.doesNotMatch(combined, /https:\/\/fapi\.binance\.com/);
  const dockerignore = await readFile(files.dockerignore, "utf8");
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^\.scanner-service\.ps1$/m);
  assert.match(dockerignore, /^\.wrangler$/m);
});
