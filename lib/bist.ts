import type { Candle, MarketPayload } from "./analysis";

export const BIST_INTERVALS = ["5m", "15m", "1h", "4h", "1d", "1w"] as const;
export type BistInterval = (typeof BIST_INTERVALS)[number];

export const BIST_FALLBACK_SYMBOLS = [
  "THYAO", "ASELS", "AKBNK", "TUPRS", "YKBNK", "EREGL", "ASTOR", "ISCTR",
  "GARAN", "BIMAS", "KCHOL", "SAHOL", "SISE", "FROTO", "PGSUS", "TCELL",
  "PETKM", "EKGYO", "SASA", "MGROS", "TOASO", "TAVHL", "TTKOM", "ENKAI",
  "KRDMD", "OYAKC", "GUBRF", "AEFES", "ARCLK", "CCOLA", "DOAS", "TSKB",
  "VAKBN", "ULKER", "ENJSA", "AKSEN", "TTRAK", "TKFEN", "MAVI", "ALARK",
  "CIMSA", "BRSAN", "MPARK", "KOZAL", "KOZAA", "HEKTS", "SOKM", "VESTL",
  "ZOREN", "HALKB", "ISGYO", "ANSGR", "ANHYT", "AGHOL", "AKFYE", "ALFAS",
  "BERA", "BUCIM", "CANTE", "CWENE", "ECILC", "EGEEN", "ENERY", "GENIL",
  "GOLTS", "GWIND", "KARSN", "KCAER", "KLSER", "KONTR", "KMPUR", "MIATK",
  "OTKAR", "QUAGR", "REEDR", "SDTTR", "SMRTG", "TABGD", "TURSG", "BTCIM",
] as const;

export type BistSymbol = {
  symbol: string;
  name: string;
  lastPrice: number;
  priceChangePercent: number;
  volume: number;
  turnover: number;
  marketCap: number;
  sector: string;
  score: number;
  confidence: number;
  direction: "long" | "short" | "neutral" | "unavailable";
};

export type BistDirectory = {
  symbols: BistSymbol[];
  source: "tradingview" | "fallback";
  interval: BistInterval;
  fetchedAt: number;
  delayedMinutes: number;
};

export type BistMarketPayload = MarketPayload & {
  source: "bist";
  name: string;
  currency: "TRY";
  exchange: "BIST";
  provider: "Yahoo Finance";
  delayedMinutes: number;
};

type TechnicalInputs = {
  recommend: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  close: number;
  ema20: number | null;
  ema50: number | null;
  sma200: number | null;
  change: number;
  relativeVolume: number | null;
  adx: number | null;
  plusDi: number | null;
  minusDi: number | null;
};

type BistScoreFamily = "Trend" | "Momentum" | "Hacim" | "Yapı";

const BIST_SCORING_WEIGHTS: Record<BistScoreFamily, number> = {
  Trend: 0.30,
  Momentum: 0.22,
  Hacim: 0.20,
  Yapı: 0.12,
};

const INTERVAL_SET = new Set<string>(BIST_INTERVALS);
const TRADINGVIEW_SUFFIX: Record<BistInterval, string> = {
  "5m": "|5",
  "15m": "|15",
  "1h": "|60",
  "4h": "|240",
  "1d": "",
  "1w": "|1W",
};
const YAHOO_QUERY: Record<BistInterval, { interval: string; range: string }> = {
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "60m", range: "3mo" },
  "4h": { interval: "60m", range: "6mo" },
  "1d": { interval: "1d", range: "2y" },
  "1w": { interval: "1wk", range: "5y" },
};
const INTERVAL_MILLISECONDS: Record<BistInterval, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

const directoryCache = new Map<
  BistInterval,
  { expiresAt: number; value: BistDirectory }
>();
const marketCache = new Map<
  string,
  { expiresAt: number; value: BistMarketPayload }
>();

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteOr(value: unknown, fallback = 0) {
  return finite(value) ?? fallback;
}

export function normalizeBistQuery(
  symbolValue: string | null,
  intervalValue: string | null,
) {
  const sanitized = (symbolValue ?? "THYAO")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const interval = INTERVAL_SET.has(intervalValue ?? "")
    ? String(intervalValue) as BistInterval
    : "15m";
  return {
    symbol: /^[A-Z0-9]{2,8}$/.test(sanitized) ? sanitized : "THYAO",
    interval,
  };
}

export function scoreBistTechnical(input: TechnicalInputs) {
  const relative = (left: number, right: number | null, scalePercent: number) =>
    right === null || right === 0
      ? null
      : clamp((((left - right) / Math.abs(right)) * 100) / scalePercent, -1, 1);
  const averageAvailable = (values: Array<number | null>) => {
    const available = values.filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );
    return available.length
      ? available.reduce((total, value) => total + value, 0) / available.length
      : null;
  };

  // Correlated moving-average signals are averaged inside one Trend family.
  // TradingView Recommend.All is deliberately excluded from the raw score
  // because it already contains EMA, RSI and MACD evidence; adding it again
  // was the main source of inflated BIST scores.
  const trend = averageAvailable([
    relative(input.close, input.ema20, 4),
    input.ema20 === null ? null : relative(input.ema20, input.ema50, 5),
    input.ema50 === null ? null : relative(input.ema50, input.sma200, 9),
  ]);
  const momentum = averageAvailable([
    input.rsi === null ? null : clamp((input.rsi - 50) / 22, -1, 1),
    input.macd === null || input.macdSignal === null || input.close === 0
      ? null
      : clamp(
          (input.macd - input.macdSignal) / (Math.abs(input.close) * 0.008),
          -1,
          1,
        ),
  ]);
  const priceAction = clamp(input.change / 3.5, -1, 1);
  const volume = input.relativeVolume === null
    ? null
    : priceAction * clamp(input.relativeVolume / 1.5, 0, 1);
  const structure =
    input.adx === null || input.plusDi === null || input.minusDi === null
      ? null
      : clamp((input.plusDi - input.minusDi) / 25, -1, 1) *
        clamp((input.adx - 15) / 20, 0, 1);

  const familyScores: Partial<Record<BistScoreFamily, number>> = {
    ...(trend === null ? {} : { Trend: trend * 100 }),
    ...(momentum === null ? {} : { Momentum: momentum * 100 }),
    ...(volume === null ? {} : { Hacim: volume * 100 }),
    ...(structure === null ? {} : { Yapı: structure * 100 }),
  };
  const availableFamilies = Object.entries(familyScores) as Array<
    [BistScoreFamily, number]
  >;
  const rawScore = availableFamilies.reduce(
    (total, [family, value]) => total + value * BIST_SCORING_WEIGHTS[family],
    0,
  );
  const rawDirection = Math.sign(rawScore);
  const activeFamilies = availableFamilies.filter(
    ([, value]) => Math.abs(value) >= 12,
  );
  const confirmingFamilies = activeFamilies.filter(
    ([, value]) => Math.sign(value) === rawDirection,
  );
  const opposingFamilies = activeFamilies.filter(
    ([, value]) => Math.sign(value) === -rawDirection,
  );

  // Match the crypto scorer's evidence ladder: one active family cannot
  // create a paper-trade score by itself. Higher ranges require independent
  // families to agree, and Trend must participate for scores above 48.
  let evidenceCap = 22;
  if (confirmingFamilies.length >= 2) evidenceCap = 42;
  if (confirmingFamilies.length >= 3) evidenceCap = 58;
  if (confirmingFamilies.length >= 4) evidenceCap = 85;
  if (!confirmingFamilies.some(([family]) => family === "Trend")) {
    evidenceCap = Math.min(evidenceCap, 48);
  }
  if (opposingFamilies.length >= 2) evidenceCap = Math.min(evidenceCap, 48);

  const roundedScore = Math.round(
    rawDirection * Math.min(Math.abs(rawScore), evidenceCap),
  );
  const activeStrength = activeFamilies.reduce(
    (total, [, value]) => total + Math.abs(value),
    0,
  );
  const matchingStrength = confirmingFamilies.reduce(
    (total, [, value]) => total + Math.abs(value),
    0,
  );
  const agreement = activeStrength ? matchingStrength / activeStrength : 0.5;
  const coverage = availableFamilies.length / 4;
  const recommend = input.recommend === null
    ? 0
    : clamp(input.recommend, -1, 1);
  const recommendAdjustment =
    rawDirection === 0 || Math.abs(recommend) < 0.08
      ? 0
      : Math.sign(recommend) === rawDirection
        ? 3
        : -5;
  const confidence = availableFamilies.length
    ? Math.round(
        clamp(
          32 +
            Math.abs(roundedScore) * 0.38 +
            confirmingFamilies.length * 5 +
            agreement * 12 -
            opposingFamilies.length * 5 +
            coverage * 4 +
            recommendAdjustment,
          32,
          92,
        ),
      )
    : 0;
  const direction =
    roundedScore >= 20
      ? "long"
      : roundedScore <= -20
        ? "short"
        : "neutral";
  return { score: roundedScore, confidence, direction } as const;
}

function fallbackDirectory(interval: BistInterval): BistDirectory {
  return {
    symbols: BIST_FALLBACK_SYMBOLS.map((symbol) => ({
      symbol,
      name: symbol,
      lastPrice: 0,
      priceChangePercent: 0,
      volume: 0,
      turnover: 0,
      marketCap: 0,
      sector: "Veri bekleniyor",
      score: 0,
      confidence: 0,
      direction: "unavailable",
    })),
    source: "fallback",
    interval,
    fetchedAt: Date.now(),
    delayedMinutes: 15,
  };
}

export async function fetchTopBistSymbols(
  interval: BistInterval,
  limit = 80,
): Promise<BistDirectory> {
  const requestedLimit = Math.min(80, Math.max(1, Math.trunc(limit)));
  const cached = directoryCache.get(interval);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.value,
      symbols: cached.value.symbols.slice(0, requestedLimit),
    };
  }

  const suffix = TRADINGVIEW_SUFFIX[interval];
  const columns = [
    "name",
    "description",
    "close",
    "change",
    "volume",
    "Value.Traded",
    "market_cap_basic",
    "sector",
    `Recommend.All${suffix}`,
    `RSI${suffix}`,
    `MACD.macd${suffix}`,
    `MACD.signal${suffix}`,
    `EMA20${suffix}`,
    `EMA50${suffix}`,
    `SMA200${suffix}`,
    "relative_volume_10d_calc",
    `ADX${suffix}`,
    `ADX+DI${suffix}`,
    `ADX-DI${suffix}`,
  ];
  try {
    const response = await fetch("https://scanner.tradingview.com/turkey/scan", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "QuantScope/0.2",
      },
      body: JSON.stringify({
        filter: [
          { left: "exchange", operation: "equal", right: "BIST" },
          { left: "type", operation: "equal", right: "stock" },
        ],
        options: { lang: "tr" },
        markets: ["turkey"],
        symbols: { query: { types: [] }, tickers: [] },
        columns,
        sort: { sortBy: "Value.Traded", sortOrder: "desc" },
        range: [0, 80],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`BIST directory ${response.status}`);
    const payload = await response.json() as {
      data?: Array<{ s?: unknown; d?: unknown[] }>;
    };
    const seen = new Set<string>();
    const symbols = (payload.data ?? []).flatMap((row): BistSymbol[] => {
      const values = Array.isArray(row.d) ? row.d : [];
      const symbol = String(values[0] ?? row.s ?? "")
        .replace(/^BIST:/, "")
        .toUpperCase();
      const close = finiteOr(values[2]);
      const turnover = finiteOr(values[5]);
      if (
        !/^[A-Z0-9]{2,8}$/.test(symbol) ||
        seen.has(symbol) ||
        close <= 0 ||
        turnover <= 0
      ) return [];
      seen.add(symbol);
      const technical = scoreBistTechnical({
        recommend: finite(values[8]),
        rsi: finite(values[9]),
        macd: finite(values[10]),
        macdSignal: finite(values[11]),
        close,
        ema20: finite(values[12]),
        ema50: finite(values[13]),
        sma200: finite(values[14]),
        change: finiteOr(values[3]),
        relativeVolume: finite(values[15]),
        adx: finite(values[16]),
        plusDi: finite(values[17]),
        minusDi: finite(values[18]),
      });
      return [{
        symbol,
        name: String(values[1] ?? symbol).slice(0, 120),
        lastPrice: close,
        priceChangePercent: finiteOr(values[3]),
        volume: finiteOr(values[4]),
        turnover,
        marketCap: finiteOr(values[6]),
        sector: String(values[7] ?? "Diğer").slice(0, 80),
        ...technical,
      }];
    }).slice(0, 80);
    if (symbols.length !== 80) throw new Error("BIST top 80 incomplete");
    const value: BistDirectory = {
      symbols,
      source: "tradingview",
      interval,
      fetchedAt: Date.now(),
      delayedMinutes: 15,
    };
    directoryCache.set(interval, {
      expiresAt: Date.now() + 60_000,
      value,
    });
    return { ...value, symbols: value.symbols.slice(0, requestedLimit) };
  } catch {
    const fallback = fallbackDirectory(interval);
    return { ...fallback, symbols: fallback.symbols.slice(0, requestedLimit) };
  }
}

function parseYahooCandles(
  timestamps: unknown,
  quote: Record<string, unknown>,
  interval: BistInterval,
) {
  if (!Array.isArray(timestamps)) return [];
  const open = Array.isArray(quote.open) ? quote.open : [];
  const high = Array.isArray(quote.high) ? quote.high : [];
  const low = Array.isArray(quote.low) ? quote.low : [];
  const close = Array.isArray(quote.close) ? quote.close : [];
  const volume = Array.isArray(quote.volume) ? quote.volume : [];
  const duration = INTERVAL_MILLISECONDS[interval === "4h" ? "1h" : interval];
  return timestamps.flatMap((timestamp, index): Candle[] => {
    const openTime = finiteOr(timestamp) * 1_000;
    const values = {
      open: finite(open[index]),
      high: finite(high[index]),
      low: finite(low[index]),
      close: finite(close[index]),
      volume: finite(volume[index]) ?? 0,
    };
    if (
      !openTime ||
      values.open === null ||
      values.high === null ||
      values.low === null ||
      values.close === null ||
      values.open <= 0 ||
      values.close <= 0 ||
      values.high < values.low
    ) return [];
    return [{
      openTime,
      closeTime: openTime + duration - 1,
      open: values.open,
      high: values.high,
      low: values.low,
      close: values.close,
      volume: values.volume,
      quoteVolume: values.volume * values.close,
      trades: 0,
      takerBuyVolume: values.volume / 2,
    }];
  });
}

function tradingDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function aggregateFourHourCandles(candles: Candle[]) {
  const days = new Map<string, Candle[]>();
  for (const candle of candles) {
    const key = tradingDate(candle.openTime);
    const rows = days.get(key) ?? [];
    rows.push(candle);
    days.set(key, rows);
  }
  const aggregated: Candle[] = [];
  for (const rows of days.values()) {
    for (let index = 0; index < rows.length; index += 4) {
      const group = rows.slice(index, index + 4);
      const first = group[0];
      const last = group.at(-1);
      if (!first || !last) continue;
      aggregated.push({
        openTime: first.openTime,
        closeTime: last.closeTime,
        open: first.open,
        high: Math.max(...group.map((item) => item.high)),
        low: Math.min(...group.map((item) => item.low)),
        close: last.close,
        volume: group.reduce((sum, item) => sum + item.volume, 0),
        quoteVolume: group.reduce((sum, item) => sum + item.quoteVolume, 0),
        trades: 0,
        takerBuyVolume: group.reduce(
          (sum, item) => sum + item.takerBuyVolume,
          0,
        ),
      });
    }
  }
  return aggregated;
}

export async function fetchBistMarket(
  symbol: string,
  interval: BistInterval,
): Promise<BistMarketPayload> {
  const cacheKey = `${symbol}:${interval}`;
  const cached = marketCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const query = YAHOO_QUERY[interval];
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.IS`,
  );
  url.searchParams.set("interval", query.interval);
  url.searchParams.set("range", query.range);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "QuantScope/0.2",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`BIST market ${response.status}`);
  const body = await response.json() as {
    chart?: {
      error?: unknown;
      result?: Array<{
        meta?: Record<string, unknown>;
        timestamp?: unknown;
        indicators?: { quote?: Array<Record<string, unknown>> };
      }>;
    };
  };
  if (body.chart?.error) throw new Error("BIST market provider error");
  const result = body.chart?.result?.[0];
  const meta = result?.meta ?? {};
  const quote = result?.indicators?.quote?.[0] ?? {};
  let candles = parseYahooCandles(result?.timestamp, quote, interval);
  if (interval === "4h") candles = aggregateFourHourCandles(candles);
  candles = candles.slice(-320);
  if (candles.length < 50) throw new Error("BIST candle history incomplete");

  const last = candles.at(-1)!;
  const previousClose = finiteOr(
    meta.chartPreviousClose ?? meta.previousClose,
    candles.at(-2)?.close ?? last.close,
  );
  const lastPrice = finiteOr(meta.regularMarketPrice, last.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const priceChange = lastPrice - previousClose;
  const value: BistMarketPayload = {
    symbol,
    interval,
    candles,
    ticker: {
      lastPrice,
      priceChange,
      priceChangePercent: previousClose ? (priceChange / previousClose) * 100 : 0,
      highPrice: finiteOr(meta.regularMarketDayHigh, Math.max(...highs.slice(-20))),
      lowPrice: finiteOr(meta.regularMarketDayLow, Math.min(...lows.slice(-20))),
      quoteVolume: finiteOr(meta.regularMarketVolume, last.volume) * lastPrice,
    },
    book: { bids: [], asks: [] },
    fetchedAt: Date.now(),
    source: "bist",
    name: String(meta.longName ?? meta.shortName ?? symbol).slice(0, 120),
    currency: "TRY",
    exchange: "BIST",
    provider: "Yahoo Finance",
    delayedMinutes: 15,
  };
  marketCache.set(cacheKey, {
    expiresAt: Date.now() + 30_000,
    value,
  });
  return value;
}
