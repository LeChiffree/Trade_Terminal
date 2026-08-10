"use client";

import { useEffect, useState } from "react";
import type {
  BistPaperPositionRow,
  BistPaperTradeStatus,
} from "@/lib/bist-paper-trading";

const moneyFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number) {
  return moneyFormatter.format(Number.isFinite(value) ? value : 0);
}

function price(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: value < 10 ? 3 : 2,
    maximumFractionDigits: value < 10 ? 3 : 2,
  }).format(value);
}

function score(value: number) {
  return `${value > 0 ? "+" : ""}${Math.round(value)}`;
}

function duration(openedAt: number, closedAt: number | null, now: number) {
  const seconds = Math.max(
    0,
    Math.round(((closedAt ?? now) - openedAt) / 1_000),
  );
  if (seconds < 60) return `${seconds} sn`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} dk`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} sa`;
  return `${Math.floor(seconds / 86_400)} gün`;
}

function closeLabel(reason: string | null) {
  if (reason === "score-normalized") return "Puan eşiğin altına indi";
  return reason || "Açık";
}

function PositionTable({
  positions,
  now,
  history = false,
}: {
  positions: BistPaperPositionRow[];
  now: number;
  history?: boolean;
}) {
  return (
    <div className="paper-table bist-paper-table">
      <div className="paper-row paper-head">
        <span>Hisse / Frame</span>
        <span>Yön</span>
        <span>Giriş / Son</span>
        <span>Puan</span>
        <span>Sermaye / Adet</span>
        <span>Net P/L</span>
        <span>{history ? "Kapanış" : "Süre / Güven"}</span>
      </div>
      {!positions.length && (
        <div className="empty-inline">
          {history
            ? "Henüz kapanmış BIST paper işlemi yok."
            : "Eşik ve güven koşullarını sağlayan yüksek puanlı hisseler bekleniyor."}
        </div>
      )}
      {positions.map((position) => {
        const returnPercent = position.capital
          ? (position.net_pnl / position.capital) * 100
          : 0;
        return (
          <div className="paper-row trade-row long" key={position.id}>
            <span>
              <b>{position.symbol}</b>
              <small>{position.name} · {position.interval}</small>
            </span>
            <span>
              <i className="paper-side long">LONG</i>
            </span>
            <span>
              <b>₺{price(position.entry_price)}</b>
              <small>→ ₺{price(position.mark_price)}</small>
            </span>
            <span>
              <b className={position.current_score >= 30 ? "positive" : ""}>
                {score(position.current_score)}
              </b>
              <small>Giriş {score(position.entry_score)}</small>
            </span>
            <span>
              <b>{money(position.capital)}</b>
              <small>{numberFormatter.format(position.quantity)} adet · 1x</small>
            </span>
            <span>
              <b className={position.net_pnl >= 0 ? "positive" : "negative"}>
                {money(position.net_pnl)}
              </b>
              <small className={returnPercent >= 0 ? "positive" : "negative"}>
                {returnPercent >= 0 ? "+" : ""}{numberFormatter.format(returnPercent)}%
              </small>
            </span>
            <span>
              <b>
                {history
                  ? closeLabel(position.close_reason)
                  : duration(position.opened_at, null, now)}
              </b>
              <small>
                {history
                  ? duration(position.opened_at, position.closed_at, now)
                  : `Güven %${Math.round(position.confidence)}`}
              </small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function BistPaper({ now }: { now: number }) {
  const [status, setStatus] = useState<BistPaperTradeStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch("/api/bist/paper", {
          cache: "no-store",
        });
        const body = await response.json() as BistPaperTradeStatus & {
          error?: string;
        };
        if (!response.ok || !body.configured) {
          throw new Error(body.error || "BIST paper motoru okunamadı.");
        }
        if (!disposed) {
          setStatus(body);
          setError("");
        }
      } catch (loadError) {
        if (!disposed) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "BIST paper motoru okunamadı.",
          );
        }
      }
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const account = status?.account;
  const metrics = status?.metrics;
  const cycleAge = account?.last_cycle_at
    ? Math.max(0, Math.round((now - account.last_cycle_at) / 1_000))
    : null;
  const healthy = Boolean(
    status?.configured &&
      account?.enabled &&
      cycleAge !== null &&
      cycleAge < 180 &&
      !account.last_error,
  );

  return (
    <>
      <section className="panel module-panel paper-hero bist-paper-hero">
        <div>
          <span className="eyebrow">BIST TOP 15 LONG PAPER PORTFÖY</span>
          <h2>80 yüksek hacimli hissede, altı zaman diliminin en güçlü puanları</h2>
          <p>
            Her hissede 5m, 15m, 1h, 4h, 1g ve 1hft puanları karşılaştırılır.
            En güçlü 15 uygun hisseye 1.000 TL ile long açılır; seçilen frame
            puanı çıkış eşiğinin altına indiğinde işlem kapanır.
          </p>
        </div>
        <div className="paper-equity">
          <small>ANLIK PORTFÖY DEĞERİ</small>
          <strong className={(metrics?.totalNetPnl ?? 0) >= 0 ? "positive" : "negative"}>
            {money(metrics?.equity ?? 100_000)}
          </strong>
          <span className={healthy ? "integration-ok" : "integration-warn"}>
            {healthy
              ? `Çalışıyor · son döngü ${cycleAge} sn`
              : account?.last_error
                ? "Veri kaynağı yeniden denenecek"
                : error || "İlk tarama bekleniyor"}
          </span>
        </div>
      </section>

      <section className="paper-kpi-grid">
        <article className="panel">
          <small>Ana para</small>
          <strong>{money(account?.initial_balance ?? 100_000)}</strong>
          <span>Kripto kasasından bağımsız BIST kasası</span>
        </article>
        <article className="panel">
          <small>Kullanılabilir nakit</small>
          <strong>{money(metrics?.availableCash ?? 100_000)}</strong>
          <span>Bağlı sermaye ve giriş maliyeti sonrası</span>
        </article>
        <article className="panel">
          <small>Açık işlem</small>
          <strong>{metrics?.openPositions ?? 0} / {account?.max_positions ?? 15}</strong>
          <span>{money(metrics?.reservedCapital ?? 0)} bağlı sermaye</span>
        </article>
        <article className="panel">
          <small>Total net P/L</small>
          <strong className={(metrics?.totalNetPnl ?? 0) >= 0 ? "positive" : "negative"}>
            {money(metrics?.totalNetPnl ?? 0)}
          </strong>
          <span>Realized + unrealized, maliyetler dahil</span>
        </article>
        <article className="panel">
          <small>Realized P/L</small>
          <strong className={(metrics?.realizedNetPnl ?? 0) >= 0 ? "positive" : "negative"}>
            {money(metrics?.realizedNetPnl ?? 0)}
          </strong>
          <span>{metrics?.closedTrades ?? 0} kapanmış işlem</span>
        </article>
        <article className="panel">
          <small>Unrealized P/L</small>
          <strong className={(metrics?.unrealizedNetPnl ?? 0) >= 0 ? "positive" : "negative"}>
            {money(metrics?.unrealizedNetPnl ?? 0)}
          </strong>
          <span>Açık hisselerin net mark-to-market değeri</span>
        </article>
        <article className="panel">
          <small>Komisyon + kayma</small>
          <strong>{money((metrics?.totalFees ?? 0) + (metrics?.totalSlippage ?? 0))}</strong>
          <span>{money(metrics?.totalFees ?? 0)} fee · {money(metrics?.totalSlippage ?? 0)} slip</span>
        </article>
        <article className="panel">
          <small>Başarı oranı</small>
          <strong>%{numberFormatter.format(metrics?.winRate ?? 0)}</strong>
          <span>Yalnızca kapanmış işlemler</span>
        </article>
      </section>

      <section className="panel module-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">AÇIK BIST POZİSYONLARI</span>
            <h2>Gecikmeli BIST fiyatıyla maliyet sonrası net P/L</h2>
          </div>
          <span className="data-note">
            İşlem başı {money(account?.capital_per_trade ?? 1_000)} · long-only · 1x
          </span>
        </div>
        <PositionTable
          positions={status?.openPositions ?? []}
          now={now}
        />
      </section>

      <section className="panel module-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">BIST PAPER TRADE JOURNAL</span>
            <h2>Son kapanan işlemler</h2>
          </div>
          <span className="data-note">Net sonuç · tüm maliyetler dahil</span>
        </div>
        <PositionTable
          positions={status?.history ?? []}
          now={now}
          history
        />
      </section>

      <section className="paper-method bist-paper-method">
        <span>MODEL</span>
        <p>
          Giriş: her hissedeki en yüksek frame puanı seçilir; minimum +
          {account?.entry_score ?? 30} puan ve %{account?.minimum_confidence ?? 70}
          {" "}güven aranır, en fazla {account?.max_positions ?? 15} benzersiz
          hisse açılır. Çıkış: pozisyonun seçildiği frame puanı +
          {account?.exit_score ?? 15} altına indiğinde kapanır. İşlem başına
          {" "}{money(account?.capital_per_trade ?? 1_000)} ayrılır; giriş ve
          çıkışın her birinde %{((account?.commission_rate ?? 0.0005) * 100).toFixed(2)}
          {" "}komisyon ile %{((account?.slippage_rate ?? 0.0002) * 100).toFixed(2)}
          {" "}fiyat kayması net P/L’den düşülür. BIST verisi en az 15 dakika
          gecikmelidir; bu bir simülasyondur, gerçek emir göndermez.
        </p>
      </section>
    </>
  );
}
