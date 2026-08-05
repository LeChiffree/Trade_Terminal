import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

async function loadMathModule() {
  const source = await readFile(
    new URL("../lib/bist-paper-math.ts", import.meta.url),
    "utf8",
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  const directory = await mkdtemp(join(tmpdir(), "quantscope-bist-paper-"));
  const modulePath = join(directory, "bist-paper-math.mjs");
  await writeFile(modulePath, transpiled, "utf8");
  return {
    module: await import(
      `${new URL(`file:///${modulePath.replaceAll("\\", "/")}`).href}?${Date.now()}`
    ),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("selects one strongest timeframe per BIST symbol and ranks descending", async (context) => {
  const loaded = await loadMathModule();
  context.after(loaded.cleanup);
  const leaders = loaded.module.chooseBistPaperLeaders([
    { symbol: "THYAO", name: "Türk Hava Yolları", interval: "5m", score: 42, confidence: 78, price: 312 },
    { symbol: "THYAO", name: "Türk Hava Yolları", interval: "1h", score: 61, confidence: 81, price: 312 },
    { symbol: "ASELS", name: "Aselsan", interval: "15m", score: 58, confidence: 86, price: 190 },
    { symbol: "BAD", name: "Bad", interval: "1h", score: 99, confidence: 99, price: 0 },
  ]);

  assert.deepEqual(
    leaders.map(({ symbol, interval, score }) => ({ symbol, interval, score })),
    [
      { symbol: "THYAO", interval: "1h", score: 61 },
      { symbol: "ASELS", interval: "15m", score: 58 },
    ],
  );
});

test("calculates long-only net P/L after both-side commission and slippage", async (context) => {
  const loaded = await loadMathModule();
  context.after(loaded.cleanup);
  const mark = loaded.module.calculateBistPaperMark({
    entryPrice: 100,
    markPrice: 110,
    quantity: 10,
    capital: 1_000,
    entryFee: 0.5,
    entrySlippage: 0.2,
    commissionRate: 0.0005,
    slippageRate: 0.0002,
  });

  assert.equal(mark.grossPnl, 100);
  assert.ok(Math.abs(mark.exitFee - 0.55) < 1e-9);
  assert.ok(Math.abs(mark.exitSlippage - 0.22) < 1e-9);
  assert.ok(Math.abs(mark.netPnl - 98.53) < 1e-9);
  assert.ok(Math.abs(mark.returnPercent - 9.853) < 1e-9);
});

test("closes a BIST paper position only below the normalization threshold", async (context) => {
  const loaded = await loadMathModule();
  context.after(loaded.cleanup);
  assert.equal(
    loaded.module.bistPaperCloseReason(14, 15),
    "score-normalized",
  );
  assert.equal(loaded.module.bistPaperCloseReason(15, 15), null);
  assert.equal(loaded.module.bistPaperCloseReason(44, 15), null);
});
