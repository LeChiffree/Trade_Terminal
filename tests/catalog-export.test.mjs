import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("catalog-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("packages the catalog queue and R2 export binding", async () => {
  const hosting = JSON.parse(
    await readFile(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"),
  );
  const migration = await readFile(
    new URL("../dist/.openai/drizzle/0006_lonely_trauma.sql", import.meta.url),
    "utf8",
  );
  const route = await readFile(
    new URL("../app/api/catalog-jobs/route.ts", import.meta.url),
    "utf8",
  );

  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "FILES");
  assert.match(migration, /CREATE TABLE `catalog_jobs`/);
  assert.match(migration, /idx_catalog_jobs_status_created/);
  assert.match(route, /X-QuantScope-Trigger/);
  assert.match(route, /oai-authenticated-user-email/);
  assert.match(route, /env\.FILES\.put/);
  assert.match(route, /owner_email = \?/);
});

test("renders the catalog export navigation and fails closed without storage", async () => {
  const worker = await loadWorker();
  const page = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    env,
    ctx,
  );
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Fiyat Verisi/);

  const api = await worker.fetch(
    new Request("http://localhost/api/catalog-jobs"),
    env,
    ctx,
  );
  assert.equal(api.status, 503);
  assert.match((await api.json()).error, /veritabanı/i);
});
