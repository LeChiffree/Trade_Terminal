import type { MarketContextPayload } from "./market-context";

export function blendDecisionScores(
  quantScore: number,
  contextScore: number | null,
  llmScore: number | null,
) {
  if (llmScore !== null && contextScore !== null) {
    return Math.round(quantScore * 0.65 + contextScore * 0.2 + llmScore * 0.15);
  }
  if (llmScore !== null) return Math.round(quantScore * 0.8 + llmScore * 0.2);
  if (contextScore !== null) return Math.round(quantScore * 0.8 + contextScore * 0.2);
  return quantScore;
}

export function decisionContextScore(
  context: MarketContextPayload | null,
  symbol: string,
) {
  if (!context || context.source === "fallback") return null;
  if (!context.global.available) return context.scores.overall;
  const dominanceDeviation = Math.min(
    15,
    Math.max(-15, context.global.btcDominance - 50),
  );
  const rotationBias = symbol.startsWith("BTC")
    ? dominanceDeviation * 1.5
    : -dominanceDeviation;
  const activityMultiplier = Math.min(
    1.15,
    Math.max(0.9, 0.85 + context.global.turnoverRate * 0.06),
  );
  return Math.round(
    Math.min(
      100,
      Math.max(
        -100,
        (context.scores.overall + rotationBias * 0.25) * activityMultiplier,
      ),
    ),
  );
}
