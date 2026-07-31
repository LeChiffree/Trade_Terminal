import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
};

test("renders the QuantScope application shell and production metadata", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    env,
    ctx,
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(html, /<html[^>]*lang=["']tr["']/i);
  assert.match(html, /QuantScope Trade Terminal/);
  assert.doesNotMatch(html, /codex-preview/i);
});

test("rejects malformed Gemini review requests", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/llm-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    }),
    env,
    ctx,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Geçersiz istek gövdesi." });
});

test("rejects incomplete email requests before sending", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unknown" }),
    }),
    env,
    ctx,
  );

  assert.ok([422, 503].includes(response.status));
  const body = await response.json();
  assert.equal(typeof body.error, "string");
});
