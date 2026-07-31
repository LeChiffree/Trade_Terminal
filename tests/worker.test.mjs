import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("packages the persistent scheduled scanner", async () => {
  const worker = await loadWorker();
  const wrangler = JSON.parse(
    await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"),
  );
  const hosting = JSON.parse(
    await readFile(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"),
  );

  assert.equal(typeof worker.scheduled, "function");
  assert.deepEqual(wrangler.triggers.crons, ["* * * * *"]);
  assert.equal(wrangler.limits.subrequests, 1000);
  assert.equal(hosting.d1, "DB");
  assert.equal(wrangler.d1_databases[0].binding, "DB");
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

test("keeps the background scanner sync private", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/scanner/sync", { method: "POST" }),
    env,
    ctx,
  );

  assert.ok([401, 503].includes(response.status));
  const body = await response.json();
  assert.equal(typeof body.error, "string");
});

test("returns 50 non-stablecoin USDT markets", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/symbols"),
    env,
    ctx,
  );
  const body = await response.json();
  const excluded = new Set(["USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "USDE", "PYUSD", "BUSD"]);

  assert.equal(response.status, 200);
  assert.equal(body.symbols.length, 50);
  assert.ok(body.symbols.every((item) => item.quoteAsset === "USDT"));
  assert.ok(body.symbols.every((item) => !excluded.has(item.baseAsset)));
});

test("market route changes both symbol and timeframe series", async () => {
  const worker = await loadWorker();
  const [firstResponse, secondResponse] = await Promise.all([
    worker.fetch(new Request("http://localhost/api/market?symbol=BTCUSDT&interval=5m"), env, ctx),
    worker.fetch(new Request("http://localhost/api/market?symbol=ETHUSDT&interval=1h"), env, ctx),
  ]);
  const [first, second] = await Promise.all([firstResponse.json(), secondResponse.json()]);

  assert.equal(first.symbol, "BTCUSDT");
  assert.equal(first.interval, "5m");
  assert.equal(second.symbol, "ETHUSDT");
  assert.equal(second.interval, "1h");
  assert.notDeepEqual(
    first.candles.slice(-10).map((item) => item.close),
    second.candles.slice(-10).map((item) => item.close),
  );
});

test("returns a bounded global market context for the decision engine", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/context"),
    env,
    ctx,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.fearGreed.attribution, "Alternative.me");
  assert.ok(body.scores.overall >= -100 && body.scores.overall <= 100);
  assert.ok(body.scores.fear >= -100 && body.scores.fear <= 100);
  assert.ok(body.scores.breadth >= -100 && body.scores.breadth <= 100);
  assert.ok(body.scores.news >= -100 && body.scores.news <= 100);
  assert.ok(["GDELT", "Google News", "none"].includes(body.news.provider));
  assert.ok(body.news.items.length <= 6);
  assert.ok(body.news.items.every((item) => item.url.startsWith("https://")));
});
