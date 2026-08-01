import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

async function loadStreamModule() {
  const source = await readFile(new URL("../lib/binance-stream.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  const directory = await mkdtemp(join(tmpdir(), "quantscope-stream-"));
  const modulePath = join(directory, "binance-stream.mjs");
  await writeFile(modulePath, transpiled, "utf8");
  return {
    module: await import(`${new URL(`file:///${modulePath.replaceAll("\\", "/")}`).href}?${Date.now()}`),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function market(source = "binance") {
  return {
    symbol: "BTCUSDT",
    interval: "5m",
    source,
    fetchedAt: 1,
    candles: [{
      openTime: 1_000,
      closeTime: 1_299,
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 10,
      quoteVolume: 1_010,
      trades: 12,
      takerBuyVolume: 6,
    }],
    ticker: {
      lastPrice: 101,
      priceChange: 1,
      priceChangePercent: 1,
      highPrice: 102,
      lowPrice: 99,
      quoteVolume: 10_000,
    },
    book: {
      bids: [[100.9, 2]],
      asks: [[101.1, 3]],
    },
  };
}

test("applies Binance kline, ticker and partial depth frames to a live market", async (context) => {
  const loaded = await loadStreamModule();
  context.after(loaded.cleanup);
  const apply = loaded.module.applyBinanceStreamEvent;

  const withKline = apply(market(), "BTCUSDT", "5m", {
    stream: "btcusdt@kline_5m",
    data: {
      e: "kline",
      s: "BTCUSDT",
      k: {
        t: 1_000,
        T: 1_299,
        i: "5m",
        o: "100",
        h: "104",
        l: "98",
        c: "103",
        v: "25",
        q: "2575",
        n: 30,
        V: "15",
      },
    },
  }, 2_000);
  assert.equal(withKline.candles.length, 1);
  assert.equal(withKline.candles[0].close, 103);
  assert.equal(withKline.ticker.lastPrice, 103);
  assert.equal(withKline.fetchedAt, 2_000);

  const withTicker = apply(withKline, "BTCUSDT", "5m", {
    stream: "btcusdt@ticker",
    data: {
      e: "24hrTicker",
      s: "BTCUSDT",
      c: "103.5",
      p: "3.5",
      P: "3.5",
      h: "105",
      l: "97",
      q: "250000",
    },
  }, 2_100);
  assert.equal(withTicker.ticker.lastPrice, 103.5);
  assert.equal(withTicker.ticker.quoteVolume, 250_000);

  const withDepth = apply(withTicker, "BTCUSDT", "5m", {
    stream: "btcusdt@depth20",
    data: {
      lastUpdateId: 10,
      bids: [["103.4", "4"], ["103.3", "5"]],
      asks: [["103.6", "6"], ["103.7", "7"]],
    },
  }, 2_200);
  assert.deepEqual(withDepth.book.bids[0], [103.4, 4]);
  assert.deepEqual(withDepth.book.asks[0], [103.6, 6]);
});

test("never promotes demo candles to live through a WebSocket frame", async (context) => {
  const loaded = await loadStreamModule();
  context.after(loaded.cleanup);
  const demo = market("demo");
  const result = loaded.module.applyBinanceStreamEvent(demo, "BTCUSDT", "5m", {
    data: {
      e: "24hrTicker",
      s: "BTCUSDT",
      c: "999",
    },
  }, 2_000);

  assert.equal(result, demo);
  assert.equal(result.source, "demo");
  assert.equal(result.ticker.lastPrice, 101);
});
