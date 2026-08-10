"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeMarket,
  makeDemoMarket,
  type AnalysisResult,
  type Candle,
  type IndicatorResult,
  type MarketPayload,
} from "@/lib/analysis";
import {
  fetchBinanceCandleHistory,
  fetchBinanceMarketSnapshot,
  fetchTopBinanceSymbols,
} from "@/lib/binance";
import {
  connectBinanceMarketStream,
  type BinanceStreamStatus,
} from "@/lib/binance-stream";
import { blendDecisionScores, decisionContextScore } from "@/lib/decision";
import type { MarketContextPayload } from "@/lib/market-context";
import type {
  PaperPositionRow,
  PaperTradeStatus,
} from "@/lib/paper-trading";
import BistTerminal from "./bist-terminal";
import BistPaper from "./bist-paper";
import CatalogExportPanel from "./catalog-export-panel";

type NavKey =
  | "Analiz"
  | "Tarayıcı"
  | "Fiyat Verisi"
  | "Paper Trade"
  | "BIST 80"
  | "BIST Paper"
  | "Alarmlar"
  | "Geçmiş"
  | "Ayarlar";

type LlmReview = {
  direction_score: number;
  confidence: number;
  tradeability_score: number;
  risk_score: number;
  approval: "approve" | "approve_with_caution" | "reject" | "uncertain" | "unconfigured";
  market_regime: string;
  top_reasons: string[];
  contradictions: string[];
  risk_flags: string[];
  summary_tr: string;
  provider: string;
  configured: boolean;
};

type AlertRule = {
  id: string;
  symbol: string;
  interval: string;
  direction: "above" | "below";
  threshold: number;
  active: boolean;
  createdAt: number;
  lastTriggered?: number;
};

type SignalLog = {
  id: string;
  timestamp: number;
  symbol: string;
  interval: string;
  quantScore: number;
  llmScore: number | null;
  finalScore: number;
  direction: string;
  approval: string;
};

type SymbolOption = {
  symbol: string;
  baseAsset: string;
  quoteAsset: "USDT";
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
};

type ScannerStatus = {
  configured: boolean;
  error?: string;
  config?: {
    enabled: number;
    last_heartbeat: number;
    last_error: string | null;
    scans_completed: number;
    alerts_sent: number;
    threshold: number;
    minimum_confidence: number;
  } | null;
  intervals: Array<{
    interval: string;
    cadence_seconds: number;
    last_completed_at: number;
    last_duration_ms: number;
    last_scanned_count: number;
    last_error: string | null;
  }>;
  leaders: Array<{
    symbol: string;
    base_asset: string;
    interval: string;
    final_score: number;
    quant_score: number;
    context_score: number | null;
    confidence: number;
    direction: string;
    price: number;
    last_scanned_at: number;
  }>;
  alerts: Array<{
    symbol: string;
    interval: string;
    direction: string;
    final_score: number;
    confidence: number;
    sent_at: number;
    status: string;
  }>;
  paper?: PaperTradeStatus;
};

const NAV: { label: NavKey; glyph: string }[] = [
  { label: "Analiz", glyph: "⌁" },
  { label: "Tarayıcı", glyph: "⌕" },
  { label: "Fiyat Verisi", glyph: "⇩" },
  { label: "Paper Trade", glyph: "₺" },
  { label: "BIST 80", glyph: "B" },
  { label: "BIST Paper", glyph: "P" },
  { label: "Alarmlar", glyph: "◉" },
  { label: "Geçmiş", glyph: "↻" },
  { label: "Ayarlar", glyph: "⚙" },
];

const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d", "1w"];
const FALLBACK_BASE_ASSETS = [
  "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "TRX", "AVAX", "SHIB",
  "LINK", "DOT", "BCH", "NEAR", "LTC", "APT", "UNI", "ETC", "ICP", "FIL",
  "HBAR", "ATOM", "ARB", "OP", "SUI", "INJ", "IMX", "AAVE", "MKR", "PEPE",
  "WIF", "TAO", "FET", "RENDER", "SEI", "TIA", "ALGO", "VET", "GRT", "THETA",
  "JASMY", "BONK", "FLOKI", "ENA", "PENDLE", "RUNE", "STX", "LDO", "CRV", "SAND",
];
const FALLBACK_SYMBOLS: SymbolOption[] = FALLBACK_BASE_ASSETS.map((baseAsset) => ({
  symbol: `${baseAsset}USDT`,
  baseAsset,
  quoteAsset: "USDT",
  lastPrice: 0,
  priceChangePercent: 0,
  quoteVolume: 0,
}));

const priceFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const compactFormatter = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const maximumFractionDigits = value < .01 ? 8 : value < 1 ? 5 : 2;
  return `$${new Intl.NumberFormat("tr-TR", { maximumFractionDigits, minimumFractionDigits: value < 1 ? 2 : 2 }).format(value)}`;
}

function scoreLabel(score: number) {
  if (score >= 55) return "STRONG LONG";
  if (score >= 20) return "LONG";
  if (score <= -55) return "STRONG SHORT";
  if (score <= -20) return "SHORT";
  return "NEUTRAL";
}

function scoreTone(score: number) {
  return score > 12 ? "positive" : score < -12 ? "negative" : "neutral";
}

function signedScore(score: number) {
  return `${score > 0 ? "+" : ""}${score}`;
}

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function restoreAlerts(value: string | null): AlertRule[] {
  const parsed: unknown = JSON.parse(value ?? "[]");
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 100).flatMap((item): AlertRule[] => {
    if (!isRecord(item)) return [];
    const direction = item.direction === "above" || item.direction === "below" ? item.direction : null;
    const threshold = Number(item.threshold);
    if (!direction || !Number.isFinite(threshold) || threshold <= 0) return [];
    return [{
      id: String(item.id || makeId()).slice(0, 100),
      symbol: String(item.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20),
      interval: TIMEFRAMES.includes(String(item.interval)) ? String(item.interval) : "15m",
      direction,
      threshold,
      active: Boolean(item.active),
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
      lastTriggered: Number.isFinite(Number(item.lastTriggered)) ? Number(item.lastTriggered) : undefined,
    }];
  });
}

function restoreLogs(value: string | null): SignalLog[] {
  const parsed: unknown = JSON.parse(value ?? "[]");
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 100).flatMap((item): SignalLog[] => {
    if (!isRecord(item)) return [];
    const quantScore = Number(item.quantScore);
    const finalScore = Number(item.finalScore);
    if (!Number.isFinite(quantScore) || !Number.isFinite(finalScore)) return [];
    const llmScore = item.llmScore === null ? null : Number(item.llmScore);
    return [{
      id: String(item.id || makeId()).slice(0, 100),
      timestamp: Number.isFinite(Number(item.timestamp)) ? Number(item.timestamp) : Date.now(),
      symbol: String(item.symbol || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20),
      interval: TIMEFRAMES.includes(String(item.interval)) ? String(item.interval) : "15m",
      quantScore,
      llmScore: llmScore === null || !Number.isFinite(llmScore) ? null : llmScore,
      finalScore,
      direction: String(item.direction || scoreLabel(finalScore)).slice(0, 40),
      approval: String(item.approval || "uncertain").slice(0, 40),
    }];
  });
}

function CandleChart({ candles, price, symbol, interval, loading }: { candles: Candle[]; price: number; symbol: string; interval: string; loading: boolean }) {
  const visible = candles.slice(-58);
  const width = 800;
  const height = 250;
  const high = Math.max(...visible.map((candle) => candle.high));
  const low = Math.min(...visible.map((candle) => candle.low));
  const range = high - low || 1;
  const y = (value: number) => 8 + ((high - value) / range) * (height - 22);
  const step = width / Math.max(visible.length, 1);
  const maxVolume = Math.max(...visible.map((candle) => candle.volume), 1);
  const closes = visible.map((candle) => candle.close);
  const ema: number[] = [];
  closes.forEach((value, index) => ema.push(index ? value * (2 / 21) + ema[index - 1] * (19 / 21) : value));
  const path = ema.map((value, index) => `${index ? "L" : "M"}${(index + .5) * step},${y(value)}`).join(" ");
  const priceY = y(price);

  return (
    <div className="chart-shell" aria-label={`${symbol} ${interval} canlı mum grafiği`} aria-busy={loading}>
      <div className="chart-watermark">{symbol} · {interval}</div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Seçili paritenin son mumları">
        <defs>
          <linearGradient id="priceArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#62f6bd" stopOpacity=".13" />
            <stop offset="100%" stopColor="#62f6bd" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((index) => <line key={index} x1="0" x2={width} y1={index * 62.5} y2={index * 62.5} className="grid-line" />)}
        {visible.map((candle, index) => {
          const up = candle.close >= candle.open;
          const x = index * step + step * .24;
          const bodyY = y(Math.max(candle.open, candle.close));
          const bodyHeight = Math.max(1.5, Math.abs(y(candle.open) - y(candle.close)));
          const volumeHeight = (candle.volume / maxVolume) * 35;
          return (
            <g key={candle.openTime}>
              <rect x={x} y={height - volumeHeight} width={Math.max(2, step * .52)} height={volumeHeight} className={up ? "volume up" : "volume down"} />
              <line x1={x + step * .26} x2={x + step * .26} y1={y(candle.high)} y2={y(candle.low)} className={up ? "wick up" : "wick down"} />
              <rect x={x} y={bodyY} width={Math.max(2, step * .52)} height={bodyHeight} rx="1" className={up ? "candle up" : "candle down"} />
            </g>
          );
        })}
        <path d={path} className="ema-line" />
        <line x1="0" x2={width} y1={priceY} y2={priceY} className="price-line" />
      </svg>
      <div className="price-tag" style={{ top: `${Math.max(8, Math.min(228, priceY))}px` }}>{formatPrice(price)}</div>
      <div className="chart-axis"><span>−58 mum</span><span>−40</span><span>−20</span><span>Son mum</span></div>
      {loading && <div className="chart-loading"><span /><b>{symbol} · {interval} yükleniyor</b></div>}
    </div>
  );
}

function ScoreRing({ score, label, tone, muted = false }: { score: number; label: string; tone: "mint" | "violet"; muted?: boolean }) {
  const normalized = Math.abs(score);
  const angle = Math.round((normalized / 100) * 270);
  return (
    <div className={`score-unit ${muted ? "muted" : ""}`}>
      <div className={`score-ring ${tone} ${score < 0 ? "negative" : ""}`} style={{ "--angle": `${angle}deg` } as React.CSSProperties}>
        <div><strong>{score > 0 ? "+" : ""}{score}</strong><span>/100</span></div>
      </div>
      <p>{label}</p>
    </div>
  );
}

function IndicatorTable({ indicators }: { indicators: IndicatorResult[] }) {
  const [expanded, setExpanded] = useState(false);
  const [family, setFamily] = useState("Tümü");
  const families = ["Tümü", ...Array.from(new Set(indicators.map((item) => item.family)))];
  const filtered = family === "Tümü" ? indicators : indicators.filter((item) => item.family === family);
  const visible = expanded ? filtered : filtered.slice(0, 8);
  return (
    <section className="panel indicator-panel">
      <div className="panel-head indicator-head">
        <div><span className="eyebrow">FEATURE REGISTRY · {indicators.length} HESAP</span><h2>Tek tek indikatör yorumları</h2></div>
        <div className="table-actions">
          <select value={family} onChange={(event) => setFamily(event.target.value)} aria-label="İndikatör ailesi">{families.map((item) => <option key={item}>{item}</option>)}</select>
          <button className="ghost-button" onClick={() => setExpanded(!expanded)}>{expanded ? "Daralt ↑" : `Tümünü göster →`}</button>
        </div>
      </div>
      <div className="indicator-table" role="table" aria-label="İndikatör sonuçları">
        <div className="table-row table-head" role="row"><span>İndikatör</span><span>Değer</span><span>Durum</span><span>Puan</span><span>Deterministik yorum</span></div>
        {visible.map((item) => (
          <div className="table-row" role="row" key={item.id}>
            <span><b>{item.name}</b><small>{item.family}</small></span>
            <span>{item.value}</span>
            <span className={`pill-cell ${scoreTone(item.score)}`}>{item.state}</span>
            <span className={scoreTone(item.score)}>{item.directional ? `${item.score > 0 ? "+" : ""}${item.score}` : "—"}</span>
            <span>{item.interpretation}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MultiTimeframe({ analyses, current }: { analyses: Record<string, AnalysisResult>; current: string }) {
  return (
    <section className="panel mtf-panel">
      <div className="panel-head"><div><span className="eyebrow">ÇOKLU ZAMAN DİLİMİ</span><h2>Trend hizalanması</h2></div><span className="data-note">Kapanmış mumlar</span></div>
      <div className="mtf-grid">
        {TIMEFRAMES.map((interval) => {
          const item = analyses[interval];
          const score = item?.quantScore ?? 0;
          return <div key={interval} className={`mtf-card ${interval === current ? "current" : ""}`}><span>{interval}</span><strong className={scoreTone(score)}>{score > 0 ? "+" : ""}{score}</strong><small>{item ? scoreLabel(score) : "Yükleniyor"}</small><i><b style={{ width: `${Math.abs(score)}%` }} className={scoreTone(score)} /></i></div>;
        })}
      </div>
    </section>
  );
}

function MarketContextPanel({ context, loading }: { context: MarketContextPayload | null; loading: boolean }) {
  const global = context?.global;
  const fear = context?.fearGreed;
  const breadth = context?.breadth;
  const news = context?.news.items ?? [];
  const overall = context?.scores.overall ?? 0;
  return (
    <section className="panel context-panel" aria-busy={loading}>
      <div className="panel-head">
        <div><span className="eyebrow">GLOBAL PİYASA BAĞLAMI · KARARA DAHİL</span><h2>{loading ? "Endeksler güncelleniyor…" : context?.scores.label ?? "Bağlam verisi bekleniyor"}</h2></div>
        <span className={`context-score ${scoreTone(overall)}`}>{context ? signedScore(overall) : "—"} / 100</span>
      </div>
      <div className="context-layout">
        <div className="context-kpis">
          <article><small>Toplam piyasa değeri</small><strong>{global?.available ? `$${compactFormatter.format(global.totalMarketCap)}` : "—"}</strong><span>Coinranking global</span></article>
          <article><small>Global 24s hacim</small><strong>{global?.available ? `$${compactFormatter.format(global.total24hVolume)}` : "—"}</strong><span>{global?.available ? `Devir oranı %${priceFormatter.format(global.turnoverRate)}` : "Veri bekleniyor"}</span></article>
          <article><small>BTC dominansı</small><strong>{global?.available ? `%${priceFormatter.format(global.btcDominance)}` : "—"}</strong><span>{global?.available ? `${compactFormatter.format(global.totalCoins)} aktif coin` : "Rotasyon endeksi"}</span></article>
          <article><small>Fear & Greed</small><strong className={fear?.available ? scoreTone((fear.value - 50) * 2) : ""}>{fear?.available ? `${fear.value} · ${fear.label}` : "—"}</strong><span>Kaynak: Alternative.me {fear?.available ? `· Δ ${fear.change > 0 ? "+" : ""}${fear.change}` : ""}</span></article>
          <article><small>İlk 50 piyasa genişliği</small><strong className={breadth?.available ? scoreTone(context?.scores.breadth ?? 0) : ""}>{breadth?.available ? `%${priceFormatter.format(breadth.advanceRatio)} yükselen` : "—"}</strong><span>{breadth?.available ? `${breadth.advancers} ↑ · ${breadth.decliners} ↓ · Ort. ${breadth.averageChange > 0 ? "+" : ""}${priceFormatter.format(breadth.averageChange)}%` : "Binance hacim evreni"}</span></article>
          <article><small>Haber duyarlılığı</small><strong className={scoreTone(context?.scores.news ?? 0)}>{context ? signedScore(context.scores.news) : "—"}</strong><span>{news.length ? `${news.length} güncel global başlık` : "GDELT akışı bekleniyor"}</span></article>
        </div>
        <div className="news-feed">
          <div className="news-head"><b>Son global kripto haberleri</b><span>{context?.news.provider === "none" || !context ? "GDELT / Google News" : context.news.provider} · Güncel akış</span></div>
          {!news.length && <div className="news-empty">{loading ? "Haber akışı taranıyor…" : "Bu güncellemede haber akışı alınamadı; haber puanı karara katılmadı."}</div>}
          {news.map((item) => (
            <a href={item.url} target="_blank" rel="noreferrer noopener" key={`${item.domain}-${item.title}`}>
              <i className={scoreTone(item.sentiment)}>{item.sentiment > 0 ? "↑" : item.sentiment < 0 ? "↓" : "•"}</i>
              <span><b>{item.title}</b><small>{item.domain} · {new Date(item.publishedAt).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></span>
            </a>
          ))}
        </div>
      </div>
      <p className="context-method">Final karar; teknik quant skoru, global bağlam skoru ve yalnızca manuel çalıştırılırsa Gemini görüşünü ağırlıklı olarak birleştirir. Global hacim güveni, BTC dominansı ise BTC/altcoin rotasyon etkisini ayarlar; hacim tek başına yön sinyali sayılmaz.</p>
    </section>
  );
}

function AnalysisView({
  market,
  analysis,
  multi,
  llm,
  llmLoading,
  loading,
  context,
  contextLoading,
  liveDataReady,
  streamStatus,
  runLlmReview,
}: {
  market: MarketPayload;
  analysis: AnalysisResult;
  multi: Record<string, AnalysisResult>;
  llm: LlmReview | null;
  llmLoading: boolean;
  loading: boolean;
  context: MarketContextPayload | null;
  contextLoading: boolean;
  liveDataReady: boolean;
  streamStatus: BinanceStreamStatus;
  runLlmReview: () => void;
}) {
  const llmScore = llm?.direction_score ?? 0;
  const quantScore = liveDataReady ? analysis.quantScore : 0;
  const contextScore = liveDataReady ? decisionContextScore(context, market.symbol) : null;
  const conflict = liveDataReady && llm?.configured && Math.sign(llmScore) !== Math.sign(quantScore) && Math.abs(llmScore) >= 20 && Math.abs(quantScore) >= 20;
  const finalScore = liveDataReady ? blendDecisionScores(quantScore, contextScore, llm?.configured ? llmScore : null) : 0;
  const finalLabel = !liveDataReady ? "CANLI VERİ BEKLENİYOR" : conflict ? "CONFLICT / WAIT" : scoreLabel(finalScore);
  const reasons = liveDataReady ? (llm?.configured ? llm.top_reasons : analysis.reasons) : [];
  const risks = liveDataReady ? (llm?.configured ? [...llm.contradictions, ...llm.risk_flags] : analysis.contradictions) : [];
  const baseConfidence = llm?.configured ? analysis.confidence * .75 + llm.confidence * .25 : analysis.confidence;
  const activityAdjustment = context?.global.available ? Math.min(6, Math.max(-6, (context.global.turnoverRate - 2.5) * 4)) : 0;
  const finalConfidence = liveDataReady ? Math.round(Math.min(100, Math.max(0, baseConfidence + activityAdjustment))) : 0;

  return (
    <>
      {!liveDataReady && <div className="source-banner"><span>{market.source === "demo" ? "CANLI VERİ YOK" : "AKIŞ BEKLENİYOR"}</span> {market.source === "demo" ? "Binance geçmiş mumları alınamadı; Quant ve Gemini gerçek veri gelene kadar devre dışı." : `Binance WebSocket ${streamStatus === "reconnecting" ? "yeniden bağlanıyor" : "bağlantısı hazırlanıyor"}; son canlı grafik korunuyor.`}</div>}
      <div className="analysis-grid">
        <section className="panel chart-panel">
          <div className="panel-head"><div><span className="eyebrow">FİYAT AKIŞI · {market.symbol} · {market.interval}</span><h2>{analysis.regime}</h2></div><div className="legend"><span className="mint-dot" /> EMA20 <span className="amber-dot" /> Son fiyat</div></div>
          <CandleChart key={`${market.symbol}-${market.interval}-${market.candles.at(-1)?.openTime}`} candles={market.candles} price={analysis.price} symbol={market.symbol} interval={market.interval} loading={loading} />
          <div className="level-strip">
            <div><small>Destek 1</small><b>{formatPrice(analysis.supports[0])}</b></div>
            <div><small>Destek 2</small><b>{formatPrice(analysis.supports[1])}</b></div>
            <div><small>Direnç 1</small><b>{formatPrice(analysis.resistances[0])}</b></div>
            <div><small>ATR (14)</small><b>{formatPrice(analysis.atr)} · %{priceFormatter.format(analysis.atrPercent)}</b></div>
          </div>
        </section>

        <aside className="panel decision-panel">
          <div className="panel-head"><div><span className="eyebrow">KARAR MOTORU</span><h2>{finalLabel.replace("STRONG ", "Güçlü ")}</h2></div><span className={`approved ${conflict || !liveDataReady ? "rejected" : ""}`}>{!liveDataReady ? "● BEKLE" : conflict ? "● ÇELİŞKİ" : llm?.configured ? "● LLM ONAYI" : "● QUANT"}</span></div>
          <div className="score-pair">
            <ScoreRing score={quantScore} label="Quant engine" tone="mint" />
            <ScoreRing score={llmScore} label={llm?.configured ? `LLM · ${llm.provider}` : "Demo approver"} tone="violet" muted={!llm} />
          </div>
          <button className="llm-run" disabled={!liveDataReady || llmLoading || loading || contextLoading} onClick={runLlmReview}>{!liveDataReady ? "Canlı Binance verisi bekleniyor…" : loading ? "Piyasa verisi bekleniyor…" : contextLoading ? "Global bağlam bekleniyor…" : llmLoading ? "Gemini değerlendiriyor…" : llm?.configured ? "Gemini yorumunu yenile" : "Gemini değerlendirmesi iste"}</button>
          <div className="context-impact"><span>Global bağlam</span><strong className={contextScore === null ? "neutral" : scoreTone(contextScore)}>{contextScore === null ? "—" : signedScore(contextScore)}</strong><small>{context?.scores.label ?? "Veri bekleniyor"}</small></div>
          <div className={`consensus ${conflict ? "conflict" : ""}`}><div><small>FINAL CONSENSUS</small><strong>{finalScore > 0 ? "+" : ""}{finalScore}</strong></div><span>{finalLabel}</span></div>
          <div className="confidence"><div><span>Güven · global hacim ayarlı</span><b>%{finalConfidence}</b></div><div className="meter"><i style={{ width: `${finalConfidence}%` }} /></div></div>
          <div className="reason-list">
            {reasons.slice(0, 2).map((reason, index) => <p key={reason}><span>{index ? "◫" : "↑"}</span><b>{index ? "İkinci teyit" : "Ana gerekçe"}</b><small>{reason}</small></p>)}
            {risks.slice(0, 1).map((risk) => <p className="warn" key={risk}><span>!</span><b>Risk bayrağı</b><small>{risk}</small></p>)}
          </div>
          {llm && <div className={`llm-note ${llm.configured ? "" : "demo"}`}><b>{llm.configured ? "LLM yorumu" : "Demo modu"}</b><p>{llm.summary_tr}</p></div>}
        </aside>
      </div>
      <MarketContextPanel context={context} loading={contextLoading} />
      <MultiTimeframe analyses={multi} current={analysis.interval} />
      <IndicatorTable indicators={analysis.indicators} />
    </>
  );
}

function cadenceLabel(seconds: number) {
  if (seconds < 60) return `${seconds} sn`;
  if (seconds < 3_600) return `${seconds / 60} dk`;
  return `${seconds / 3_600} sa`;
}

function ScannerView({ rows, onSelect, loading, status, now }: { rows: SymbolOption[]; onSelect: (symbol: string) => void; loading: boolean; status: ScannerStatus | null; now: number }) {
  const heartbeatAge = status?.config?.last_heartbeat
    ? Math.max(0, Math.round((now - status.config.last_heartbeat) / 1_000))
    : null;
  const live = Boolean(status?.configured && status.config?.enabled && heartbeatAge !== null && heartbeatAge < 180);
  const intervals = status?.intervals?.length ? status.intervals : [
    { interval: "5m", cadence_seconds: 15, last_completed_at: 0, last_duration_ms: 0, last_scanned_count: 0, last_error: null },
    { interval: "15m", cadence_seconds: 45, last_completed_at: 0, last_duration_ms: 0, last_scanned_count: 0, last_error: null },
    { interval: "1h", cadence_seconds: 120, last_completed_at: 0, last_duration_ms: 0, last_scanned_count: 0, last_error: null },
    { interval: "4h", cadence_seconds: 300, last_completed_at: 0, last_duration_ms: 0, last_scanned_count: 0, last_error: null },
    { interval: "1d", cadence_seconds: 900, last_completed_at: 0, last_duration_ms: 0, last_scanned_count: 0, last_error: null },
    { interval: "1w", cadence_seconds: 3_600, last_completed_at: 0, last_duration_ms: 0, last_scanned_count: 0, last_error: null },
  ];
  return (
    <>
      <section className="panel module-panel scanner-engine">
        <div className="panel-head"><div><span className="eyebrow">MASAÜSTÜ OTOMATİK SİNYAL MOTORU</span><h2>Zaman dilimine özel sürekli puanlama</h2></div><span className={live ? "integration-ok" : "integration-warn"}>{live ? "Canlı" : status?.configured ? "Başlatılıyor" : "Bağlantı bekliyor"}</span></div>
        <div className="scanner-engine-grid">
          <article><small>Son kalp atışı</small><strong>{heartbeatAge === null ? "—" : `${heartbeatAge} sn önce`}</strong><span>Canlı Binance motoru masaüstü görevinden senkronlanır.</span></article>
          <article><small>Toplam puanlama</small><strong>{compactFormatter.format(status?.config?.scans_completed ?? 0)}</strong><span>Yalnızca canlı Binance mum güncellemeleri.</span></article>
          <article><small>Gönderilen sinyal</small><strong>{status?.config?.alerts_sent ?? 0}</strong><span>Eşik ±{status?.config?.threshold ?? 55} · güven %{status?.config?.minimum_confidence ?? 70}</span></article>
          <article><small>LLM kullanımı</small><strong>0 istek</strong><span>Gemini yalnızca manuel analiz düğmesinde.</span></article>
        </div>
        <div className="scanner-cadences">
          {intervals.map((item) => <span key={item.interval}><b>{item.interval}</b><small>{cadenceLabel(item.cadence_seconds)}</small><i className={item.last_completed_at ? "done" : ""} /></span>)}
        </div>
        {status?.config?.last_error && <p className="scanner-error">{status.config.last_error}</p>}
        {!!status?.leaders?.length && <div className="leader-board">
          <div className="leader-row leader-head"><span>Güçlü adaylar</span><span>Frame</span><span>Final</span><span>Quant</span><span>Güven</span><span>Son ölçüm</span></div>
          {status.leaders.slice(0, 10).map((item) => <div className="leader-row" key={`${item.symbol}-${item.interval}`}><span><b>{item.base_asset}/USDT</b></span><span>{item.interval}</span><span className={scoreTone(item.final_score)}>{signedScore(item.final_score)}</span><span>{signedScore(item.quant_score)}</span><span>%{item.confidence}</span><span>{new Date(item.last_scanned_at).toLocaleTimeString("tr-TR")}</span></div>)}
        </div>}
      </section>
      <section className="panel module-panel">
        <div className="panel-head"><div><span className="eyebrow">PİYASA TARAYICI · STABLECOIN HARİÇ</span><h2>USDT hacmine göre ilk 50 coin</h2></div><span className="data-note">{loading ? "Binance listesi güncelleniyor…" : "24 saatlik hacim sırası"}</span></div>
        <div className="scanner-table">
          <div className="scanner-row scanner-head"><span>#</span><span>Parite</span><span>Son fiyat</span><span>24s değişim</span><span>24s hacim</span><span /></div>
          {rows.slice(0, 50).map((row, index) => <div className="scanner-row" key={row.symbol}><span>{index + 1}</span><span><b>{row.baseAsset}/USDT</b><small>Binance Spot</small></span><span>{formatPrice(row.lastPrice)}</span><span className={row.priceChangePercent > 0 ? "positive" : row.priceChangePercent < 0 ? "negative" : "neutral"}>{row.lastPrice ? `${row.priceChangePercent > 0 ? "+" : ""}${priceFormatter.format(row.priceChangePercent)}%` : "—"}</span><span>{row.quoteVolume ? `$${compactFormatter.format(row.quoteVolume)}` : "—"}</span><span><button onClick={() => onSelect(row.symbol)}>Analiz et →</button></span></div>)}
        </div>
      </section>
    </>
  );
}

const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function tryValue(value: number) {
  return tryFormatter.format(Number.isFinite(value) ? value : 0);
}

function paperDuration(openedAt: number, closedAt: number | null, now: number) {
  const seconds = Math.max(
    0,
    Math.round(((closedAt ?? now) - openedAt) / 1_000),
  );
  if (seconds < 60) return `${seconds} sn`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} dk`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} sa`;
  return `${Math.floor(seconds / 86_400)} gün`;
}

function paperCloseLabel(reason: string | null) {
  if (reason === "score-normalized") return "Puan normale döndü";
  if (reason === "direction-reversal") return "Yön tersine döndü";
  if (reason === "liquidation") return "Tasfiye";
  return "Açık";
}

function PaperPositionTable({
  positions,
  now,
  history = false,
}: {
  positions: PaperPositionRow[];
  now: number;
  history?: boolean;
}) {
  return (
    <div className="paper-table">
      <div className="paper-row paper-head">
        <span>Parite / Frame</span>
        <span>Yön</span>
        <span>Giriş / Mark</span>
        <span>Puan</span>
        <span>Marjin / Kaldıraç</span>
        <span>Net P/L</span>
        <span>{history ? "Kapanış" : "Süre / Liq."}</span>
      </div>
      {!positions.length && (
        <div className="empty-inline">
          {history
            ? "Henüz kapanmış paper işlem yok."
            : "Giriş koşullarını sağlayan ilk fırsat bekleniyor."}
        </div>
      )}
      {positions.map((position) => {
        const roe = position.margin
          ? (position.net_pnl / position.margin) * 100
          : 0;
        return (
          <div className="paper-row" key={position.id}>
            <span>
              <b>{position.base_asset}/USDT</b>
              <small>{position.interval} · #{position.id}</small>
            </span>
            <span>
              <i className={`paper-side ${position.direction}`}>
                {position.direction.toUpperCase()}
              </i>
            </span>
            <span>
              <b>{formatPrice(position.entry_price)}</b>
              <small>→ {formatPrice(position.mark_price)}</small>
            </span>
            <span>
              <b className={scoreTone(position.current_score)}>
                {signedScore(position.current_score)}
              </b>
              <small>Giriş {signedScore(position.entry_score)}</small>
            </span>
            <span>
              <b>{tryValue(position.margin)}</b>
              <small>{position.leverage}x · {tryValue(position.notional)}</small>
            </span>
            <span>
              <b className={position.net_pnl >= 0 ? "positive" : "negative"}>
                {tryValue(position.net_pnl)}
              </b>
              <small className={roe >= 0 ? "positive" : "negative"}>
                ROE {roe >= 0 ? "+" : ""}{priceFormatter.format(roe)}%
              </small>
            </span>
            <span>
              <b>
                {history
                  ? paperCloseLabel(position.close_reason)
                  : paperDuration(position.opened_at, null, now)}
              </b>
              <small>
                {history
                  ? paperDuration(position.opened_at, position.closed_at, now)
                  : `Liq. ${formatPrice(position.liquidation_price)}`}
              </small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PaperTradeView({
  status,
  now,
}: {
  status: ScannerStatus | null;
  now: number;
}) {
  const paper = status?.paper;
  const account = paper?.account;
  const metrics = paper?.metrics;
  const cycleAge = account?.last_cycle_at
    ? Math.max(0, Math.round((now - account.last_cycle_at) / 1_000))
    : null;
  const live = Boolean(
    status?.configured &&
      status.config?.enabled &&
      cycleAge !== null &&
      cycleAge < 180,
  );
  return (
    <>
      <section className="panel module-panel paper-hero">
        <div>
          <span className="eyebrow">OTOMATİK 5X PAPER PORTFÖY</span>
          <h2>En güçlü 5 fırsat, gerçek Binance Futures maliyet modeli</h2>
          <p>
            Stablecoin hariç 50 paritenin tüm zaman dilimleri karşılaştırılır.
            Aynı coinin en güçlü frame’i seçilir; puan nötrleşince işlem kapanır.
          </p>
        </div>
        <div className="paper-equity">
          <small>ANLIK PORTFÖY DEĞERİ</small>
          <strong className={(metrics?.totalNetPnl ?? 0) >= 0 ? "positive" : "negative"}>
            {tryValue(metrics?.equity ?? 100_000)}
          </strong>
          <span className={live ? "integration-ok" : "integration-warn"}>
            {live ? `Canlı · ${cycleAge} sn` : "Motor bekleniyor"}
          </span>
        </div>
      </section>

      <section className="paper-kpi-grid">
        <article className="panel">
          <small>Ana para</small>
          <strong>{tryValue(account?.initial_balance ?? 100_000)}</strong>
          <span>Sabit başlangıç kasası</span>
        </article>
        <article className="panel">
          <small>Kullanılabilir nakit</small>
          <strong>{tryValue(metrics?.availableCash ?? 100_000)}</strong>
          <span>Marjin ve giriş maliyetleri sonrası</span>
        </article>
        <article className="panel">
          <small>Açık işlem</small>
          <strong>{metrics?.openPositions ?? 0} / {account?.max_positions ?? 10}</strong>
          <span>{tryValue(metrics?.reservedMargin ?? 0)} bağlı marjin</span>
        </article>
        <article className="panel">
          <small>Total net P/L</small>
          <strong className={(metrics?.totalNetPnl ?? 0) >= 0 ? "positive" : "negative"}>
            {tryValue(metrics?.totalNetPnl ?? 0)}
          </strong>
          <span>Realized + unrealized, tüm maliyetler dahil</span>
        </article>
        <article className="panel">
          <small>Realized P/L</small>
          <strong className={(metrics?.realizedNetPnl ?? 0) >= 0 ? "positive" : "negative"}>
            {tryValue(metrics?.realizedNetPnl ?? 0)}
          </strong>
          <span>{metrics?.closedTrades ?? 0} kapanmış işlem</span>
        </article>
        <article className="panel">
          <small>Unrealized P/L</small>
          <strong className={(metrics?.unrealizedNetPnl ?? 0) >= 0 ? "positive" : "negative"}>
            {tryValue(metrics?.unrealizedNetPnl ?? 0)}
          </strong>
          <span>Açık işlemlerin net mark-to-market değeri</span>
        </article>
        <article className="panel">
          <small>Komisyon + kayma</small>
          <strong>{tryValue((metrics?.totalFees ?? 0) + (metrics?.totalSlippage ?? 0))}</strong>
          <span>{tryValue(metrics?.totalFees ?? 0)} fee · {tryValue(metrics?.totalSlippage ?? 0)} slip</span>
        </article>
        <article className="panel">
          <small>Funding / başarı</small>
          <strong className={(metrics?.fundingPnl ?? 0) >= 0 ? "positive" : "negative"}>
            {tryValue(metrics?.fundingPnl ?? 0)}
          </strong>
          <span>Kazanma oranı %{priceFormatter.format(metrics?.winRate ?? 0)}</span>
        </article>
      </section>

      <section className="panel module-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">AÇIK POZİSYONLAR</span>
            <h2>Binance mark fiyatıyla canlı net P/L</h2>
          </div>
          <span className="data-note">
            İşlem başına {tryValue(account?.margin_per_trade ?? 1_000)} · {account?.leverage ?? 5}x
          </span>
        </div>
        <PaperPositionTable
          positions={paper?.openPositions ?? []}
          now={now}
        />
      </section>

      <section className="panel module-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">PAPER TRADE JOURNAL</span>
            <h2>Son kapanan işlemler</h2>
          </div>
          <span className="data-note">Net sonuç · tüm maliyetler dahil</span>
        </div>
        <PaperPositionTable
          positions={paper?.history ?? []}
          now={now}
          history
        />
      </section>

      <section className="paper-method">
        <span>MODEL</span>
        <p>
          Giriş: en yüksek mutlak final puanlı, güveni en az %
          {account?.minimum_confidence ?? 70} olan 10 benzersiz parite ve minimum
          ±{account?.entry_score ?? 30} puan. Çıkış: puan ±
          {account?.exit_score ?? 15} nötr bölgesine dönerse, yön tersine
          dönerse veya izole tasfiye seviyesine ulaşırsa. Hesap; çift taraflı
          taker komisyonunu, çift taraflı %{((account?.slippage_rate ?? .0002) * 100).toFixed(2)}
          {" "}kaymayı ve Binance’ın canlı funding oranını net P/L’ye dahil eder.
        </p>
      </section>
    </>
  );
}

function AlertsView({ alerts, setAlerts, market, gmailConfigured }: { alerts: AlertRule[]; setAlerts: (alerts: AlertRule[]) => void; market: MarketPayload; gmailConfigured: boolean }) {
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [threshold, setThreshold] = useState(String(Math.round(market.ticker.lastPrice)));
  const addAlert = () => {
    const value = Number(threshold);
    if (!Number.isFinite(value) || value <= 0) return;
    setAlerts([{ id: makeId(), symbol: market.symbol, interval: market.interval, direction, threshold: value, active: true, createdAt: Date.now() }, ...alerts]);
  };
  const remove = (id: string) => setAlerts(alerts.filter((alert) => alert.id !== id));
  const toggle = (id: string) => setAlerts(alerts.map((alert) =>
    alert.id === id
      ? { ...alert, active: !alert.active, lastTriggered: alert.active ? alert.lastTriggered : undefined }
      : alert
  ));
  return (
    <div className="module-grid">
      <section className="panel module-panel alert-builder">
        <div className="panel-head"><div><span className="eyebrow">YENİ KURAL</span><h2>Fiyat alarmı oluştur</h2></div><span className={gmailConfigured ? "integration-ok" : "integration-warn"}>{gmailConfigured ? "Gmail bağlı" : "E-posta bekliyor"}</span></div>
        <label>Parite<input value={market.symbol} disabled /></label>
        <label>Zaman dilimi<input value={market.interval} disabled /></label>
        <label>Koşul<select value={direction} onChange={(event) => setDirection(event.target.value as "above" | "below")}><option value="above">Fiyat seviyenin üstüne çıkarsa</option><option value="below">Fiyat seviyenin altına inerse</option></select></label>
        <label>Fiyat seviyesi<input type="number" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
        <div className="builder-preview">IF <b>{market.symbol}</b> {direction === "above" ? ">" : "<"} <b>{formatPrice(Number(threshold))}</b> THEN <b>uygulama + Gmail</b></div>
        <button className="primary-button large" onClick={addAlert}>Alarmı kaydet</button>
        <p className="helper">Fiyat kuralları bu cihazda saklanır. Güçlü teknik fırsatlar için ayrı 24/7 sunucu tarayıcısı otomatik çalışır ve Gmail bildirimi gönderir.</p>
      </section>
      <section className="panel module-panel">
        <div className="panel-head"><div><span className="eyebrow">AKTİF ALARMLAR</span><h2>{alerts.length} kayıtlı kural</h2></div></div>
        <div className="alert-list">
          {!alerts.length && <div className="empty-state"><span>◉</span><b>Henüz alarm yok</b><p>Soldaki kural editöründen ilk alarmını oluştur.</p></div>}
          {alerts.map((alert) => {
            const distance = market.ticker.lastPrice ? ((alert.threshold / market.ticker.lastPrice) - 1) * 100 : 0;
            return <article key={alert.id} className={!alert.active ? "disabled" : ""}><div><span className={`rule-icon ${alert.direction}`}>{alert.direction === "above" ? "↑" : "↓"}</span><div><b>{alert.symbol} {alert.direction === "above" ? ">" : "<"} {formatPrice(alert.threshold)}</b><small>{alert.interval} · Seviyeye {distance >= 0 ? "+" : ""}{priceFormatter.format(distance)}%</small></div></div><div className="rule-actions"><button onClick={() => toggle(alert.id)}>{alert.active ? "Aktif" : "Kapalı"}</button><button onClick={() => remove(alert.id)}>Sil</button></div></article>;
          })}
        </div>
      </section>
    </div>
  );
}

function HistoryView({ logs }: { logs: SignalLog[] }) {
  return (
    <section className="panel module-panel">
      <div className="panel-head"><div><span className="eyebrow">SİNYAL JOURNAL</span><h2>Quant–LLM karar geçmişi</h2></div><span className="data-note">Triple Barrier etiketi sonraki sürüm</span></div>
      <div className="history-grid">
        <div className="history-kpi"><small>Toplam inceleme</small><strong>{logs.length}</strong></div><div className="history-kpi"><small>LLM onaylı</small><strong>{logs.filter((log) => log.approval.includes("approve")).length}</strong></div><div className="history-kpi"><small>Çelişki</small><strong>{logs.filter((log) => log.approval === "reject").length}</strong></div><div className="history-kpi"><small>Sonuç bekliyor</small><strong>{logs.length}</strong></div>
      </div>
      <div className="history-table">
        <div className="history-row history-head"><span>Zaman</span><span>Parite</span><span>Quant</span><span>LLM</span><span>Final</span><span>Karar</span><span>Onay</span></div>
        {!logs.length && <div className="empty-inline">İlk LLM değerlendirmesini çalıştırdığında burada görünecek.</div>}
        {logs.map((log) => <div className="history-row" key={log.id}><span>{new Date(log.timestamp).toLocaleString("tr-TR")}</span><span><b>{log.symbol}</b><small>{log.interval}</small></span><span className={scoreTone(log.quantScore)}>{log.quantScore > 0 ? "+" : ""}{log.quantScore}</span><span>{log.llmScore === null ? "—" : `${log.llmScore > 0 ? "+" : ""}${log.llmScore}`}</span><span className={scoreTone(log.finalScore)}>{log.finalScore > 0 ? "+" : ""}{log.finalScore}</span><span>{log.direction}</span><span>{log.approval}</span></div>)}
      </div>
    </section>
  );
}

function SettingsView({ llmStatus, gmailStatus, onTestGmail, gmailMessage }: { llmStatus: { configured: boolean; provider?: string; model?: string | null }; gmailStatus: { configured: boolean }; onTestGmail: () => void; gmailMessage: string }) {
  return (
    <div className="settings-grid">
      <section className="panel integration-card"><div className="integration-logo violet">AI</div><div><span className="eyebrow">SECOND APPROVER</span><h2>Gemini API</h2><p>Yapılandırılmış indikatör yorumlarını bağımsız modele gönderir; yön, güven, tradeability ve risk skoru alır.</p></div><div className="integration-status"><span className={llmStatus.configured ? "integration-ok" : "integration-warn"}>{llmStatus.configured ? "Bağlı" : "Demo modu"}</span><small>{llmStatus.configured ? `${llmStatus.provider} · ${llmStatus.model}` : "Sunucu secret ayarları bekleniyor"}</small></div></section>
      <section className="panel integration-card"><div className="integration-logo mint">M</div><div><span className="eyebrow">ALARM TESLİMATI</span><h2>Gmail SMTP</h2><p>Alarm koşulu gerçekleştiğinde teknik özet, puanlar ve güven bilgisiyle e-posta gönderir.</p></div><div className="integration-status"><span className={gmailStatus.configured ? "integration-ok" : "integration-warn"}>{gmailStatus.configured ? "Bağlı" : "Bağlantı bekliyor"}</span><button className="ghost-button" disabled={!gmailStatus.configured || gmailMessage === "Gönderiliyor…"} onClick={onTestGmail}>Test e-postası</button>{gmailMessage && <small>{gmailMessage}</small>}</div></section>
      <section className="panel settings-note"><span>GÜVENLİK</span><h3>Kimlik bilgileri tarayıcıya gönderilmez</h3><p>Gemini anahtarı ve Gmail uygulama şifresi yalnızca sunucu ortamında tutulur; tarayıcı depolamasında veya URL’de yer almaz.</p></section>
      <section className="panel settings-note"><span>AKTİF MOD</span><h3>Tamamen manuel · sıfır gereksiz token</h3><p>Gemini yalnızca analiz ekranındaki düğmeye tıkladığında çağrılır. Parite, zaman dilimi ve mum güncellemeleri otomatik LLM isteği oluşturmaz.</p></section>
    </div>
  );
}

export default function Home() {
  const [activeNav, setActiveNav] = useState<NavKey>("Analiz");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("15m");
  const [starred, setStarred] = useState(true);
  const [market, setMarket] = useState<MarketPayload>(() => makeDemoMarket("BTCUSDT", "15m"));
  const [multi, setMulti] = useState<Record<string, AnalysisResult>>({});
  const [loading, setLoading] = useState(true);
  const [llm, setLlm] = useState<LlmReview | null>(null);
  const [llmContextKey, setLlmContextKey] = useState("");
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmStatus, setLlmStatus] = useState<{ configured: boolean; provider?: string; model?: string | null }>({ configured: false });
  const [gmailStatus, setGmailStatus] = useState<{ configured: boolean }>({ configured: false });
  const [gmailMessage, setGmailMessage] = useState("");
  const [alerts, setAlertsState] = useState<AlertRule[]>([]);
  const [logs, setLogsState] = useState<SignalLog[]>([]);
  const [symbolOptions, setSymbolOptions] = useState<SymbolOption[]>(FALLBACK_SYMBOLS);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [marketContext, setMarketContext] = useState<MarketContextPayload | null>(null);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [freshnessNow, setFreshnessNow] = useState(0);
  const [streamStatus, setStreamStatus] = useState<BinanceStreamStatus>("connecting");
  const latestMarketRef = useRef(market);
  const analysis = useMemo(() => analyzeMarket(market), [market]);
  const lastCandleOpenTime = market.candles.at(-1)?.openTime;
  const currentContextKey = `${market.symbol}-${market.interval}-${lastCandleOpenTime ?? 0}-${marketContext?.updatedAt ?? 0}`;
  const displayedLlm = llmContextKey === currentContextKey ? llm : null;

  const persistAlerts = useCallback((next: AlertRule[]) => {
    setAlertsState(next);
    localStorage.setItem("quantscope-alerts", JSON.stringify(next));
  }, []);
  const persistLog = useCallback((entry: SignalLog) => {
    setLogsState((current) => {
      const next = [entry, ...current].slice(0, 100);
      localStorage.setItem("quantscope-signals", JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    latestMarketRef.current = market;
  }, [market]);

  useEffect(() => {
    let disposed = false;
    const restoreTimer = window.setTimeout(() => {
      try {
        setAlertsState(restoreAlerts(localStorage.getItem("quantscope-alerts")));
        setLogsState(restoreLogs(localStorage.getItem("quantscope-signals")));
      } catch { /* device-local state can safely reset */ }
    }, 0);
    Promise.all([
      fetch("/api/llm-review").then(async (response) =>
        await response.json() as { configured: boolean; provider?: string; model?: string | null }
      ),
      fetch("/api/email").then(async (response) =>
        await response.json() as { configured: boolean }
      ),
    ]).then(([llmHealth, gmailHealth]) => {
      if (disposed) return;
      setLlmStatus(llmHealth);
      setGmailStatus(gmailHealth);
    }).catch(() => undefined);
    const loadSymbols = async () => {
      try {
        const browserDirectory = await fetchTopBinanceSymbols(50);
        if (browserDirectory.source === "binance" && browserDirectory.symbols.length === 50) {
          if (!disposed) setSymbolOptions(browserDirectory.symbols);
          return;
        }
        const response = await fetch("/api/symbols", { cache: "no-store" });
        if (!response.ok) throw new Error("Symbol directory failed");
        const directory = await response.json() as { symbols?: SymbolOption[]; source?: string };
        if (!disposed && directory.source === "binance" && Array.isArray(directory.symbols) && directory.symbols.length === 50) {
          setSymbolOptions(directory.symbols);
        }
      } catch {
        // Keep the explicit fallback list when neither browser nor server can reach Binance.
      } finally {
        if (!disposed) setSymbolsLoading(false);
      }
    };
    void loadSymbols();
    return () => {
      disposed = true;
      window.clearTimeout(restoreTimer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setFreshnessNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    const loadScannerStatus = async () => {
      try {
        const response = await fetch("/api/scanner", { cache: "no-store" });
        const nextStatus = await response.json() as ScannerStatus;
        if (!disposed) setScannerStatus(nextStatus);
      } catch {
        // Keep the last valid scanner snapshot when status polling is interrupted.
      }
    };
    void loadScannerStatus();
    const timer = window.setInterval(loadScannerStatus, 15_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadContext = async () => {
      setContextLoading(true);
      try {
        const response = await fetch("/api/context", { cache: "no-store" });
        if (!response.ok) throw new Error("Market context failed");
        const nextContext = await response.json() as MarketContextPayload;
        if (!cancelled) setMarketContext(nextContext);
      } catch {
        // Keep the last successful context; a missing feed must not stop technical analysis.
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    };
    void loadContext();
    const timer = window.setInterval(loadContext, 10 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        let data: MarketPayload;
        try {
          data = await fetchBinanceMarketSnapshot(symbol, timeframe, 300);
        } catch {
          const response = await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`, { cache: "no-store" });
          if (!response.ok) throw new Error("Market data failed");
          data = await response.json() as MarketPayload;
          if (data.source !== "binance") throw new Error("Live Binance market unavailable");
        }
        if (!cancelled) setMarket(data);
      } catch {
        if (!cancelled) setMarket(makeDemoMarket(symbol, timeframe));
      } finally {
        if (!cancelled && showLoading) setLoading(false);
      }
    };
    void load(true);
    const timer = window.setInterval(() => void load(false), 5 * 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [symbol, timeframe]);

  useEffect(() => {
    return connectBinanceMarketStream(symbol, timeframe, {
      onMarketUpdate: setMarket,
      onStatus: setStreamStatus,
    });
  }, [symbol, timeframe]);

  useEffect(() => {
    if (market.symbol !== symbol || market.source !== "binance") return;
    let cancelled = false;
    const loadMultiTimeframe = async () => {
      const baseMarket = latestMarketRef.current;
      if (baseMarket.symbol !== symbol || baseMarket.source !== "binance") return;
      const settled = await Promise.allSettled(
        TIMEFRAMES.map(async (interval) => [
          interval,
          await fetchBinanceCandleHistory(symbol, interval, 260, true),
        ] as const),
      );
      if (cancelled) return;
      const results: Record<string, AnalysisResult> = {};
      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        const [interval, candles] = result.value;
        results[interval] = analyzeMarket({ ...baseMarket, symbol, interval, candles, source: "binance" });
      }
      setMulti(results);
    };
    void loadMultiTimeframe();
    const timer = window.setInterval(() => void loadMultiTimeframe(), 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [symbol, market.symbol, market.source]);

  const runLlmReview = useCallback(async () => {
    if (
      market.source !== "binance" ||
      streamStatus !== "live" ||
      Date.now() - market.fetchedAt > 10_000
    ) return;
    setLlmLoading(true);
    try {
      const macroFacts: Array<{ name: string; family: string; correlationGroup: string; value: string; state: string; interpretation: string; score: number }> = [];
      if (marketContext?.global.available) {
        macroFacts.push({
          name: "Global piyasa hacmi ve dominans",
          family: "Global bağlam",
          correlationGroup: "macro-market-activity",
          value: `$${compactFormatter.format(marketContext.global.total24hVolume)}`,
          state: `BTC dominansı %${priceFormatter.format(marketContext.global.btcDominance)}`,
          interpretation: `Toplam piyasa değeri $${compactFormatter.format(marketContext.global.totalMarketCap)}, 24 saatlik hacim $${compactFormatter.format(marketContext.global.total24hVolume)}, devir oranı %${priceFormatter.format(marketContext.global.turnoverRate)}. Hacim tek başına yön sinyali değildir.`,
          score: 0,
        });
      }
      if (marketContext?.fearGreed.available) {
        macroFacts.push({
          name: "Fear & Greed",
          family: "Global bağlam",
          correlationGroup: "macro-sentiment",
          value: String(marketContext.fearGreed.value),
          state: marketContext.fearGreed.label,
          interpretation: `Alternative.me Fear & Greed ${marketContext.fearGreed.value}; önceki değer ${marketContext.fearGreed.previous}.`,
          score: marketContext.scores.fear,
        });
      }
      if (marketContext?.breadth.available) {
        macroFacts.push({
          name: "İlk 50 piyasa genişliği",
          family: "Global bağlam",
          correlationGroup: "macro-breadth",
          value: `%${priceFormatter.format(marketContext.breadth.advanceRatio)}`,
          state: marketContext.scores.breadth > 12 ? "Risk iştahı" : marketContext.scores.breadth < -12 ? "Riskten kaçış" : "Dengeli",
          interpretation: `${marketContext.breadth.advancers} yükselen, ${marketContext.breadth.decliners} düşen; ortalama değişim ${marketContext.breadth.averageChange > 0 ? "+" : ""}${priceFormatter.format(marketContext.breadth.averageChange)}%.`,
          score: marketContext.scores.breadth,
        });
      }
      if (marketContext?.news.available) {
        macroFacts.push({
          name: "Global haber duyarlılığı",
          family: "Global bağlam",
          correlationGroup: "macro-news",
          value: signedScore(marketContext.scores.news),
          state: marketContext.scores.news > 12 ? "Pozitif" : marketContext.scores.news < -12 ? "Negatif" : "Nötr",
          interpretation: `${marketContext.news.items.length} güncel global kripto başlığının deterministik duyarlılık özeti.`,
          score: marketContext.scores.news,
        });
      }
      const response = await fetch("/api/llm-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: analysis.symbol,
          interval: analysis.interval,
          regime: analysis.regime,
          levels: { supports: analysis.supports, resistances: analysis.resistances, atr: analysis.atr },
          facts: [
            ...analysis.indicators.map((item) => ({ name: item.name, family: item.family, correlationGroup: item.correlationGroup, value: item.value, state: item.state, interpretation: item.interpretation, score: item.score })),
            ...macroFacts,
          ],
        }),
      });
      if (!response.ok) throw new Error("LLM review failed");
      const review = await response.json() as LlmReview;
      setLlm(review);
      setLlmContextKey(currentContextKey);
      const contextScore = decisionContextScore(marketContext, analysis.symbol);
      const finalScore = blendDecisionScores(analysis.quantScore, contextScore, review.configured ? review.direction_score : null);
      const entry: SignalLog = { id: makeId(), timestamp: Date.now(), symbol: analysis.symbol, interval: analysis.interval, quantScore: analysis.quantScore, llmScore: review.configured ? review.direction_score : null, finalScore, direction: scoreLabel(finalScore), approval: review.approval };
      persistLog(entry);
    } catch {
      setLlm(null);
      setLlmContextKey("");
    } finally {
      setLlmLoading(false);
    }
  }, [analysis, currentContextKey, market.source, market.fetchedAt, marketContext, persistLog, streamStatus]);

  useEffect(() => {
    if (
      market.source !== "binance" ||
      streamStatus !== "live" ||
      Date.now() - market.fetchedAt > 10_000
    ) return;
    const now = Date.now();
    let changed = false;
    const next = alerts.map((alert) => {
      if (!alert.active || alert.symbol !== market.symbol || alert.lastTriggered) return alert;
      const hit = alert.direction === "above" ? market.ticker.lastPrice >= alert.threshold : market.ticker.lastPrice <= alert.threshold;
      if (!hit) return alert;
      changed = true;
      if (gmailStatus.configured) {
        fetch("/api/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "alert",
            symbol: alert.symbol,
            interval: alert.interval,
            direction: analysis.direction,
            lastPrice: market.ticker.lastPrice,
            threshold: alert.threshold,
            quantScore: analysis.quantScore,
            confidence: analysis.confidence,
          }),
        }).catch(() => undefined);
      }
      return { ...alert, lastTriggered: now, active: false };
    });
    if (changed) window.setTimeout(() => persistAlerts(next), 0);
  }, [market.ticker.lastPrice, market.symbol, market.source, market.fetchedAt, alerts, analysis, gmailStatus.configured, persistAlerts, streamStatus]);

  const testGmail = async () => {
    setGmailMessage("Gönderiliyor…");
    try {
      const response = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test" }) });
      setGmailMessage(response.ok ? "Test e-postası gönderildi." : "Gönderim başarısız.");
    } catch { setGmailMessage("Gönderim başarısız."); }
  };

  const changeSymbol = (nextSymbol: string) => {
    if (nextSymbol === symbol) return;
    setLoading(true);
    setSymbol(nextSymbol);
    setMarket(makeDemoMarket(nextSymbol, timeframe));
    setMulti({});
    setStreamStatus("connecting");
    setLlm(null);
    setLlmContextKey("");
  };
  const changeTimeframe = (nextTimeframe: string) => {
    if (nextTimeframe === timeframe) return;
    setLoading(true);
    setTimeframe(nextTimeframe);
    setMarket(makeDemoMarket(symbol, nextTimeframe));
    setMulti({});
    setStreamStatus("connecting");
    setLlm(null);
    setLlmContextKey("");
  };
  const selectScannerSymbol = (nextSymbol: string) => {
    changeSymbol(nextSymbol);
    setActiveNav("Analiz");
  };
  const freshness = Math.max(0, Math.round((freshnessNow - market.fetchedAt) / 1000));
  const liveDataReady =
    !loading &&
    market.source === "binance" &&
    market.symbol === symbol &&
    market.interval === timeframe &&
    streamStatus === "live" &&
    freshness <= 10;
  const streamLabel = liveDataReady
    ? "Binance WebSocket"
    : streamStatus === "reconnecting"
      ? "Akış yeniden bağlanıyor"
      : streamStatus === "connecting"
        ? "Binance bağlanıyor"
        : "Canlı veri yok";

  return (
    <main className="app-frame">
      <aside className="side-rail">
        <div className="brand-mark"><span>Q</span><b>QuantScope</b></div>
        <nav aria-label="Ana navigasyon">{NAV.map((item) => <button key={item.label} className={activeNav === item.label ? "active" : ""} onClick={() => setActiveNav(item.label)}><span>{item.glyph}</span>{item.label}</button>)}</nav>
        <div className="rail-foot"><div className="status-dot"><i className={liveDataReady ? "" : "demo"} /> {streamLabel}</div><div className="user-badge"><span>HA</span><div><b>Hikmet</b><small>Owner workspace</small></div></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><small>CANLI TEKNİK KARAR TERMİNALİ</small><h1>{activeNav}</h1></div>
          <div className="top-actions"><div className={`freshness ${activeNav === "BIST 80" || activeNav === "BIST Paper" ? "bist-mode" : liveDataReady ? "" : "offline"}`}><i /> {activeNav === "BIST 80" || activeNav === "BIST Paper" ? "BIST GECİKMELİ" : loading ? "YÜKLENİYOR" : liveDataReady ? "WS CANLI" : "AKIŞ BEKLENİYOR"} <span>{activeNav === "BIST 80" || activeNav === "BIST Paper" ? "• ≥15 dk" : `• ${freshness} sn önce`}</span></div><button className="icon-button" aria-label="Bildirimler">◌<em>{alerts.filter((alert) => alert.active).length}</em></button>{activeNav !== "BIST 80" && activeNav !== "BIST Paper" && activeNav !== "Paper Trade" && activeNav !== "Fiyat Verisi" && <button className="primary-button" onClick={() => setActiveNav("Alarmlar")}>＋ Yeni alarm</button>}</div>
        </header>

        {activeNav !== "Paper Trade" && activeNav !== "BIST 80" && activeNav !== "BIST Paper" && activeNav !== "Fiyat Verisi" && <><div className="symbol-row">
          <div className="symbol-picker"><span className="coin-icon">{symbol.startsWith("BTC") ? "₿" : symbol.slice(0, 1)}</span><div><select value={symbol} onChange={(event) => changeSymbol(event.target.value)}>{symbolOptions.map((item) => <option key={item.symbol} value={item.symbol}>{item.baseAsset}/USDT</option>)}</select><small>{symbolsLoading ? "İlk 50 coin yükleniyor…" : "Binance · Hacme göre ilk 50"}</small></div></div>
          <div className="quote"><strong>{formatPrice(market.ticker.lastPrice)}</strong><span className={market.ticker.priceChangePercent >= 0 ? "" : "negative"}>{market.ticker.priceChangePercent >= 0 ? "+" : ""}{priceFormatter.format(market.ticker.priceChange)} · {market.ticker.priceChangePercent >= 0 ? "+" : ""}{priceFormatter.format(market.ticker.priceChangePercent)}%</span></div>
          <div className="quote-stat"><small>24s Hacim</small><b>${compactFormatter.format(market.ticker.quoteVolume)}</b></div>
          <div className="quote-stat"><small>24s Aralık</small><b>{formatPrice(market.ticker.lowPrice)} — {formatPrice(market.ticker.highPrice)}</b></div>
          <button className={`star ${starred ? "on" : ""}`} onClick={() => setStarred(!starred)} aria-label="Favoriye ekle">★</button>
        </div>

        <div className="timeframe-row"><div className="segmented" aria-label="Zaman dilimi">{TIMEFRAMES.map((item) => <button key={item} className={timeframe === item ? "active" : ""} onClick={() => changeTimeframe(item)}>{item}</button>)}</div><div className="candle-state"><span /> Canlı mum · kapanmış swing yapısı <b>{timeframe}</b> · Kalite %{liveDataReady ? analysis.dataQuality : 0}</div></div></>}

        {activeNav === "Analiz" && <AnalysisView market={market} analysis={analysis} multi={multi} llm={displayedLlm} llmLoading={llmLoading} loading={loading} context={marketContext} contextLoading={contextLoading} liveDataReady={liveDataReady} streamStatus={streamStatus} runLlmReview={runLlmReview} />}
        {activeNav === "Tarayıcı" && <ScannerView rows={symbolOptions} loading={symbolsLoading} onSelect={selectScannerSymbol} status={scannerStatus} now={freshnessNow} />}
        {activeNav === "Fiyat Verisi" && <CatalogExportPanel />}
        {activeNav === "Paper Trade" && <PaperTradeView status={scannerStatus} now={freshnessNow} />}
        {activeNav === "BIST 80" && <BistTerminal />}
        {activeNav === "BIST Paper" && <BistPaper now={freshnessNow} />}
        {activeNav === "Alarmlar" && <AlertsView key={`${market.symbol}-${market.interval}`} alerts={alerts} setAlerts={persistAlerts} market={market} gmailConfigured={gmailStatus.configured} />}
        {activeNav === "Geçmiş" && <HistoryView logs={logs} />}
        {activeNav === "Ayarlar" && <SettingsView llmStatus={llmStatus} gmailStatus={gmailStatus} onTestGmail={testGmail} gmailMessage={gmailMessage} />}
      </section>
    </main>
  );
}
