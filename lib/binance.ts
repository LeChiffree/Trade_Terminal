import { makeDemoMarket, type Candle, type MarketPayload } from "./analysis";

const BASE_URLS = ["https://data-api.binance.vision", "https://api.binance.com"];
const INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w"]);

export function normalizeMarketQuery(symbolValue: string | null, intervalValue: string | null) {
  const symbol = (symbolValue ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const interval = INTERVALS.has(intervalValue ?? "") ? String(intervalValue) : "15m";
  return { symbol: symbol.slice(0, 20) || "BTCUSDT", interval };
}

async function fetchJson(path: string) {
  try {
    return await Promise.any(BASE_URLS.map(async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { Accept: "application/json", "User-Agent": "QuantScope/0.1" },
        signal: AbortSignal.timeout(4_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Binance ${response.status}`);
      return await response.json();
    }));
  } catch {
    throw new Error("Market data unavailable");
  }
}

function parseCandles(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const item = row as Array<string | number>;
    return {
      openTime: Number(item[0]),
      open: Number(item[1]),
      high: Number(item[2]),
      low: Number(item[3]),
      close: Number(item[4]),
      volume: Number(item[5]),
      closeTime: Number(item[6]),
      quoteVolume: Number(item[7]),
      trades: Number(item[8]),
      takerBuyVolume: Number(item[9]),
    };
  }).filter((candle) => Number.isFinite(candle.close) && candle.close > 0);
}

export async function fetchBinanceMarket(symbol: string, interval: string, limit = 300): Promise<MarketPayload> {
  try {
    const encodedSymbol = encodeURIComponent(symbol);
    const encodedInterval = encodeURIComponent(interval);
    const [klineRows, tickerRaw, depthRaw] = await Promise.all([
      fetchJson(`/api/v3/klines?symbol=${encodedSymbol}&interval=${encodedInterval}&limit=${Math.min(500, Math.max(100, limit))}`),
      fetchJson(`/api/v3/ticker/24hr?symbol=${encodedSymbol}`),
      fetchJson(`/api/v3/depth?symbol=${encodedSymbol}&limit=20`),
    ]);
    const ticker = tickerRaw as Record<string, string>;
    const depth = depthRaw as { bids?: string[][]; asks?: string[][] };
    const candles = parseCandles(klineRows);
    if (candles.length < 50) throw new Error("Insufficient candle history");
    return {
      symbol,
      interval,
      candles,
      ticker: {
        lastPrice: Number(ticker.lastPrice),
        priceChange: Number(ticker.priceChange),
        priceChangePercent: Number(ticker.priceChangePercent),
        highPrice: Number(ticker.highPrice),
        lowPrice: Number(ticker.lowPrice),
        quoteVolume: Number(ticker.quoteVolume),
      },
      book: {
        bids: (depth.bids ?? []).map(([price, quantity]) => [Number(price), Number(quantity)] as [number, number]),
        asks: (depth.asks ?? []).map(([price, quantity]) => [Number(price), Number(quantity)] as [number, number]),
      },
      fetchedAt: Date.now(),
      source: "binance",
    };
  } catch {
    return makeDemoMarket(symbol, interval);
  }
}

export async function fetchBinanceCandles(symbol: string, interval: string, limit = 260) {
  try {
    const rows = await fetchJson(`/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`);
    return { candles: parseCandles(rows), source: "binance" as const };
  } catch {
    return { candles: makeDemoMarket(symbol, interval).candles, source: "demo" as const };
  }
}
