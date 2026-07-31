import { makeDemoMarket, type Candle, type MarketPayload } from "./analysis";

const BASE_URLS = ["https://data-api.binance.vision", "https://api.binance.com"];
const INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "3d", "1w"]);
const STABLE_ASSETS = new Set([
  "USDT", "USDC", "FDUSD", "TUSD", "USDP", "DAI", "USDE", "USD1", "PYUSD",
  "EURC", "AEUR", "EURI", "RLUSD", "BUSD", "USTC", "USDJ", "XUSD", "GUSD",
  "LUSD", "FRAX", "EURT",
]);

const FALLBACK_BASE_ASSETS = [
  "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "TRX", "AVAX", "SHIB",
  "LINK", "DOT", "BCH", "NEAR", "LTC", "APT", "UNI", "ETC", "ICP", "FIL",
  "HBAR", "ATOM", "ARB", "OP", "SUI", "INJ", "IMX", "AAVE", "MKR", "PEPE",
  "WIF", "TAO", "FET", "RENDER", "SEI", "TIA", "ALGO", "VET", "GRT", "THETA",
  "JASMY", "BONK", "FLOKI", "ENA", "PENDLE", "RUNE", "STX", "LDO", "CRV", "SAND",
];

export type MarketSymbol = {
  symbol: string;
  baseAsset: string;
  quoteAsset: "USDT";
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
};

export type MarketSymbolDirectory = {
  symbols: MarketSymbol[];
  source: "binance" | "fallback";
  fetchedAt: number;
};

let symbolDirectoryCache: { expiresAt: number; value: MarketSymbolDirectory } | null = null;

export function normalizeMarketQuery(symbolValue: string | null, intervalValue: string | null) {
  const symbol = (symbolValue ?? "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const interval = INTERVALS.has(intervalValue ?? "") ? String(intervalValue) : "15m";
  return { symbol: symbol.slice(0, 20) || "BTCUSDT", interval };
}

async function fetchJson(path: string) {
  for (const baseUrl of BASE_URLS) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { Accept: "application/json", "User-Agent": "QuantScope/0.1" },
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Binance ${response.status}`);
      return await response.json();
    } catch {
      // Try the next official Binance market-data endpoint.
    }
  }
  throw new Error("Market data unavailable");
}

function parseCandles(rows: unknown, now = Date.now()): Candle[] {
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
  }).filter((candle) =>
    Number.isFinite(candle.openTime) &&
    Number.isFinite(candle.closeTime) &&
    candle.closeTime < now &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) &&
    candle.open > 0 &&
    candle.high >= candle.low &&
    candle.close > 0
  );
}

function finiteOr(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fallbackSymbolDirectory(): MarketSymbolDirectory {
  return {
    symbols: FALLBACK_BASE_ASSETS.map((baseAsset) => ({
      symbol: `${baseAsset}USDT`,
      baseAsset,
      quoteAsset: "USDT",
      lastPrice: 0,
      priceChangePercent: 0,
      quoteVolume: 0,
    })),
    source: "fallback",
    fetchedAt: Date.now(),
  };
}

function isLeveragedToken(baseAsset: string) {
  return ["UP", "DOWN", "BULL", "BEAR"].some((suffix) =>
    baseAsset.endsWith(suffix) && baseAsset.length - suffix.length >= 3
  );
}

export async function fetchTopBinanceSymbols(limit = 50): Promise<MarketSymbolDirectory> {
  const requestedLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  if (symbolDirectoryCache && symbolDirectoryCache.expiresAt > Date.now()) {
    return {
      ...symbolDirectoryCache.value,
      symbols: symbolDirectoryCache.value.symbols.slice(0, requestedLimit),
    };
  }

  try {
    const [exchangeRaw, tickersRaw] = await Promise.all([
      fetchJson("/api/v3/exchangeInfo"),
      fetchJson("/api/v3/ticker/24hr"),
    ]);
    const exchange = exchangeRaw as {
      symbols?: Array<{
        symbol?: unknown;
        status?: unknown;
        baseAsset?: unknown;
        quoteAsset?: unknown;
        isSpotTradingAllowed?: unknown;
      }>;
    };
    const tickerBySymbol = new Map<string, Record<string, unknown>>();
    if (Array.isArray(tickersRaw)) {
      for (const item of tickersRaw) {
        if (!item || typeof item !== "object") continue;
        const ticker = item as Record<string, unknown>;
        const tickerSymbol = String(ticker.symbol ?? "");
        if (tickerSymbol) tickerBySymbol.set(tickerSymbol, ticker);
      }
    }

    const symbols = (exchange.symbols ?? []).flatMap((item): MarketSymbol[] => {
      const symbol = String(item.symbol ?? "");
      const baseAsset = String(item.baseAsset ?? "");
      const quoteAsset = String(item.quoteAsset ?? "");
      const ticker = tickerBySymbol.get(symbol);
      if (
        item.status !== "TRADING" ||
        item.isSpotTradingAllowed === false ||
        quoteAsset !== "USDT" ||
        !ticker ||
        STABLE_ASSETS.has(baseAsset) ||
        isLeveragedToken(baseAsset)
      ) return [];
      const quoteVolume = finiteOr(ticker.quoteVolume, 0);
      if (quoteVolume <= 0) return [];
      return [{
        symbol,
        baseAsset,
        quoteAsset: "USDT",
        lastPrice: finiteOr(ticker.lastPrice, 0),
        priceChangePercent: finiteOr(ticker.priceChangePercent, 0),
        quoteVolume,
      }];
    }).sort((left, right) => right.quoteVolume - left.quoteVolume).slice(0, 50);

    if (symbols.length < requestedLimit) throw new Error("Insufficient symbol directory");
    const value: MarketSymbolDirectory = {
      symbols,
      source: "binance",
      fetchedAt: Date.now(),
    };
    symbolDirectoryCache = { expiresAt: Date.now() + 5 * 60_000, value };
    return { ...value, symbols: symbols.slice(0, requestedLimit) };
  } catch {
    const value = fallbackSymbolDirectory();
    symbolDirectoryCache = { expiresAt: Date.now() + 60_000, value };
    return { ...value, symbols: value.symbols.slice(0, requestedLimit) };
  }
}

function parseBookSide(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): [number, number][] => {
    if (!Array.isArray(row)) return [];
    const price = Number(row[0]);
    const quantity = Number(row[1]);
    return Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity >= 0
      ? [[price, quantity]]
      : [];
  });
}

export async function fetchBinanceMarket(symbol: string, interval: string, limit = 300): Promise<MarketPayload> {
  try {
    const encodedSymbol = encodeURIComponent(symbol);
    const encodedInterval = encodeURIComponent(interval);
    const requestedLimit = Math.min(499, Math.max(100, Math.trunc(limit)));
    const [klineRows, tickerRaw, depthRaw] = await Promise.all([
      fetchJson(`/api/v3/klines?symbol=${encodedSymbol}&interval=${encodedInterval}&limit=${requestedLimit + 1}`),
      fetchJson(`/api/v3/ticker/24hr?symbol=${encodedSymbol}`),
      fetchJson(`/api/v3/depth?symbol=${encodedSymbol}&limit=20`),
    ]);
    const ticker = tickerRaw as Record<string, string>;
    const depth = depthRaw as { bids?: unknown; asks?: unknown };
    const candles = parseCandles(klineRows).slice(-requestedLimit);
    if (candles.length < 50) throw new Error("Insufficient candle history");
    const lastClose = candles.at(-1)?.close ?? 0;
    const bids = parseBookSide(depth.bids);
    const asks = parseBookSide(depth.asks);
    return {
      symbol,
      interval,
      candles,
      ticker: {
        lastPrice: finiteOr(ticker.lastPrice, lastClose),
        priceChange: finiteOr(ticker.priceChange, 0),
        priceChangePercent: finiteOr(ticker.priceChangePercent, 0),
        highPrice: finiteOr(ticker.highPrice, lastClose),
        lowPrice: finiteOr(ticker.lowPrice, lastClose),
        quoteVolume: finiteOr(ticker.quoteVolume, 0),
      },
      book: { bids, asks },
      fetchedAt: Date.now(),
      source: "binance",
    };
  } catch {
    return makeDemoMarket(symbol, interval);
  }
}

export async function fetchBinanceCandles(symbol: string, interval: string, limit = 260) {
  try {
    const requestedLimit = Math.min(499, Math.max(50, Math.trunc(limit)));
    const rows = await fetchJson(`/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${requestedLimit + 1}`);
    const candles = parseCandles(rows).slice(-requestedLimit);
    if (candles.length < 50) throw new Error("Insufficient candle history");
    return { candles, source: "binance" as const };
  } catch {
    return { candles: makeDemoMarket(symbol, interval).candles, source: "demo" as const };
  }
}
