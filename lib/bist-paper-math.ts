export type BistPaperCandidate = {
  symbol: string;
  name: string;
  interval: string;
  score: number;
  confidence: number;
  price: number;
};

export type BistPaperMarkInput = {
  entryPrice: number;
  markPrice: number;
  quantity: number;
  capital: number;
  entryFee: number;
  entrySlippage: number;
  commissionRate: number;
  slippageRate: number;
};

export type BistPaperMarkResult = {
  exitNotional: number;
  grossPnl: number;
  exitFee: number;
  exitSlippage: number;
  netPnl: number;
  returnPercent: number;
};

export function chooseBistPaperLeaders(
  rows: BistPaperCandidate[],
): BistPaperCandidate[] {
  const strongestBySymbol = new Map<string, BistPaperCandidate>();
  for (const row of rows) {
    if (
      !row.symbol ||
      !Number.isFinite(row.score) ||
      !Number.isFinite(row.confidence) ||
      !Number.isFinite(row.price) ||
      row.price <= 0
    ) continue;
    const previous = strongestBySymbol.get(row.symbol);
    if (
      !previous ||
      row.score > previous.score ||
      (row.score === previous.score && row.confidence > previous.confidence)
    ) {
      strongestBySymbol.set(row.symbol, row);
    }
  }
  return [...strongestBySymbol.values()].sort(
    (left, right) =>
      right.score - left.score ||
      right.confidence - left.confidence ||
      left.symbol.localeCompare(right.symbol),
  );
}

export function calculateBistPaperMark(
  input: BistPaperMarkInput,
): BistPaperMarkResult {
  const exitNotional = Math.max(0, input.quantity * input.markPrice);
  const grossPnl = input.quantity * (input.markPrice - input.entryPrice);
  const exitFee = exitNotional * input.commissionRate;
  const exitSlippage = exitNotional * input.slippageRate;
  const netPnl =
    grossPnl -
    input.entryFee -
    input.entrySlippage -
    exitFee -
    exitSlippage;
  return {
    exitNotional,
    grossPnl,
    exitFee,
    exitSlippage,
    netPnl,
    returnPercent: input.capital > 0 ? (netPnl / input.capital) * 100 : 0,
  };
}

export function bistPaperCloseReason(
  currentScore: number,
  exitScore: number,
) {
  return currentScore < exitScore ? "score-normalized" : null;
}
