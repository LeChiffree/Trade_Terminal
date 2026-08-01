import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

async function loadAnalysisModule() {
  const source = await readFile(new URL("../lib/analysis.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  const directory = await mkdtemp(join(tmpdir(), "quantscope-analysis-"));
  const modulePath = join(directory, "analysis.mjs");
  await writeFile(modulePath, transpiled, "utf8");
  return {
    module: await import(`${new URL(`file:///${modulePath.replaceAll("\\", "/")}`).href}?${Date.now()}`),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function candlesFromLevels(levels) {
  const start = Date.now() - (levels.length + 5) * 60_000;
  return levels.map((level, index) => ({
    openTime: start + index * 60_000,
    closeTime: start + (index + 1) * 60_000 - 1,
    open: level,
    high: level + .2,
    low: level - .2,
    close: level,
    volume: 1_000 + index * 3,
    quoteVolume: level * (1_000 + index * 3),
    trades: 500 + index,
    takerBuyVolume: 500 + index,
  }));
}

function risingSwingLevels(step) {
  return Array.from({ length: 25 }, (_, cycle) => {
    const base = 100 + cycle * step;
    return [base, base + 2, base + 4, base + 2];
  }).flat();
}

function fallingSwingLevels(step) {
  return Array.from({ length: 25 }, (_, cycle) => {
    const base = 140 - cycle * step;
    return [base, base - 2, base - 4, base - 2];
  }).flat();
}

test("market structure requires ATR-sized, confirmed swing movement", async (context) => {
  const loaded = await loadAnalysisModule();
  context.after(loaded.cleanup);

  const bullish = loaded.module.evaluateMarketStructure(candlesFromLevels(risingSwingLevels(1.2)), 2.5);
  const bearish = loaded.module.evaluateMarketStructure(candlesFromLevels(fallingSwingLevels(1.2)), 2.5);
  const shallow = loaded.module.evaluateMarketStructure(candlesFromLevels(risingSwingLevels(.01)), 2.5);

  assert.equal(bullish.state, "HH / HL");
  assert.ok(bullish.score >= 14 && bullish.score <= 38);
  assert.equal(bearish.state, "LH / LL");
  assert.ok(bearish.score <= -14 && bearish.score >= -38);
  assert.match(shallow.state, /^Teyitsiz /);
  assert.ok(Math.abs(shallow.score) <= 10);
});

test("a single structure label cannot create a strong quant signal", async (context) => {
  const loaded = await loadAnalysisModule();
  context.after(loaded.cleanup);

  const structureOnly = loaded.module.calibrateQuantScore({
    Trend: 0,
    Momentum: 0,
    Hacim: 0,
    Yapı: 100,
    "Mikro yapı": 0,
    İstatistik: 0,
  });
  const independentAgreement = loaded.module.calibrateQuantScore({
    Trend: 80,
    Momentum: 80,
    Hacim: 80,
    Yapı: 80,
    "Mikro yapı": 0,
    İstatistik: 0,
  });

  assert.equal(structureOnly.score, 12);
  assert.ok(independentAgreement.score >= 55);
  assert.deepEqual(independentAgreement.confirmingFamilies, ["Trend", "Momentum", "Hacim", "Yapı"]);
});

test("demo analyses keep structure, quant and confidence inside calibrated bounds", async (context) => {
  const loaded = await loadAnalysisModule();
  context.after(loaded.cleanup);

  for (const symbol of ["BTCUSDT", "ETHUSDT", "DOGEUSDT", "SOLUSDT"]) {
    for (const interval of ["5m", "15m", "1h", "4h", "1d", "1w"]) {
      const analysis = loaded.module.analyzeMarket(loaded.module.makeDemoMarket(symbol, interval));
      const structure = analysis.indicators.find((item) => item.id === "market_structure");
      assert.ok(structure);
      assert.ok(Math.abs(structure.score) <= 38);
      assert.ok(Math.abs(analysis.quantScore) <= 85);
      assert.ok(analysis.confidence >= 32 && analysis.confidence <= 92);
    }
  }
});
