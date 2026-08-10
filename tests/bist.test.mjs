import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

async function loadBistModule() {
  const source = await readFile(
    new URL("../lib/bist.ts", import.meta.url),
    "utf8",
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  const directory = await mkdtemp(join(tmpdir(), "quantscope-bist-score-"));
  const modulePath = join(directory, "bist.mjs");
  await writeFile(modulePath, transpiled, "utf8");
  return {
    module: await import(
      `${new URL(`file:///${modulePath.replaceAll("\\", "/")}`).href}?${Date.now()}`
    ),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "bist-test",
    `${process.pid}-${Date.now()}-${Math.random()}`,
  );
  return (await import(workerUrl.href)).default;
}

test("ships a dynamic top-80 BIST terminal with explicit delayed-data semantics", async () => {
  const [library, component, page] = await Promise.all([
    readFile(new URL("../lib/bist.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/bist-terminal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  const fallbackMatch = library.match(
    /BIST_FALLBACK_SYMBOLS\s*=\s*\[([\s\S]*?)\]\s*as const/,
  );
  assert.ok(fallbackMatch);
  const symbols = [...fallbackMatch[1].matchAll(/"([A-Z0-9]+)"/g)]
    .map((match) => match[1]);
  assert.equal(symbols.length, 80);
  assert.equal(new Set(symbols).size, 80);
  assert.match(library, /sortBy:\s*"Value\.Traded"/);
  assert.match(component, /en az 15 dakika gecikmelidir/i);
  assert.match(component, /İşlem değerine göre ilk 80 kağıt/);
  assert.match(page, /\|\s*"BIST 80"/);
  assert.ok(
    page.indexOf('{ label: "Paper Trade"') <
      page.indexOf('{ label: "BIST 80"'),
  );
});

test("returns 80 unique BIST shares and delayed selected-share candles", async () => {
  const worker = await loadWorker();
  const env = {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  };
  const directoryResponse = await worker.fetch(
    new Request("http://localhost/api/bist/symbols?interval=15m"),
    env,
    ctx,
  );
  const directory = await directoryResponse.json();

  assert.equal(directoryResponse.status, 200);
  assert.equal(directory.interval, "15m");
  assert.equal(directory.symbols.length, 80);
  assert.equal(
    new Set(directory.symbols.map((item) => item.symbol)).size,
    80,
  );

  const marketResponse = await worker.fetch(
    new Request("http://localhost/api/bist/market?symbol=THYAO&interval=15m"),
    env,
    ctx,
  );
  const market = await marketResponse.json();
  assert.equal(marketResponse.status, 200);
  assert.equal(market.symbol, "THYAO");
  assert.equal(market.interval, "15m");
  assert.equal(market.source, "bist");
  assert.equal(market.delayedMinutes, 15);
  assert.ok(market.candles.length >= 50);
});

test("calibrates BIST scores continuously without confidence saturation", async (context) => {
  const loaded = await loadBistModule();
  context.after(loaded.cleanup);
  const score = loaded.module.scoreBistTechnical;
  const strong = score({
    recommend: 0.7,
    rsi: 64,
    macd: 2,
    macdSignal: 1.3,
    close: 106,
    ema20: 102,
    ema50: 99,
    sma200: 92,
    change: 2.1,
  });
  const moderate = score({
    recommend: 0.55,
    rsi: 58,
    macd: 1.2,
    macdSignal: 1,
    close: 103,
    ema20: 101,
    ema50: 100,
    sma200: 97,
    change: 0.8,
  });
  const mixed = score({
    recommend: 0.55,
    rsi: 44,
    macd: 0.8,
    macdSignal: 1,
    close: 99,
    ema20: 100,
    ema50: 101,
    sma200: 98,
    change: -0.4,
  });

  assert.ok(strong.score > moderate.score);
  assert.ok(moderate.score > mixed.score);
  assert.equal(new Set([strong.score, moderate.score, mixed.score]).size, 3);
  assert.ok(strong.confidence <= 92);
  assert.ok(moderate.confidence < strong.confidence);
});
