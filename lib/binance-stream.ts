import type { Candle, MarketPayload } from "./analysis";

export type BinanceStreamStatus = "connecting" | "live" | "reconnecting" | "offline";

type StreamEnvelope = {
  stream?: unknown;
  data?: unknown;
};

type StreamCallbacks = {
  onMarketUpdate: (updater: (current: MarketPayload) => MarketPayload) => void;
  onStatus: (status: BinanceStreamStatus) => void;
};

const STREAM_ENDPOINTS = [
  "wss://stream.binance.com:9443",
  "wss://stream.binance.com:443",
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function bookSide(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): [number, number][] => {
    if (!Array.isArray(row)) return [];
    const price = finiteNumber(row[0]);
    const quantity = finiteNumber(row[1], -1);
    return price > 0 && quantity >= 0 ? [[price, quantity]] : [];
  }).slice(0, 20);
}

function streamCandle(value: unknown): Candle | null {
  const kline = record(value);
  if (!kline) return null;
  const candle = {
    openTime: finiteNumber(kline.t),
    closeTime: finiteNumber(kline.T),
    open: finiteNumber(kline.o),
    high: finiteNumber(kline.h),
    low: finiteNumber(kline.l),
    close: finiteNumber(kline.c),
    volume: finiteNumber(kline.v),
    quoteVolume: finiteNumber(kline.q),
    trades: finiteNumber(kline.n),
    takerBuyVolume: finiteNumber(kline.V),
  };
  return candle.openTime > 0 &&
    candle.closeTime >= candle.openTime &&
    candle.open > 0 &&
    candle.high >= candle.low &&
    candle.close > 0
    ? candle
    : null;
}

function upsertCandle(candles: Candle[], candle: Candle) {
  const existingIndex = candles.findIndex((item) => item.openTime === candle.openTime);
  if (existingIndex >= 0) {
    const next = [...candles];
    next[existingIndex] = candle;
    return next;
  }
  if (!candles.length || candle.openTime > candles.at(-1)!.openTime) {
    return [...candles, candle].slice(-300);
  }
  return candles;
}

export function applyBinanceStreamEvent(
  current: MarketPayload,
  expectedSymbol: string,
  expectedInterval: string,
  envelopeValue: unknown,
  receivedAt = Date.now(),
): MarketPayload {
  if (
    current.source !== "binance" ||
    current.symbol !== expectedSymbol ||
    current.interval !== expectedInterval
  ) {
    return current;
  }

  const envelope = record(envelopeValue) as StreamEnvelope | null;
  const data = record(envelope?.data);
  if (!data) return current;
  const eventSymbol = String(data.s ?? expectedSymbol).toUpperCase();
  if (eventSymbol !== expectedSymbol) return current;

  if (data.e === "kline") {
    const kline = record(data.k);
    if (String(kline?.i ?? "") !== expectedInterval) return current;
    const candle = streamCandle(kline);
    if (!candle) return current;
    return {
      ...current,
      candles: upsertCandle(current.candles, candle),
      ticker: {
        ...current.ticker,
        lastPrice: candle.close,
      },
      fetchedAt: receivedAt,
    };
  }

  if (data.e === "24hrTicker") {
    return {
      ...current,
      ticker: {
        lastPrice: finiteNumber(data.c, current.ticker.lastPrice),
        priceChange: finiteNumber(data.p, current.ticker.priceChange),
        priceChangePercent: finiteNumber(data.P, current.ticker.priceChangePercent),
        highPrice: finiteNumber(data.h, current.ticker.highPrice),
        lowPrice: finiteNumber(data.l, current.ticker.lowPrice),
        quoteVolume: finiteNumber(data.q, current.ticker.quoteVolume),
      },
      fetchedAt: receivedAt,
    };
  }

  const bids = bookSide(data.bids);
  const asks = bookSide(data.asks);
  if (bids.length && asks.length) {
    return {
      ...current,
      book: { bids, asks },
      fetchedAt: receivedAt,
    };
  }

  return current;
}

export function connectBinanceMarketStream(
  symbol: string,
  interval: string,
  callbacks: StreamCallbacks,
) {
  const streamSymbol = symbol.toLowerCase();
  const streams = [
    `${streamSymbol}@kline_${interval}`,
    `${streamSymbol}@ticker`,
    `${streamSymbol}@depth20`,
  ].join("/");
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let reconnectAttempt = 0;
  let endpointIndex = 0;
  let lastMessageAt = 0;

  const clearSocket = () => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
    socket = null;
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    callbacks.onStatus("reconnecting");
    endpointIndex = (endpointIndex + 1) % STREAM_ENDPOINTS.length;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 5));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped) return;
    callbacks.onStatus(reconnectAttempt ? "reconnecting" : "connecting");
    clearSocket();
    try {
      socket = new WebSocket(`${STREAM_ENDPOINTS[endpointIndex]}/stream?streams=${streams}`);
    } catch {
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      reconnectAttempt = 0;
      lastMessageAt = Date.now();
      callbacks.onStatus("live");
    };
    socket.onmessage = (event) => {
      lastMessageAt = Date.now();
      try {
        const envelope = JSON.parse(String(event.data)) as unknown;
        callbacks.onMarketUpdate((current) =>
          applyBinanceStreamEvent(current, symbol, interval, envelope, lastMessageAt)
        );
      } catch {
        // Ignore a malformed frame; the next valid Binance frame restores freshness.
      }
    };
    socket.onerror = () => {
      socket?.close();
    };
    socket.onclose = () => {
      socket = null;
      scheduleReconnect();
    };
  };

  staleTimer = setInterval(() => {
    if (
      socket?.readyState === WebSocket.OPEN &&
      lastMessageAt &&
      Date.now() - lastMessageAt > 15_000
    ) {
      socket.close();
    }
  }, 5_000);
  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (staleTimer) clearInterval(staleTimer);
    clearSocket();
  };
}
