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

type NavKey = "Analiz" | "Tarayıcı" | "Alarmlar" | "Geçmiş" | "Ayarlar";

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

const NAV: { label: NavKey; glyph: string }[] = [
  { label: "Analiz", glyph: "⌁" },
  { label: "Tarayıcı", glyph: "⌕" },
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

function AnalysisView({
  market,
  analysis,
  multi,
  llm,
  llmLoading,
  loading,
  runLlmReview,
}: {
  market: MarketPayload;
  analysis: AnalysisResult;
  multi: Record<string, AnalysisResult>;
  llm: LlmReview | null;
  llmLoading: boolean;
  loading: boolean;
  runLlmReview: () => void;
}) {
  const llmScore = llm?.direction_score ?? 0;
  const conflict = llm?.configured && Math.sign(llmScore) !== Math.sign(analysis.quantScore) && Math.abs(llmScore) >= 20 && Math.abs(analysis.quantScore) >= 20;
  const finalScore = llm?.configured ? Math.round(analysis.quantScore * .8 + llmScore * .2) : analysis.quantScore;
  const finalLabel = conflict ? "CONFLICT / WAIT" : scoreLabel(finalScore);
  const reasons = llm?.configured ? llm.top_reasons : analysis.reasons;
  const risks = llm?.configured ? [...llm.contradictions, ...llm.risk_flags] : analysis.contradictions;

  return (
    <>
      {market.source === "demo" && <div className="source-banner"><span>DEMO VERİ</span> Binance erişimi bu istekte alınamadı; arayüz kesintisiz test edilebilsin diye sentetik seri gösteriliyor.</div>}
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
          <div className="panel-head"><div><span className="eyebrow">KARAR MOTORU</span><h2>{finalLabel.replace("STRONG ", "Güçlü ")}</h2></div><span className={`approved ${conflict ? "rejected" : ""}`}>{conflict ? "● ÇELİŞKİ" : llm?.configured ? "● LLM ONAYI" : "● QUANT"}</span></div>
          <div className="score-pair">
            <ScoreRing score={analysis.quantScore} label="Quant engine" tone="mint" />
            <ScoreRing score={llmScore} label={llm?.configured ? `LLM · ${llm.provider}` : "Demo approver"} tone="violet" muted={!llm} />
          </div>
          <button className="llm-run" disabled={llmLoading || loading} onClick={runLlmReview}>{loading ? "Piyasa verisi bekleniyor…" : llmLoading ? "Gemini değerlendiriyor…" : llm?.configured ? "Gemini yorumunu yenile" : "Gemini değerlendirmesi iste"}</button>
          <div className={`consensus ${conflict ? "conflict" : ""}`}><div><small>FINAL CONSENSUS</small><strong>{finalScore > 0 ? "+" : ""}{finalScore}</strong></div><span>{finalLabel}</span></div>
          <div className="confidence"><div><span>Güven</span><b>%{llm?.configured ? Math.round(analysis.confidence * .75 + llm.confidence * .25) : analysis.confidence}</b></div><div className="meter"><i style={{ width: `${analysis.confidence}%` }} /></div></div>
          <div className="reason-list">
            {reasons.slice(0, 2).map((reason, index) => <p key={reason}><span>{index ? "◫" : "↑"}</span><b>{index ? "İkinci teyit" : "Ana gerekçe"}</b><small>{reason}</small></p>)}
            {risks.slice(0, 1).map((risk) => <p className="warn" key={risk}><span>!</span><b>Risk bayrağı</b><small>{risk}</small></p>)}
          </div>
          {llm && <div className={`llm-note ${llm.configured ? "" : "demo"}`}><b>{llm.configured ? "LLM yorumu" : "Demo modu"}</b><p>{llm.summary_tr}</p></div>}
        </aside>
      </div>
      <MultiTimeframe analyses={multi} current={analysis.interval} />
      <IndicatorTable indicators={analysis.indicators} />
    </>
  );
}

function ScannerView({ rows, onSelect, loading }: { rows: SymbolOption[]; onSelect: (symbol: string) => void; loading: boolean }) {
  return (
    <section className="panel module-panel">
      <div className="panel-head"><div><span className="eyebrow">PİYASA TARAYICI · STABLECOIN HARİÇ</span><h2>USDT hacmine göre ilk 50 coin</h2></div><span className="data-note">{loading ? "Binance listesi güncelleniyor…" : "24 saatlik hacim sırası"}</span></div>
      <div className="scanner-table">
        <div className="scanner-row scanner-head"><span>#</span><span>Parite</span><span>Son fiyat</span><span>24s değişim</span><span>24s hacim</span><span /></div>
        {rows.slice(0, 50).map((row, index) => <div className="scanner-row" key={row.symbol}><span>{index + 1}</span><span><b>{row.baseAsset}/USDT</b><small>Binance Spot</small></span><span>{formatPrice(row.lastPrice)}</span><span className={row.priceChangePercent > 0 ? "positive" : row.priceChangePercent < 0 ? "negative" : "neutral"}>{row.lastPrice ? `${row.priceChangePercent > 0 ? "+" : ""}${priceFormatter.format(row.priceChangePercent)}%` : "—"}</span><span>{row.quoteVolume ? `$${compactFormatter.format(row.quoteVolume)}` : "—"}</span><span><button onClick={() => onSelect(row.symbol)}>Analiz et →</button></span></div>)}
      </div>
    </section>
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
        <p className="helper">Bu deneme sürümünde kurallar tarayıcıda saklanır ve uygulama açıkken değerlendirilir. 24/7 sunucu taraması sonraki collector sürümünde etkinleşecek.</p>
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
  const [freshnessNow, setFreshnessNow] = useState(0);
  const latestMarketRef = useRef(market);
  const analysis = useMemo(() => analyzeMarket(market), [market]);
  const lastCandleOpenTime = market.candles.at(-1)?.openTime;
  const currentContextKey = `${market.symbol}-${market.interval}-${lastCandleOpenTime ?? 0}`;
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
    fetch("/api/symbols").then(async (response) => {
      if (!response.ok) throw new Error("Symbol directory failed");
      return await response.json() as { symbols?: SymbolOption[] };
    }).then((directory) => {
      if (!disposed && Array.isArray(directory.symbols) && directory.symbols.length === 50) {
        setSymbolOptions(directory.symbols);
      }
    }).catch(() => undefined).finally(() => {
      if (!disposed) setSymbolsLoading(false);
    });
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
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Market data failed");
        const data = await response.json() as MarketPayload;
        if (!cancelled) setMarket(data);
      } catch {
        if (!cancelled) setMarket(makeDemoMarket(symbol, timeframe));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [symbol, timeframe]);

  useEffect(() => {
    const baseMarket = latestMarketRef.current;
    if (baseMarket.symbol !== symbol) return;
    let cancelled = false;
    fetch(`/api/multi?symbol=${symbol}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Multi-timeframe data failed");
      return await response.json() as { intervals: Record<string, { candles: Candle[]; source: "binance" | "demo" }> };
    }).then((data: { intervals: Record<string, { candles: Candle[]; source: "binance" | "demo" }> }) => {
      if (cancelled) return;
      const results: Record<string, AnalysisResult> = {};
      for (const interval of TIMEFRAMES) {
        const result = data.intervals[interval];
        if (result?.candles) results[interval] = analyzeMarket({ ...baseMarket, symbol, interval, candles: result.candles, source: result.source });
      }
      setMulti(results);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [symbol, market.symbol]);

  const runLlmReview = useCallback(async () => {
    setLlmLoading(true);
    try {
      const response = await fetch("/api/llm-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: analysis.symbol,
          interval: analysis.interval,
          regime: analysis.regime,
          levels: { supports: analysis.supports, resistances: analysis.resistances, atr: analysis.atr },
          facts: analysis.indicators.map((item) => ({ name: item.name, family: item.family, correlationGroup: item.correlationGroup, value: item.value, state: item.state, interpretation: item.interpretation, score: item.score })),
        }),
      });
      if (!response.ok) throw new Error("LLM review failed");
      const review = await response.json() as LlmReview;
      setLlm(review);
      setLlmContextKey(currentContextKey);
      const finalScore = review.configured ? Math.round(analysis.quantScore * .8 + review.direction_score * .2) : analysis.quantScore;
      const entry: SignalLog = { id: makeId(), timestamp: Date.now(), symbol: analysis.symbol, interval: analysis.interval, quantScore: analysis.quantScore, llmScore: review.configured ? review.direction_score : null, finalScore, direction: scoreLabel(finalScore), approval: review.approval };
      persistLog(entry);
    } catch {
      setLlm(null);
      setLlmContextKey("");
    } finally {
      setLlmLoading(false);
    }
  }, [analysis, currentContextKey, persistLog]);

  useEffect(() => {
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
  }, [market.ticker.lastPrice, market.symbol, alerts, analysis, gmailStatus.configured, persistAlerts]);

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
    setLlm(null);
    setLlmContextKey("");
  };
  const changeTimeframe = (nextTimeframe: string) => {
    if (nextTimeframe === timeframe) return;
    setLoading(true);
    setTimeframe(nextTimeframe);
    setMarket(makeDemoMarket(symbol, nextTimeframe));
    setLlm(null);
    setLlmContextKey("");
  };
  const selectScannerSymbol = (nextSymbol: string) => {
    changeSymbol(nextSymbol);
    setActiveNav("Analiz");
  };
  const freshness = Math.max(0, Math.round((freshnessNow - market.fetchedAt) / 1000));

  return (
    <main className="app-frame">
      <aside className="side-rail">
        <div className="brand-mark"><span>Q</span><b>QuantScope</b></div>
        <nav aria-label="Ana navigasyon">{NAV.map((item) => <button key={item.label} className={activeNav === item.label ? "active" : ""} onClick={() => setActiveNav(item.label)}><span>{item.glyph}</span>{item.label}</button>)}</nav>
        <div className="rail-foot"><div className="status-dot"><i className={market.source === "binance" ? "" : "demo"} /> {market.source === "binance" ? "Binance bağlı" : "Demo akışı"}</div><div className="user-badge"><span>HA</span><div><b>Hikmet</b><small>Owner workspace</small></div></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><small>CANLI TEKNİK KARAR TERMİNALİ</small><h1>{activeNav}</h1></div>
          <div className="top-actions"><div className="freshness"><i /> {loading ? "YÜKLENİYOR" : "CANLI"} <span>• {freshness} sn önce</span></div><button className="icon-button" aria-label="Bildirimler">◌<em>{alerts.filter((alert) => alert.active).length}</em></button><button className="primary-button" onClick={() => setActiveNav("Alarmlar")}>＋ Yeni alarm</button></div>
        </header>

        <div className="symbol-row">
          <div className="symbol-picker"><span className="coin-icon">{symbol.startsWith("BTC") ? "₿" : symbol.slice(0, 1)}</span><div><select value={symbol} onChange={(event) => changeSymbol(event.target.value)}>{symbolOptions.map((item) => <option key={item.symbol} value={item.symbol}>{item.baseAsset}/USDT</option>)}</select><small>{symbolsLoading ? "İlk 50 coin yükleniyor…" : "Binance · Hacme göre ilk 50"}</small></div></div>
          <div className="quote"><strong>{formatPrice(market.ticker.lastPrice)}</strong><span className={market.ticker.priceChangePercent >= 0 ? "" : "negative"}>{market.ticker.priceChangePercent >= 0 ? "+" : ""}{priceFormatter.format(market.ticker.priceChange)} · {market.ticker.priceChangePercent >= 0 ? "+" : ""}{priceFormatter.format(market.ticker.priceChangePercent)}%</span></div>
          <div className="quote-stat"><small>24s Hacim</small><b>${compactFormatter.format(market.ticker.quoteVolume)}</b></div>
          <div className="quote-stat"><small>24s Aralık</small><b>{formatPrice(market.ticker.lowPrice)} — {formatPrice(market.ticker.highPrice)}</b></div>
          <button className={`star ${starred ? "on" : ""}`} onClick={() => setStarred(!starred)} aria-label="Favoriye ekle">★</button>
        </div>

        <div className="timeframe-row"><div className="segmented" aria-label="Zaman dilimi">{TIMEFRAMES.map((item) => <button key={item} className={timeframe === item ? "active" : ""} onClick={() => changeTimeframe(item)}>{item}</button>)}</div><div className="candle-state"><span /> Kapanmış mum analizi <b>{timeframe}</b> · Kalite %{analysis.dataQuality}</div></div>

        {activeNav === "Analiz" && <AnalysisView market={market} analysis={analysis} multi={multi} llm={displayedLlm} llmLoading={llmLoading} loading={loading} runLlmReview={runLlmReview} />}
        {activeNav === "Tarayıcı" && <ScannerView rows={symbolOptions} loading={symbolsLoading} onSelect={selectScannerSymbol} />}
        {activeNav === "Alarmlar" && <AlertsView key={`${market.symbol}-${market.interval}`} alerts={alerts} setAlerts={persistAlerts} market={market} gmailConfigured={gmailStatus.configured} />}
        {activeNav === "Geçmiş" && <HistoryView logs={logs} />}
        {activeNav === "Ayarlar" && <SettingsView llmStatus={llmStatus} gmailStatus={gmailStatus} onTestGmail={testGmail} gmailMessage={gmailMessage} />}
      </section>
    </main>
  );
}
