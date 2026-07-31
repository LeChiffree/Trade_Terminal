"use client";

import { useMemo, useState } from "react";

type NavKey = "Analiz" | "Tarayıcı" | "Alarmlar" | "Geçmiş" | "Ayarlar";

const NAV: { label: NavKey; glyph: string }[] = [
  { label: "Analiz", glyph: "⌁" },
  { label: "Tarayıcı", glyph: "⌕" },
  { label: "Alarmlar", glyph: "◉" },
  { label: "Geçmiş", glyph: "↻" },
  { label: "Ayarlar", glyph: "⚙" },
];

const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d", "1w"];

const bars = [
  [34, 47, 29, 42], [42, 49, 38, 45], [45, 53, 41, 49], [49, 52, 39, 42],
  [42, 46, 31, 35], [35, 43, 28, 39], [39, 48, 36, 46], [46, 57, 43, 53],
  [53, 61, 49, 58], [58, 64, 52, 55], [55, 59, 46, 49], [49, 56, 44, 53],
  [53, 63, 50, 61], [61, 69, 56, 65], [65, 73, 59, 62], [62, 68, 55, 58],
  [58, 65, 52, 63], [63, 72, 60, 69], [69, 78, 66, 75], [75, 82, 70, 78],
  [78, 84, 71, 73], [73, 79, 67, 76], [76, 87, 73, 84], [84, 91, 79, 88],
  [88, 94, 82, 86], [86, 90, 76, 79], [79, 85, 72, 82], [82, 92, 79, 89],
  [89, 98, 84, 94], [94, 101, 87, 90], [90, 96, 82, 85], [85, 93, 80, 91],
  [91, 104, 88, 99], [99, 109, 95, 105], [105, 112, 99, 102], [102, 108, 94, 97],
  [97, 106, 93, 104], [104, 115, 100, 112], [112, 120, 105, 109], [109, 116, 101, 114],
];

function CandleChart() {
  const max = 124;
  const min = 24;
  const h = 250;
  const y = (value: number) => h - ((value - min) / (max - min)) * h;

  return (
    <div className="chart-shell" aria-label="BTCUSDT 15 dakika mum grafiği">
      <div className="chart-watermark">BTC / USDT</div>
      <svg viewBox="0 0 800 250" role="img" aria-label="Canlı mum grafiği önizlemesi">
        <defs>
          <linearGradient id="scoreArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#62f6bd" stopOpacity=".18" />
            <stop offset="100%" stopColor="#62f6bd" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1="0" x2="800" y1={i * 62.5} y2={i * 62.5} className="grid-line" />
        ))}
        <path d="M0 212 C90 201 112 184 176 190 S290 136 350 151 S463 112 522 119 S625 78 800 42 L800 250 L0 250 Z" fill="url(#scoreArea)" />
        <path d="M0 212 C90 201 112 184 176 190 S290 136 350 151 S463 112 522 119 S625 78 800 42" className="ema-line" />
        {bars.map(([o, high, low, close], index) => {
          const up = close >= o;
          const x = index * 20 + 6;
          const bodyY = y(Math.max(o, close));
          const bodyH = Math.max(2, Math.abs(y(o) - y(close)));
          return (
            <g key={index}>
              <line x1={x + 5} x2={x + 5} y1={y(high)} y2={y(low)} className={up ? "wick up" : "wick down"} />
              <rect x={x} y={bodyY} width="10" height={bodyH} rx="1.5" className={up ? "candle up" : "candle down"} />
            </g>
          );
        })}
        <line x1="0" x2="800" y1="34" y2="34" className="price-line" />
      </svg>
      <div className="price-tag">65.842,40</div>
      <div className="chart-axis"><span>12:00</span><span>16:00</span><span>20:00</span><span>00:00</span><span>04:00</span></div>
    </div>
  );
}

function ScoreRing({ score, label, tone }: { score: number; label: string; tone: "mint" | "violet" }) {
  const angle = Math.round(((score + 100) / 200) * 270);
  return (
    <div className="score-unit">
      <div className={`score-ring ${tone}`} style={{ "--angle": `${angle}deg` } as React.CSSProperties}>
        <div><strong>+{score}</strong><span>/100</span></div>
      </div>
      <p>{label}</p>
    </div>
  );
}

const indicatorRows = [
  ["RSI (14)", "63,4", "Pozitif", "+42", "Momentum güçleniyor; aşırı alımda değil."],
  ["MACD", "+124,8", "Pozitif", "+51", "MACD sinyal üstünde, histogram genişliyor."],
  ["ADX / DMI", "28,6", "Trend", "+36", "+DI üstün; trend gücü kabul edilebilir."],
  ["Relative Volume", "1,84×", "Güçlü", "+61", "Hareket son 20 mum hacmiyle teyit ediliyor."],
  ["Bollinger %B", "0,78", "Dikkat", "+18", "Üst banda yakın; kırılım teyidi beklenmeli."],
];

export default function Home() {
  const [activeNav, setActiveNav] = useState<NavKey>("Analiz");
  const [timeframe, setTimeframe] = useState("15m");
  const [starred, setStarred] = useState(true);
  const summary = useMemo(() => activeNav === "Analiz" ? "Canlı teknik karar terminali" : `${activeNav} modülü`, [activeNav]);

  return (
    <main className="app-frame">
      <aside className="side-rail">
        <div className="brand-mark"><span>Q</span><b>QuantScope</b></div>
        <nav aria-label="Ana navigasyon">
          {NAV.map((item) => (
            <button key={item.label} className={activeNav === item.label ? "active" : ""} onClick={() => setActiveNav(item.label)}>
              <span>{item.glyph}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="status-dot"><i /> Binance bağlı</div>
          <div className="user-badge"><span>HA</span><div><b>Hikmet</b><small>Owner workspace</small></div></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><small>{summary}</small><h1>{activeNav}</h1></div>
          <div className="top-actions">
            <div className="freshness"><i /> CANLI <span>• 2 sn önce</span></div>
            <button className="icon-button" aria-label="Bildirimler">◌<em>3</em></button>
            <button className="primary-button">＋ Yeni alarm</button>
          </div>
        </header>

        <div className="symbol-row">
          <button className="symbol-picker"><span className="coin-icon">₿</span><div><strong>BTCUSDT</strong><small>Bitcoin / Tether · Spot</small></div><b>⌄</b></button>
          <div className="quote"><strong>$65.842,40</strong><span>+$742,18 · +1,14%</span></div>
          <div className="quote-stat"><small>24s Hacim</small><b>$28,4B</b></div>
          <div className="quote-stat"><small>24s Aralık</small><b>$64.720 — $66.104</b></div>
          <button className={`star ${starred ? "on" : ""}`} onClick={() => setStarred(!starred)} aria-label="Favoriye ekle">★</button>
        </div>

        <div className="timeframe-row">
          <div className="segmented" aria-label="Zaman dilimi">
            {TIMEFRAMES.map((item) => <button key={item} className={timeframe === item ? "active" : ""} onClick={() => setTimeframe(item)}>{item}</button>)}
          </div>
          <div className="candle-state"><span /> Kapanmış mum analizi <b>{timeframe}</b></div>
        </div>

        <div className="analysis-grid">
          <section className="panel chart-panel">
            <div className="panel-head"><div><span className="eyebrow">FİYAT AKIŞI</span><h2>Canlı piyasa yapısı</h2></div><div className="legend"><span className="mint-dot" /> EMA20 <span className="amber-dot" /> Direnç</div></div>
            <CandleChart />
            <div className="level-strip">
              <div><small>Destek 1</small><b>$65.620</b></div><div><small>Destek 2</small><b>$65.180</b></div><div><small>Direnç 1</small><b>$66.250</b></div><div><small>ATR (14)</small><b>$384,2</b></div>
            </div>
          </section>

          <aside className="panel decision-panel">
            <div className="panel-head"><div><span className="eyebrow">KARAR MOTORU</span><h2>Long eğilim</h2></div><span className="approved">● ONAYLI</span></div>
            <div className="score-pair"><ScoreRing score={45} label="Quant engine" tone="mint" /><ScoreRing score={36} label="LLM approver" tone="violet" /></div>
            <div className="consensus"><div><small>FINAL CONSENSUS</small><strong>+43</strong></div><span>LONG WATCH</span></div>
            <div className="confidence"><div><span>Güven</span><b>%73</b></div><div className="meter"><i style={{ width: "73%" }} /></div></div>
            <div className="reason-list"><p><span>↑</span><b>Trend uyumu</b><small>15m ve 1h yukarı</small></p><p><span>◫</span><b>Hacim teyidi</b><small>Ortalamaya göre 1,84×</small></p><p className="warn"><span>!</span><b>Risk bayrağı</b><small>4h dirence yakın</small></p></div>
          </aside>
        </div>

        <section className="panel indicator-panel">
          <div className="panel-head"><div><span className="eyebrow">FEATURE REGISTRY</span><h2>Tek tek indikatör yorumları</h2></div><button className="ghost-button">Tüm 36 hesabı göster →</button></div>
          <div className="indicator-table" role="table" aria-label="İndikatör sonuçları">
            <div className="table-row table-head" role="row"><span>İndikatör</span><span>Değer</span><span>Durum</span><span>Puan</span><span>Deterministik yorum</span></div>
            {indicatorRows.map((row) => <div className="table-row" role="row" key={row[0]}>{row.map((cell, i) => <span key={i} className={i === 2 ? "pill-cell" : ""}>{cell}</span>)}</div>)}
          </div>
        </section>
      </section>
    </main>
  );
}
