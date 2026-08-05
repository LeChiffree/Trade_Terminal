"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  analyzeMarket,
  type AnalysisResult,
  type Candle,
} from "@/lib/analysis";
import type {
  BistDirectory,
  BistInterval,
  BistMarketPayload,
  BistSymbol,
} from "@/lib/bist";

const TIMEFRAMES: BistInterval[] = ["5m", "15m", "1h", "4h", "1d", "1w"];
const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 2,
});
const compactFormatter = new Intl.NumberFormat("tr-TR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatTry(value: number) {
  return Number.isFinite(value) && value > 0 ? tryFormatter.format(value) : "—";
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${Math.round(value)}`;
}

function tone(value: number) {
  return value > 12 ? "positive" : value < -12 ? "negative" : "neutral";
}

function scoreLabel(score: number) {
  if (score >= 55) return "GÜÇLÜ LONG";
  if (score >= 20) return "LONG";
  if (score <= -55) return "GÜÇLÜ SHORT";
  if (score <= -20) return "SHORT";
  return "NÖTR";
}

function BistCandleChart({
  candles,
  price,
  symbol,
  interval,
  loading,
}: {
  candles: Candle[];
  price: number;
  symbol: string;
  interval: string;
  loading: boolean;
}) {
  const visible = candles.slice(-58);
  const width = 800;
  const height = 250;
  const high = Math.max(...visible.map((candle) => candle.high), price);
  const low = Math.min(...visible.map((candle) => candle.low), price);
  const range = high - low || 1;
  const y = (value: number) => 8 + ((high - value) / range) * (height - 22);
  const step = width / Math.max(visible.length, 1);
  const maxVolume = Math.max(...visible.map((candle) => candle.volume), 1);
  const closes = visible.map((candle) => candle.close);
  const ema: number[] = [];
  closes.forEach((value, index) =>
    ema.push(index ? value * (2 / 21) + ema[index - 1] * (19 / 21) : value),
  );
  const path = ema
    .map(
      (value, index) =>
        `${index ? "L" : "M"}${(index + 0.5) * step},${y(value)}`,
    )
    .join(" ");
  return (
    <div
      className="chart-shell bist-chart"
      aria-label={`${symbol} ${interval} gecikmeli mum grafiği`}
      aria-busy={loading}
    >
      <div className="chart-watermark">{symbol} · BIST · {interval}</div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        {[0, 1, 2, 3, 4].map((index) => (
          <line
            key={index}
            x1="0"
            x2={width}
            y1={index * 62.5}
            y2={index * 62.5}
            className="grid-line"
          />
        ))}
        {visible.map((candle, index) => {
          const up = candle.close >= candle.open;
          const x = index * step + step * 0.24;
          const bodyY = y(Math.max(candle.open, candle.close));
          const bodyHeight = Math.max(
            1.4,
            Math.abs(y(candle.open) - y(candle.close)),
          );
          return (
            <g key={candle.openTime}>
              <rect
                x={x}
                y={height - 22 - (candle.volume / maxVolume) * 35}
                width={Math.max(1, step * 0.48)}
                height={(candle.volume / maxVolume) * 35}
                className={`volume ${up ? "up" : "down"}`}
              />
              <line
                x1={x + step * 0.24}
                x2={x + step * 0.24}
                y1={y(candle.high)}
                y2={y(candle.low)}
                className={up ? "wick-up" : "wick-down"}
              />
              <rect
                x={x}
                y={bodyY}
                width={Math.max(1.6, step * 0.48)}
                height={bodyHeight}
                rx=".8"
                className={up ? "candle-up" : "candle-down"}
              />
            </g>
          );
        })}
        <path d={path} className="ema-line" />
        <line
          x1="0"
          x2={width}
          y1={y(price)}
          y2={y(price)}
          className="price-line"
        />
      </svg>
      <div className="price-tag" style={{ top: `${(y(price) / height) * 100}%` }}>
        {numberFormatter.format(price)}
      </div>
      {loading && <div className="chart-loading">BIST verisi güncelleniyor…</div>}
    </div>
  );
}

function BistDecision({
  analysis,
  scanner,
}: {
  analysis: AnalysisResult;
  scanner: BistSymbol | undefined;
}) {
  return (
    <aside className="panel bist-decision">
      <div className="panel-head">
        <div>
          <span className="eyebrow">BIST KARAR MOTORU</span>
          <h2>{scoreLabel(analysis.quantScore)}</h2>
        </div>
        <span className={`bist-signal ${tone(analysis.quantScore)}`}>
          {signed(analysis.quantScore)}
        </span>
      </div>
      <div className="bist-score-pair">
        <div
          className={`bist-score-gauge ${tone(analysis.quantScore)}`}
          style={{ "--score": `${Math.abs(analysis.quantScore) * 3.6}deg` } as CSSProperties}
        >
          <span>{signed(analysis.quantScore)}</span>
          <small>Mum quant</small>
        </div>
        <div
          className={`bist-score-gauge ${tone(scanner?.score ?? 0)}`}
          style={{ "--score": `${Math.abs(scanner?.score ?? 0) * 3.6}deg` } as CSSProperties}
        >
          <span>{signed(scanner?.score ?? 0)}</span>
          <small>80 tarama</small>
        </div>
      </div>
      <div className="bist-confidence">
        <div><span>Quant güveni</span><b>%{analysis.confidence}</b></div>
        <i><b style={{ width: `${analysis.confidence}%` }} /></i>
      </div>
      <div className="reason-list">
        {analysis.reasons.slice(0, 3).map((reason, index) => (
          <p key={reason}>
            <span>{index ? "◇" : "↑"}</span>
            <b>{index ? "Teyit" : "Ana gerekçe"}</b>
            <small>{reason}</small>
          </p>
        ))}
        {analysis.contradictions.slice(0, 1).map((risk) => (
          <p className="warn" key={risk}>
            <span>!</span><b>Risk</b><small>{risk}</small>
          </p>
        ))}
      </div>
      <p className="bist-delay-note">
        Skor yatırım tavsiyesi değildir. Veri en az 15 dakika gecikmelidir;
        emir iletilmez.
      </p>
    </aside>
  );
}

export default function BistTerminal() {
  const [interval, setInterval] = useState<BistInterval>("15m");
  const [symbol, setSymbol] = useState("THYAO");
  const [directory, setDirectory] = useState<BistDirectory | null>(null);
  const [market, setMarket] = useState<BistMarketPayload | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [marketLoading, setMarketLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setDirectoryLoading(true);
      try {
        const response = await fetch(
          `/api/bist/symbols?interval=${encodeURIComponent(interval)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("directory");
        const next = await response.json() as BistDirectory;
        if (!cancelled) setDirectory(next);
      } catch {
        if (!cancelled) setError("BIST 80 sıralaması şu anda yenilenemedi.");
      } finally {
        if (!cancelled) setDirectoryLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [interval]);

  useEffect(() => {
    let cancelled = false;
    const load = async (showLoading: boolean) => {
      if (showLoading) setMarketLoading(true);
      try {
        const response = await fetch(
          `/api/bist/market?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("market");
        const next = await response.json() as BistMarketPayload;
        if (!cancelled) {
          setMarket(next);
          setError("");
        }
      } catch {
        if (!cancelled) {
          setError("Seçili hissenin gecikmeli mum verisi alınamadı.");
        }
      } finally {
        if (!cancelled && showLoading) setMarketLoading(false);
      }
    };
    void load(true);
    const timer = window.setInterval(() => void load(false), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [symbol, interval]);

  const analysis = useMemo(
    () => market ? analyzeMarket(market) : null,
    [market],
  );
  const symbols = useMemo(() => directory?.symbols ?? [], [directory]);
  const selectedScanner = symbols.find((item) => item.symbol === symbol);
  const leaders = useMemo(
    () =>
      [...symbols]
        .filter((item) => item.direction !== "unavailable")
        .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))
        .slice(0, 10),
    [symbols],
  );
  const advancers = symbols.filter((item) => item.priceChangePercent > 0).length;
  const decliners = symbols.filter((item) => item.priceChangePercent < 0).length;
  const turnover = symbols.reduce((sum, item) => sum + item.turnover, 0);
  const change = market?.ticker.priceChangePercent ?? 0;

  const changeSymbol = (next: string) => {
    if (next === symbol) return;
    setSymbol(next);
    setMarket(null);
    setMarketLoading(true);
  };
  const changeInterval = (next: BistInterval) => {
    if (next === interval) return;
    setInterval(next);
    setMarket(null);
    setMarketLoading(true);
  };

  return (
    <>
      <section className="panel module-panel bist-hero">
        <div>
          <span className="eyebrow">BIST QUANT · İŞLEM DEĞERİNE GÖRE TOP 80</span>
          <h2>Türkiye’nin en likit hisselerini aynı teknik motorla incele</h2>
          <p>
            Seçili zaman diliminde 80 hisse sıralanır; seçtiğin kağıdın mumları,
            trendi, momentumu, hacmi ve piyasa yapısı ayrıntılı hesaplanır.
          </p>
        </div>
        <div className="bist-market-state">
          <span>15 DK</span>
          <b>Gecikmeli veri</b>
          <small>Yahoo Finance · TradingView tarama</small>
        </div>
      </section>

      <div className="bist-symbol-bar">
        <div className="symbol-picker">
          <span className="coin-icon bist-icon">B</span>
          <div>
            <select
              value={symbol}
              onChange={(event) => changeSymbol(event.target.value)}
              aria-label="BIST hissesi"
            >
              {!symbols.some((item) => item.symbol === symbol) && (
                <option value={symbol}>{symbol}</option>
              )}
              {symbols.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol} · {item.name}
                </option>
              ))}
            </select>
            <small>
              {directoryLoading
                ? "Top 80 yükleniyor…"
                : "BIST · İşlem değerine göre ilk 80"}
            </small>
          </div>
        </div>
        <div className="quote bist-quote">
          <strong>{formatTry(market?.ticker.lastPrice ?? selectedScanner?.lastPrice ?? 0)}</strong>
          <span className={change >= 0 ? "positive" : "negative"}>
            {change >= 0 ? "+" : ""}{numberFormatter.format(change)}%
          </span>
        </div>
        <div className="quote-stat">
          <small>İşlem değeri</small>
          <b>{selectedScanner?.turnover ? `${compactFormatter.format(selectedScanner.turnover)} ₺` : "—"}</b>
        </div>
        <div className="quote-stat">
          <small>80 piyasa genişliği</small>
          <b className={advancers >= decliners ? "positive" : "negative"}>
            {advancers} ↑ · {decliners} ↓
          </b>
        </div>
      </div>

      <div className="timeframe-row bist-timeframes">
        <div className="segmented" aria-label="BIST zaman dilimi">
          {TIMEFRAMES.map((item) => (
            <button
              key={item}
              className={interval === item ? "active" : ""}
              onClick={() => changeInterval(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="candle-state amber">
          <span /> En az 15 dk gecikmeli · <b>{interval}</b> · 60 sn yenileme
        </div>
      </div>

      {error && <div className="source-banner"><span>VERİ UYARISI</span>{error}</div>}

      {market && analysis ? (
        <>
          <div className="bist-analysis-grid">
            <section className="panel chart-panel">
              <div className="panel-head">
                <div>
                  <span className="eyebrow">{market.symbol} · {market.name}</span>
                  <h2>{analysis.regime}</h2>
                </div>
                <span className="data-note">TRY · {market.provider}</span>
              </div>
              <BistCandleChart
                candles={market.candles}
                price={analysis.price}
                symbol={market.symbol}
                interval={market.interval}
                loading={marketLoading}
              />
              <div className="level-strip">
                <div><small>Destek 1</small><b>{formatTry(analysis.supports[0])}</b></div>
                <div><small>Destek 2</small><b>{formatTry(analysis.supports[1])}</b></div>
                <div><small>Direnç 1</small><b>{formatTry(analysis.resistances[0])}</b></div>
                <div><small>ATR (14)</small><b>{formatTry(analysis.atr)} · %{numberFormatter.format(analysis.atrPercent)}</b></div>
              </div>
            </section>
            <BistDecision analysis={analysis} scanner={selectedScanner} />
          </div>

          <section className="panel module-panel bist-indicators">
            <div className="panel-head">
              <div>
                <span className="eyebrow">SEÇİLİ HİSSE DETAYI</span>
                <h2>Bağımsız gösterge aileleri</h2>
              </div>
              <span className="data-note">Kalite %{analysis.dataQuality}</span>
            </div>
            <div className="bist-indicator-grid">
              {analysis.indicators.slice(0, 8).map((item) => (
                <article key={item.id}>
                  <span>{item.family}</span>
                  <b>{item.name}</b>
                  <strong className={tone(item.score)}>{signed(item.score)}</strong>
                  <small>{item.state} · {item.value}</small>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="panel bist-loading-panel">
          <span>BIST</span>
          <b>{marketLoading ? "Gecikmeli mumlar yükleniyor…" : "Veri bekleniyor"}</b>
        </section>
      )}

      <section className="panel module-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">GÜÇLÜ ADAYLAR · {interval}</span>
            <h2>Top 80 içindeki en yüksek mutlak puanlar</h2>
          </div>
          <span className="data-note">Teknik tarama · LLM kullanılmaz</span>
        </div>
        <div className="bist-leaders">
          {leaders.map((item, index) => (
            <button key={item.symbol} onClick={() => changeSymbol(item.symbol)}>
              <span>{index + 1}</span>
              <b>{item.symbol}</b>
              <small>{item.direction.toUpperCase()}</small>
              <strong className={tone(item.score)}>{signed(item.score)}</strong>
              <i>%{item.confidence}</i>
            </button>
          ))}
          {!leaders.length && (
            <div className="empty-inline">Teknik sıralama verisi bekleniyor.</div>
          )}
        </div>
      </section>

      <section className="panel module-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">BIST HİSSE TARAYICI</span>
            <h2>İşlem değerine göre ilk 80 kağıt</h2>
          </div>
          <span className="data-note">
            Toplam işlem değeri {turnover ? `${compactFormatter.format(turnover)} ₺` : "—"}
          </span>
        </div>
        <div className="bist-table">
          <div className="bist-row bist-head">
            <span>#</span><span>Hisse</span><span>Son fiyat</span>
            <span>Değişim</span><span>İşlem değeri</span>
            <span>Teknik puan</span><span />
          </div>
          {symbols.map((item, index) => (
            <div className={`bist-row ${symbol === item.symbol ? "selected" : ""}`} key={item.symbol}>
              <span>{index + 1}</span>
              <span><b>{item.symbol}</b><small>{item.name}</small></span>
              <span>{formatTry(item.lastPrice)}</span>
              <span className={item.priceChangePercent >= 0 ? "positive" : "negative"}>
                {item.priceChangePercent > 0 ? "+" : ""}
                {item.lastPrice ? `${numberFormatter.format(item.priceChangePercent)}%` : "—"}
              </span>
              <span>{item.turnover ? `${compactFormatter.format(item.turnover)} ₺` : "—"}</span>
              <span><b className={tone(item.score)}>{item.direction === "unavailable" ? "—" : signed(item.score)}</b><small>{item.confidence ? `%${item.confidence} güven` : "Veri bekleniyor"}</small></span>
              <span><button onClick={() => changeSymbol(item.symbol)}>Analiz et →</button></span>
            </div>
          ))}
        </div>
        <p className="bist-legal">
          Veriler bilgilendirme ve paper karar desteği içindir; gerçek zamanlı
          değildir ve yatırım tavsiyesi oluşturmaz.
        </p>
      </section>
    </>
  );
}
