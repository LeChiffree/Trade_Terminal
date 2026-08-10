import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

async function loadModule() {
  const source = await readFile(
    new URL("../lib/binance-demo-futures.ts", import.meta.url),
    "utf8",
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  const directory = await mkdtemp(join(tmpdir(), "quantscope-binance-demo-"));
  const modulePath = join(directory, "binance-demo-futures.mjs");
  await writeFile(modulePath, transpiled, "utf8");
  return {
    module: await import(
      `${new URL(`file:///${modulePath.replaceAll("\\", "/")}`).href}?${Date.now()}`
    ),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("hard-locks order routing to Binance Futures Demo", async (context) => {
  const loaded = await loadModule();
  context.after(loaded.cleanup);

  assert.equal(loaded.module.BINANCE_DEMO_REQUEST_TIMEOUT_MS, 8_000);
  assert.equal(
    loaded.module.assertBinanceDemoBaseUrl("https://demo-fapi.binance.com"),
    "https://demo-fapi.binance.com",
  );
  assert.throws(
    () => loaded.module.assertBinanceDemoBaseUrl("https://fapi.binance.com"),
    /yalnızca demo-fapi\.binance\.com/,
  );
  assert.throws(
    () => loaded.module.assertBinanceDemoBaseUrl("https://demo-fapi.binance.com/evil"),
    /yalnızca demo-fapi\.binance\.com/,
  );
});

test("rounds market quantities down to the exchange step", async (context) => {
  const loaded = await loadModule();
  context.after(loaded.cleanup);

  assert.equal(loaded.module.floorToStep(12.987, "0.01"), "12.98");
  assert.equal(loaded.module.floorToStep(10.9, "1"), "10");
  assert.equal(
    loaded.module.marketQuantity(125, 10, {
      symbol: "TESTUSDT",
      filters: [
        {
          filterType: "MARKET_LOT_SIZE",
          minQty: "0.01",
          maxQty: "1000",
          stepSize: "0.01",
        },
        { filterType: "MIN_NOTIONAL", notional: "5" },
      ],
    }),
    "12.5",
  );
});

test("rejects unsafe or nonsensical demo margin configuration", async (context) => {
  const loaded = await loadModule();
  context.after(loaded.cleanup);

  assert.equal(loaded.module.parseDemoMarginUsdt("25"), 25);
  assert.throws(() => loaded.module.parseDemoMarginUsdt("0"));
  assert.throws(() => loaded.module.parseDemoMarginUsdt("10001"));
});
