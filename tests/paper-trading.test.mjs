import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

async function loadPaperModule() {
  const source = await readFile(
    new URL("../lib/paper-trading.ts", import.meta.url),
    "utf8",
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  const directory = await mkdtemp(join(tmpdir(), "quantscope-paper-"));
  const modulePath = join(directory, "paper-trading.mjs");
  await writeFile(modulePath, transpiled, "utf8");
  return {
    module: await import(
      `${new URL(`file:///${modulePath.replaceAll("\\", "/")}`).href}?${Date.now()}`
    ),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("uses twenty concurrent positions for the leveraged paper portfolio", async (context) => {
  const loaded = await loadPaperModule();
  context.after(loaded.cleanup);

  assert.equal(loaded.module.PAPER_DEFAULTS.maxPositions, 20);
});

test("calculates leveraged long P/L after both-side fees, slippage and funding", async (context) => {
  const loaded = await loadPaperModule();
  context.after(loaded.cleanup);
  const result = loaded.module.calculatePaperMark({
    direction: "long",
    entryPrice: 100,
    markPrice: 102,
    quantity: 50,
    margin: 1_000,
    notional: 5_000,
    entryFee: 2.5,
    entrySlippage: 1,
    fundingPnl: -0.5,
    takerFeeRate: 0.0005,
    slippageRate: 0.0002,
  });

  assert.equal(result.grossPnl, 100);
  assert.ok(Math.abs(result.exitFee - 2.55) < 1e-9);
  assert.ok(Math.abs(result.exitSlippage - 1.02) < 1e-9);
  assert.ok(Math.abs(result.netPnl - 92.43) < 1e-9);
  assert.ok(Math.abs(result.roePercent - 9.243) < 1e-9);
});

test("calculates short profit and positive funding receipt", async (context) => {
  const loaded = await loadPaperModule();
  context.after(loaded.cleanup);
  const result = loaded.module.calculatePaperMark({
    direction: "short",
    entryPrice: 100,
    markPrice: 98,
    quantity: 50,
    margin: 1_000,
    notional: 5_000,
    entryFee: 2.5,
    entrySlippage: 1,
    fundingPnl: 0.5,
    takerFeeRate: 0.0005,
    slippageRate: 0.0002,
  });

  assert.equal(result.grossPnl, 100);
  assert.ok(Math.abs(result.netPnl - 93.57) < 1e-9);
});

test("closes on neutral score, reversal or isolated liquidation", async (context) => {
  const loaded = await loadPaperModule();
  context.after(loaded.cleanup);
  const closeReason = loaded.module.paperCloseReason;

  assert.equal(closeReason("long", 101, 80.5, 14, "long", 15), "score-normalized");
  assert.equal(closeReason("long", 101, 80.5, -32, "short", 15), "direction-reversal");
  assert.equal(closeReason("long", 80, 80.5, 45, "long", 15), "liquidation");
  assert.equal(closeReason("short", 120, 119.5, -45, "short", 15), "liquidation");
  assert.equal(closeReason("long", 105, 80.5, 30, "long", 15), null);
});
