export type Candle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  takerBuyVolume: number;
};

export type MarketBook = {
  bids: [number, number][];
  asks: [number, number][];
};

export type MarketTicker = {
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
};

export type MarketPayload = {
  symbol: string;
  interval: string;
  candles: Candle[];
  ticker: MarketTicker;
  book: MarketBook;
  fetchedAt: number;
  source: "binance" | "demo";
};

export type IndicatorFamily =
  | "Trend"
  | "Momentum"
  | "Hacim"
  | "Volatilite"
  | "Yapı"
  | "Mikro yapı"
  | "İstatistik";

export type IndicatorResult = {
  id: string;
  name: string;
  family: IndicatorFamily;
  correlationGroup: string;
  value: string;
  rawValue: number;
  state: string;
  score: number;
  strength: number;
  reliability: number;
  directional: boolean;
  interpretation: string;
};

export type AnalysisResult = {
  symbol: string;
  interval: string;
  price: number;
  quantScore: number;
  confidence: number;
  tradeability: number;
  riskScore: number;
  direction: "STRONG SHORT" | "SHORT" | "NEUTRAL" | "LONG" | "STRONG LONG";
  regime: string;
  indicators: IndicatorResult[];
  familyScores: Record<string, number>;
  supports: number[];
  resistances: number[];
  atr: number;
  atrPercent: number;
  reasons: string[];
  contradictions: string[];
  dataQuality: number;
  candleClosed: boolean;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const std = (values: number[]) => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
};

const last = (values: number[], fallback = 0) => values.at(-1) ?? fallback;

const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const compact = (value: number, digits = 2) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
    : "—";

function sma(values: number[], period: number) {
  if (values.length < period) return mean(values);
  return mean(values.slice(-period));
}

function emaSeries(values: number[], period: number) {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const output = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    output.push(values[index] * alpha + output[index - 1] * (1 - alpha));
  }
  return output;
}

function rsiSeries(values: number[], period = 14) {
  if (values.length < 2) return [50];
  const result = new Array(values.length).fill(50);
  let avgGain = 0;
  let avgLoss = 0;
  for (let index = 1; index <= Math.min(period, values.length - 1); index += 1) {
    const change = values[index] - values[index - 1];
    avgGain += Math.max(0, change);
    avgLoss += Math.max(0, -change);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let index = period; index < values.length; index += 1) {
    if (index > period) {
      const change = values[index] - values[index - 1];
      avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period;
    }
    result[index] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function trueRanges(candles: Candle[]) {
  return candles.map((candle, index) => {
    const previousClose = index ? candles[index - 1].close : candle.open;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
}

function stochastic(candles: Candle[], period = 14) {
  const window = candles.slice(-period);
  if (!window.length) return 50;
  const high = Math.max(...window.map((candle) => candle.high));
  const low = Math.min(...window.map((candle) => candle.low));
  return high === low ? 50 : ((last(window.map((candle) => candle.close)) - low) / (high - low)) * 100;
}

function cci(candles: Candle[], period = 20) {
  const typical = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);
  const window = typical.slice(-period);
  const avg = mean(window);
  const deviation = mean(window.map((value) => Math.abs(value - avg)));
  return deviation === 0 ? 0 : (last(window) - avg) / (0.015 * deviation);
}

function adx(candles: Candle[], period = 14) {
  const window = candles.slice(-(period + 1));
  if (window.length < 3) return { adx: 0, plusDI: 0, minusDI: 0 };
  let trTotal = 0;
  let plusTotal = 0;
  let minusTotal = 0;
  const dxValues: number[] = [];
  for (let index = 1; index < window.length; index += 1) {
    const current = window[index];
    const previous = window[index - 1];
    const tr = Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    const plus = upMove > downMove && upMove > 0 ? upMove : 0;
    const minus = downMove > upMove && downMove > 0 ? downMove : 0;
    trTotal += tr;
    plusTotal += plus;
    minusTotal += minus;
    const plusDI = trTotal ? (100 * plusTotal) / trTotal : 0;
    const minusDI = trTotal ? (100 * minusTotal) / trTotal : 0;
    const denominator = plusDI + minusDI;
    dxValues.push(denominator ? (100 * Math.abs(plusDI - minusDI)) / denominator : 0);
  }
  return {
    adx: mean(dxValues.slice(-period)),
    plusDI: trTotal ? (100 * plusTotal) / trTotal : 0,
    minusDI: trTotal ? (100 * minusTotal) / trTotal : 0,
  };
}

function mfi(candles: Candle[], period = 14) {
  const window = candles.slice(-(period + 1));
  let positive = 0;
  let negative = 0;
  for (let index = 1; index < window.length; index += 1) {
    const typical = (window[index].high + window[index].low + window[index].close) / 3;
    const previous = (window[index - 1].high + window[index - 1].low + window[index - 1].close) / 3;
    const flow = typical * window[index].volume;
    if (typical >= previous) positive += flow;
    else negative += flow;
  }
  if (negative === 0) return 100;
  return 100 - 100 / (1 + positive / negative);
}

function cmf(candles: Candle[], period = 20) {
  const window = candles.slice(-period);
  const volume = sum(window.map((candle) => candle.volume));
  if (!volume) return 0;
  return sum(window.map((candle) => {
    const range = candle.high - candle.low;
    const multiplier = range ? ((candle.close - candle.low) - (candle.high - candle.close)) / range : 0;
    return multiplier * candle.volume;
  })) / volume;
}

function skewness(values: number[]) {
  const deviation = std(values);
  if (!deviation) return 0;
  const avg = mean(values);
  return mean(values.map((value) => ((value - avg) / deviation) ** 3));
}

function kurtosis(values: number[]) {
  const deviation = std(values);
  if (!deviation) return 0;
  const avg = mean(values);
  return mean(values.map((value) => ((value - avg) / deviation) ** 4)) - 3;
}

function autocorrelation(values: number[], lag = 1) {
  if (values.length <= lag + 2) return 0;
  const avg = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let index = lag; index < values.length; index += 1) {
    numerator += (values[index] - avg) * (values[index - lag] - avg);
  }
  for (const value of values) denominator += (value - avg) ** 2;
  return denominator ? numerator / denominator : 0;
}

function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function indicator(
  id: string,
  name: string,
  family: IndicatorFamily,
  correlationGroup: string,
  rawValue: number,
  value: string,
  state: string,
  score: number,
  interpretation: string,
  options: { directional?: boolean; reliability?: number; strength?: number } = {},
): IndicatorResult {
  return {
    id,
    name,
    family,
    correlationGroup,
    rawValue,
    value,
    state,
    score: Math.round(clamp(score, -100, 100)),
    strength: Math.round(options.strength ?? Math.abs(score)),
    reliability: Math.round(options.reliability ?? 75),
    directional: options.directional ?? true,
    interpretation,
  };
}

export function analyzeMarket(payload: MarketPayload): AnalysisResult {
  const candles = payload.candles;
  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const volumes = candles.map((candle) => candle.volume);
  const price = last(closes, payload.ticker.lastPrice);
  const previousPrice = closes.at(-2) ?? price;
  const return1 = previousPrice ? Math.log(price / previousPrice) * 100 : 0;
  const logReturns = closes.slice(1).map((value, index) => Math.log(value / closes[index]) * 100).filter(Number.isFinite);
  const ema9 = last(emaSeries(closes, 9), price);
  const ema20 = last(emaSeries(closes, 20), price);
  const ema50 = last(emaSeries(closes, 50), price);
  const ema200 = last(emaSeries(closes, 200), price);
  const ema12Series = emaSeries(closes, 12);
  const ema26Series = emaSeries(closes, 26);
  const macdSeries = closes.map((_, index) => (ema12Series[index] ?? 0) - (ema26Series[index] ?? 0));
  const macdSignal = emaSeries(macdSeries, 9);
  const macd = last(macdSeries);
  const macdHistogram = macd - last(macdSignal);
  const rsiValues = rsiSeries(closes, 14);
  const rsi = last(rsiValues, 50);
  const rsiPrevious = rsiValues.at(-4) ?? rsi;
  const ranges = trueRanges(candles);
  const atr = sma(ranges, 14);
  const atrPercent = price ? (atr / price) * 100 : 0;
  const adxValue = adx(candles, 14);
  const stoch = stochastic(candles, 14);
  const cciValue = cci(candles, 20);
  const williams = stoch - 100;
  const rocBase = closes.at(-11) ?? price;
  const roc = rocBase ? ((price / rocBase) - 1) * 100 : 0;
  const bbMiddle = sma(closes, 20);
  const bbStd = std(closes.slice(-20));
  const bbUpper = bbMiddle + 2 * bbStd;
  const bbLower = bbMiddle - 2 * bbStd;
  const bbPercent = bbUpper === bbLower ? 0.5 : (price - bbLower) / (bbUpper - bbLower);
  const bbWidth = bbMiddle ? ((bbUpper - bbLower) / bbMiddle) * 100 : 0;
  const historicalVolatility = std(logReturns.slice(-20));
  const relativeVolume = sma(volumes.slice(0, -1), 20) ? last(volumes) / sma(volumes.slice(0, -1), 20) : 1;
  let obv = 0;
  const obvSeries = [0];
  for (let index = 1; index < candles.length; index += 1) {
    if (closes[index] > closes[index - 1]) obv += volumes[index];
    if (closes[index] < closes[index - 1]) obv -= volumes[index];
    obvSeries.push(obv);
  }
  const obvShort = sma(obvSeries, 5);
  const obvLong = sma(obvSeries, 20);
  const mfiValue = mfi(candles, 14);
  const cmfValue = cmf(candles, 20);
  const vwapWindow = candles.slice(-50);
  const vwapVolume = sum(vwapWindow.map((candle) => candle.volume));
  const vwap = vwapVolume ? sum(vwapWindow.map((candle) => ((candle.high + candle.low + candle.close) / 3) * candle.volume)) / vwapVolume : price;
  const vwapDeviation = vwap ? ((price / vwap) - 1) * 100 : 0;
  const takerBuy = sum(candles.slice(-20).map((candle) => candle.takerBuyVolume));
  const totalVolume = sum(candles.slice(-20).map((candle) => candle.volume));
  const takerRatio = totalVolume ? takerBuy / totalVolume : 0.5;
  const bestBid = payload.book.bids[0]?.[0] ?? price;
  const bestAsk = payload.book.asks[0]?.[0] ?? price;
  const spreadBps = price ? ((bestAsk - bestBid) / price) * 10000 : 0;
  const bidVolume = sum(payload.book.bids.slice(0, 10).map((item) => item[1]));
  const askVolume = sum(payload.book.asks.slice(0, 10).map((item) => item[1]));
  const imbalance = bidVolume + askVolume ? (bidVolume - askVolume) / (bidVolume + askVolume) : 0;
  const shortHigh = Math.max(...highs.slice(-20));
  const shortLow = Math.min(...lows.slice(-20));
  const longHigh = Math.max(...highs.slice(-60));
  const longLow = Math.min(...lows.slice(-60));
  const previousHigh = Math.max(...highs.slice(-40, -20));
  const previousLow = Math.min(...lows.slice(-40, -20));
  const structureScore = shortHigh > previousHigh && shortLow > previousLow ? 62 : shortHigh < previousHigh && shortLow < previousLow ? -62 : 0;
  const structureState = structureScore > 0 ? "HH / HL" : structureScore < 0 ? "LH / LL" : "Range";
  const priceVolumeCorrelation = autocorrelation(logReturns.slice(-30).map((value, index) => value * (volumes.slice(-30)[index] / (sma(volumes, 30) || 1))), 1);
  const skew = skewness(logReturns.slice(-50));
  const kurt = kurtosis(logReturns.slice(-50));
  const autoCorr = autocorrelation(logReturns.slice(-60), 1);

  const indicators: IndicatorResult[] = [];
  const emaScore = clamp(((ema20 / ema50) - 1) * 3500, -75, 75);
  indicators.push(indicator("ema_20_50", "EMA 20 / 50", "Trend", "moving_average_short", ema20 - ema50, `${compact(ema20, 2)} / ${compact(ema50, 2)}`, ema20 >= ema50 ? "Pozitif" : "Negatif", emaScore, ema20 >= ema50 ? "EMA20, EMA50 üzerinde; kısa vadeli trend yukarı yönlü." : "EMA20, EMA50 altında; kısa vadeli trend baskı altında."));
  const emaLongScore = clamp(((price / ema200) - 1) * 1200, -65, 65);
  indicators.push(indicator("price_ema200", "Fiyat / EMA200", "Trend", "moving_average_long", ema200 ? ((price / ema200) - 1) * 100 : 0, `${pct(ema200 ? ((price / ema200) - 1) * 100 : 0)}`, price >= ema200 ? "Üstünde" : "Altında", emaLongScore, price >= ema200 ? "Fiyat uzun vadeli EMA200 üzerinde." : "Fiyat uzun vadeli EMA200 altında."));
  const macdScore = clamp((macdHistogram / (atr || 1)) * 180, -75, 75);
  indicators.push(indicator("macd", "MACD Histogram", "Trend", "trend_momentum", macdHistogram, compact(macdHistogram, 3), macdHistogram >= 0 ? "Pozitif" : "Negatif", macdScore, macdHistogram >= 0 ? "MACD histogram pozitif; trend momentumu destekleniyor." : "MACD histogram negatif; trend momentumu zayıflıyor."));
  const dmiDirection = adxValue.plusDI >= adxValue.minusDI ? 1 : -1;
  const adxScore = dmiDirection * clamp(adxValue.adx * 1.8, 0, 72);
  indicators.push(indicator("adx_dmi", "ADX / DMI", "Trend", "trend_strength", adxValue.adx, compact(adxValue.adx, 1), adxValue.adx >= 25 ? "Trend" : "Zayıf", adxScore, `${adxValue.plusDI >= adxValue.minusDI ? "+DI" : "−DI"} üstün; trend gücü ${adxValue.adx >= 25 ? "teyit ediliyor" : "henüz sınırlı"}.`));
  const slopeScore = clamp(((ema9 / (closes.at(-6) ?? ema9)) - 1) * 1500, -65, 65);
  indicators.push(indicator("ema_slope", "EMA9 Eğimi", "Trend", "trend_slope", slopeScore, pct(((ema9 / (closes.at(-6) ?? ema9)) - 1) * 100), slopeScore >= 0 ? "Yukarı" : "Aşağı", slopeScore, slopeScore >= 0 ? "Kısa ortalamanın eğimi yukarı dönük." : "Kısa ortalamanın eğimi aşağı dönük."));

  const rsiScore = clamp((rsi - 50) * 2, -70, 70);
  indicators.push(indicator("rsi_14", "RSI (14)", "Momentum", "bounded_momentum", rsi, compact(rsi, 1), rsi > 70 ? "Aşırı alım" : rsi < 30 ? "Aşırı satım" : rsi >= 50 ? "Pozitif" : "Negatif", rsiScore, rsi > 70 ? "Momentum güçlü ancak aşırı alım nedeniyle yeni giriş riski artıyor." : rsi < 30 ? "Momentum zayıf; aşırı satım geri dönüş riski taşıyor." : `RSI ${rsi >= rsiPrevious ? "yükseliyor" : "geriliyor"} ve ${rsi >= 50 ? "pozitif" : "negatif"} bölgede.`));
  const stochScore = clamp((stoch - 50) * 1.5, -70, 70);
  indicators.push(indicator("stoch", "Stochastic %K", "Momentum", "bounded_momentum", stoch, compact(stoch, 1), stoch > 80 ? "Aşırı alım" : stoch < 20 ? "Aşırı satım" : stoch >= 50 ? "Pozitif" : "Negatif", stochScore, `Stochastic ${compact(stoch, 1)}; kısa vadeli momentum ${stoch >= 50 ? "alıcılar" : "satıcılar"} lehine.`));
  const cciScore = clamp(cciValue / 2, -75, 75);
  indicators.push(indicator("cci", "CCI (20)", "Momentum", "unbounded_momentum", cciValue, compact(cciValue, 1), cciValue > 100 ? "Güçlü" : cciValue < -100 ? "Zayıf" : "Dengeli", cciScore, `CCI ${cciValue >= 0 ? "pozitif" : "negatif"}; momentum sapması ${Math.abs(cciValue) > 100 ? "belirgin" : "ılımlı"}.`));
  const williamsScore = clamp((williams + 50) * 1.4, -70, 70);
  indicators.push(indicator("williams_r", "Williams %R", "Momentum", "bounded_momentum", williams, compact(williams, 1), williams > -20 ? "Aşırı alım" : williams < -80 ? "Aşırı satım" : "Orta bölge", williamsScore, `Williams %R ${compact(williams, 1)}; fiyat son 14 mum aralığının ${williams > -50 ? "üst" : "alt"} yarısında.`));
  indicators.push(indicator("roc_10", "ROC (10)", "Momentum", "rate_of_change", roc, pct(roc), roc >= 0 ? "Pozitif" : "Negatif", clamp(roc * 20, -70, 70), `10 mumluk değişim ${pct(roc)}.`));

  const directionalVolume = Math.sign(return1 || 1);
  indicators.push(indicator("relative_volume", "Relative Volume (20)", "Hacim", "relative_volume", relativeVolume, `${compact(relativeVolume, 2)}×`, relativeVolume > 1.5 ? "Güçlü" : relativeVolume < 0.7 ? "Zayıf" : "Normal", directionalVolume * clamp((relativeVolume - 1) * 70, -60, 75), `Son mum hacmi 20 mum ortalamasının ${compact(relativeVolume, 2)} katı; hareket ${relativeVolume > 1.25 ? "hacimle teyit alıyor" : "güçlü hacim teyidi taşımıyor"}.`));
  const obvScore = obvShort >= obvLong ? 48 : -48;
  indicators.push(indicator("obv", "OBV Eğimi", "Hacim", "volume_flow", obvShort - obvLong, compact(obvShort - obvLong, 0), obvScore >= 0 ? "Birikim" : "Dağıtım", obvScore, obvScore >= 0 ? "OBV kısa ortalaması yükseliyor; birikim baskısı var." : "OBV kısa ortalaması geriliyor; dağıtım baskısı var."));
  indicators.push(indicator("cmf", "Chaikin Money Flow", "Hacim", "volume_flow", cmfValue, compact(cmfValue, 3), cmfValue >= 0 ? "Giriş" : "Çıkış", clamp(cmfValue * 260, -70, 70), `CMF ${cmfValue >= 0 ? "pozitif para akışına" : "negatif para akışına"} işaret ediyor.`));
  indicators.push(indicator("mfi", "Money Flow Index", "Hacim", "money_flow", mfiValue, compact(mfiValue, 1), mfiValue > 80 ? "Aşırı alım" : mfiValue < 20 ? "Aşırı satım" : mfiValue >= 50 ? "Pozitif" : "Negatif", clamp((mfiValue - 50) * 1.4, -70, 70), `Fiyat ve hacim birleşik para akışı ${mfiValue >= 50 ? "pozitif" : "negatif"}.`));
  indicators.push(indicator("vwap_deviation", "VWAP Sapması", "Hacim", "fair_value", vwapDeviation, pct(vwapDeviation), vwapDeviation >= 0 ? "Üstünde" : "Altında", clamp(vwapDeviation * 25, -65, 65), `Fiyat 50 mumluk VWAP'ın ${Math.abs(vwapDeviation).toFixed(2)}% ${vwapDeviation >= 0 ? "üzerinde" : "altında"}.`));
  indicators.push(indicator("taker_ratio", "Taker Buy Ratio", "Hacim", "trade_flow", takerRatio, `${compact(takerRatio * 100, 1)}%`, takerRatio >= 0.52 ? "Alıcı" : takerRatio <= 0.48 ? "Satıcı" : "Dengeli", clamp((takerRatio - 0.5) * 500, -65, 65), `Agresif işlem hacminin ${compact(takerRatio * 100, 1)}%'i alış yönünde.`));

  indicators.push(indicator("atr", "ATR (14)", "Volatilite", "realized_volatility", atr, compact(atr, 2), atrPercent > 2 ? "Yüksek" : atrPercent < 0.35 ? "Düşük" : "Normal", 0, `Ortalama gerçek aralık fiyatın ${compact(atrPercent, 2)}%'i; stop ve hedefler buna göre ölçeklenmeli.`, { directional: false, strength: clamp(atrPercent * 25, 0, 100) }));
  indicators.push(indicator("bb_percent", "Bollinger %B", "Volatilite", "volatility_position", bbPercent, compact(bbPercent, 2), bbPercent > 1 ? "Bant üstü" : bbPercent < 0 ? "Bant altı" : bbPercent > 0.8 ? "Üst banda yakın" : bbPercent < 0.2 ? "Alt banda yakın" : "Bant içi", clamp((bbPercent - 0.5) * 100, -60, 60), `Fiyat Bollinger aralığının ${(bbPercent * 100).toFixed(0)}. yüzdesinde; bant genişliği ${compact(bbWidth, 2)}%.`));
  indicators.push(indicator("bb_width", "Bollinger Width", "Volatilite", "volatility_regime", bbWidth, `${compact(bbWidth, 2)}%`, bbWidth < atrPercent * 2.2 ? "Sıkışma" : "Açık", 0, `Bant genişliği ${compact(bbWidth, 2)}%; piyasa ${bbWidth < atrPercent * 2.2 ? "sıkışma" : "normal/genişleme"} rejiminde.`, { directional: false }));
  indicators.push(indicator("historical_vol", "Tarihsel Volatilite", "Volatilite", "realized_volatility", historicalVolatility, `${compact(historicalVolatility, 3)}%`, historicalVolatility > quantile(logReturns.map(Math.abs), .8) ? "Yüksek" : "Normal", 0, `Son 20 mum getiri sapması ${compact(historicalVolatility, 3)}%.`, { directional: false }));

  indicators.push(indicator("market_structure", "Piyasa Yapısı", "Yapı", "swing_structure", structureScore, structureState, structureState, structureScore, structureScore > 0 ? "Son swing'ler daha yüksek tepe ve daha yüksek dip üretiyor." : structureScore < 0 ? "Son swing'ler daha düşük tepe ve daha düşük dip üretiyor." : "Swing yapısı net bir yön üretmiyor; range olasılığı yüksek."));
  const supportDistance = price ? ((price - shortLow) / price) * 100 : 0;
  const resistanceDistance = price ? ((shortHigh - price) / price) * 100 : 0;
  indicators.push(indicator("sr_proximity", "Destek / Direnç Mesafesi", "Yapı", "levels", resistanceDistance - supportDistance, `${compact(supportDistance, 2)}% / ${compact(resistanceDistance, 2)}%`, resistanceDistance < supportDistance ? "Dirence yakın" : "Desteğe yakın", 0, `En yakın destek ${compact(supportDistance, 2)}%, direnç ${compact(resistanceDistance, 2)}% mesafede.`, { directional: false }));

  indicators.push(indicator("order_imbalance", "Order Book Imbalance", "Mikro yapı", "order_book", imbalance, pct(imbalance * 100), imbalance > .08 ? "Bid baskısı" : imbalance < -.08 ? "Ask baskısı" : "Dengeli", clamp(imbalance * 180, -65, 65), `İlk 10 kademede ${imbalance >= 0 ? "alış" : "satış"} tarafı ${compact(Math.abs(imbalance) * 100, 1)}% baskın.`, { reliability: 58 }));
  indicators.push(indicator("spread", "Bid–Ask Spread", "Mikro yapı", "liquidity", spreadBps, `${compact(spreadBps, 2)} bps`, spreadBps < 1 ? "Dar" : spreadBps < 4 ? "Normal" : "Açık", 0, `Spread ${compact(spreadBps, 2)} baz puan; işlem maliyeti ${spreadBps < 2 ? "uygun" : "dikkat gerektiriyor"}.`, { directional: false, reliability: 80 }));

  indicators.push(indicator("log_return", "Log Return (1)", "İstatistik", "returns", return1, pct(return1), return1 >= 0 ? "Pozitif" : "Negatif", clamp(return1 * 35, -60, 60), `Son mum logaritmik getirisi ${pct(return1)}.`));
  indicators.push(indicator("skewness", "Return Skewness", "İstatistik", "tail_risk", skew, compact(skew, 2), skew > .5 ? "Sağ kuyruk" : skew < -.5 ? "Sol kuyruk" : "Simetrik", 0, `Getiri dağılımı ${skew < -.5 ? "aşağı yönlü kuyruk riski" : skew > .5 ? "yukarı yönlü sıçrama eğilimi" : "dengeli kuyruklar"} gösteriyor.`, { directional: false }));
  indicators.push(indicator("kurtosis", "Excess Kurtosis", "İstatistik", "tail_risk", kurt, compact(kurt, 2), kurt > 3 ? "Kalın kuyruk" : "Normal", 0, `Basıklık ${compact(kurt, 2)}; uç hareket riski ${kurt > 3 ? "yüksek" : "normal"}.`, { directional: false }));
  indicators.push(indicator("autocorr", "Autocorrelation (1)", "İstatistik", "serial_dependence", autoCorr, compact(autoCorr, 3), autoCorr > .15 ? "Trend eğilimi" : autoCorr < -.15 ? "Mean reversion" : "Zayıf", 0, `Lag-1 otokorelasyon ${compact(autoCorr, 3)}; seri bağımlılığı ${Math.abs(autoCorr) > .15 ? "ölçülebilir" : "zayıf"}.`, { directional: false }));
  indicators.push(indicator("price_volume_corr", "Fiyat–Hacim Etkileşimi", "İstatistik", "price_volume", priceVolumeCorrelation, compact(priceVolumeCorrelation, 3), priceVolumeCorrelation > .1 ? "Uyumlu" : priceVolumeCorrelation < -.1 ? "Ters" : "Zayıf", 0, `Fiyat değişimi ve normalize hacim etkileşimi ${Math.abs(priceVolumeCorrelation) > .1 ? "belirgin" : "zayıf"}.`, { directional: false }));

  const scoringWeights: Record<string, number> = { Trend: .28, Momentum: .18, Hacim: .20, Yapı: .20, "Mikro yapı": .09, İstatistik: .05 };
  const familyScores: Record<string, number> = {};
  for (const family of Object.keys(scoringWeights)) {
    const familyIndicators = indicators.filter((item) => item.family === family && item.directional);
    const groups = new Map<string, number[]>();
    for (const item of familyIndicators) groups.set(item.correlationGroup, [...(groups.get(item.correlationGroup) ?? []), item.score]);
    familyScores[family] = Math.round(mean([...groups.values()].map((scores) => mean(scores))));
  }
  const quantScore = Math.round(sum(Object.entries(scoringWeights).map(([family, weight]) => (familyScores[family] ?? 0) * weight)));
  const directionalIndicators = indicators.filter((item) => item.directional && Math.abs(item.score) >= 10);
  const matching = directionalIndicators.filter((item) => Math.sign(item.score) === Math.sign(quantScore)).length;
  const agreement = directionalIndicators.length ? matching / directionalIndicators.length : .5;
  const dataQuality = candles.length >= 200 && payload.book.bids.length ? 96 : candles.length >= 100 ? 84 : 65;
  const confidence = Math.round(clamp(42 + Math.abs(quantScore) * .32 + agreement * 31 - (spreadBps > 4 ? 10 : 0), 32, 94));
  const tradeability = Math.round(clamp(91 - Math.max(0, spreadBps - 1) * 4 - Math.max(0, atrPercent - 2) * 7 - Math.max(0, 1 - relativeVolume) * 15, 20, 96));
  const riskScore = 100 - tradeability;
  const direction = quantScore >= 55 ? "STRONG LONG" : quantScore >= 20 ? "LONG" : quantScore <= -55 ? "STRONG SHORT" : quantScore <= -20 ? "SHORT" : "NEUTRAL";
  const regime = adxValue.adx >= 25 ? `${dmiDirection > 0 ? "Yükselen" : "Düşen"} trend` : bbWidth < atrPercent * 2.2 ? "Volatilite sıkışması" : "Range / geçiş";
  const sortedDirectional = [...directionalIndicators].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const reasons = sortedDirectional.filter((item) => Math.sign(item.score) === Math.sign(quantScore)).slice(0, 3).map((item) => item.interpretation);
  const contradictions = sortedDirectional.filter((item) => Math.sign(item.score) !== Math.sign(quantScore)).slice(0, 2).map((item) => item.interpretation);
  if (resistanceDistance < atrPercent * .65) contradictions.unshift("Fiyat yakın direnç bölgesine bir ATR'den daha az mesafede.");

  return {
    symbol: payload.symbol,
    interval: payload.interval,
    price,
    quantScore,
    confidence,
    tradeability,
    riskScore,
    direction,
    regime,
    indicators,
    familyScores,
    supports: [shortLow, longLow].sort((a, b) => b - a),
    resistances: [shortHigh, longHigh].sort((a, b) => a - b),
    atr,
    atrPercent,
    reasons,
    contradictions,
    dataQuality,
    candleClosed: Date.now() > (candles.at(-1)?.closeTime ?? 0),
  };
}

export function makeDemoMarket(symbol = "BTCUSDT", interval = "15m"): MarketPayload {
  const now = Date.now();
  const intervalMatch = interval.match(/^(\d+)([mhdw])$/);
  const intervalUnitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const intervalDuration = intervalMatch
    ? Number(intervalMatch[1]) * intervalUnitMs[intervalMatch[2] as keyof typeof intervalUnitMs]
    : 900_000;
  const base = symbol.startsWith("BTC") ? 65842 : symbol.startsWith("ETH") ? 3420 : symbol.startsWith("SOL") ? 168 : 100;
  let value = base * .91;
  const candles: Candle[] = Array.from({ length: 260 }, (_, index) => {
    const drift = Math.sin(index / 9) * base * .0014 + base * .00036;
    const noise = Math.sin(index * 1.73) * base * .0018;
    const open = value;
    const close = Math.max(base * .55, open + drift + noise);
    const high = Math.max(open, close) + Math.abs(Math.cos(index)) * base * .0018;
    const low = Math.min(open, close) - Math.abs(Math.sin(index * .7)) * base * .0016;
    value = close;
    return {
      openTime: now - (260 - index) * intervalDuration,
      closeTime: now - (259 - index) * intervalDuration - 1,
      open,
      high,
      low,
      close,
      volume: 700 + Math.abs(Math.sin(index / 4)) * 900 + (index % 17 === 0 ? 1600 : 0),
      quoteVolume: 0,
      trades: 1000 + index * 2,
      takerBuyVolume: (700 + Math.abs(Math.sin(index / 4)) * 900) * (.48 + Math.sin(index / 7) * .08),
    };
  });
  const price = last(candles.map((candle) => candle.close));
  return {
    symbol,
    interval,
    candles,
    ticker: { lastPrice: price, priceChange: price * .0114, priceChangePercent: 1.14, highPrice: price * 1.012, lowPrice: price * .983, quoteVolume: 28_400_000_000 },
    book: {
      bids: Array.from({ length: 20 }, (_, index) => [price * (1 - (index + 1) * .00002), 1.4 + index * .18]),
      asks: Array.from({ length: 20 }, (_, index) => [price * (1 + (index + 1) * .00002), 1.2 + index * .15]),
    },
    fetchedAt: now,
    source: "demo",
  };
}
