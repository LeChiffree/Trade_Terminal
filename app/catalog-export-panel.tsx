"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SiteKey = "gratis" | "watsons" | "eveshop" | "rossmann";
type JobStatus = "queued" | "running" | "completed" | "failed";
type CatalogJob = {
  id: string;
  site: SiteKey;
  status: JobStatus;
  progress: number;
  message: string;
  error: string | null;
  filename: string | null;
  createdAt: number;
  finishedAt: number | null;
  downloadUrl: string | null;
};

const STORES: Array<{
  key: SiteKey;
  label: string;
  glyph: string;
  detail: string;
  price: string;
}> = [
  { key: "gratis", label: "Gratis", glyph: "G", detail: "Ürün, stok, liste ve satış fiyatları", price: "Normal + kampanya" },
  { key: "watsons", label: "Watsons", glyph: "W", detail: "Barkod, marka, stok ve kampanyalar", price: "Normal + Club" },
  { key: "eveshop", label: "EveShop", glyph: "E", detail: "Shopify kataloğu ve ürün kartları", price: "Normal + Eve Kart" },
  { key: "rossmann", label: "Rossmann", glyph: "R", detail: "Kategori, özellik ve eşikli kampanyalar", price: "Normal + Rossmann Card" },
];

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Sırada",
  running: "Çekiliyor",
  completed: "Hazır",
  failed: "Hata",
};

export default function CatalogExportPanel() {
  const [jobs, setJobs] = useState<Record<string, CatalogJob>>({});
  const [loadingSite, setLoadingSite] = useState<SiteKey | null>(null);
  const [connectionError, setConnectionError] = useState("");

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/catalog-jobs", { cache: "no-store" });
      if (!response.ok) throw new Error("Katalog işleri alınamadı.");
      const payload = await response.json() as { jobs?: CatalogJob[] };
      const latest: Record<string, CatalogJob> = {};
      for (const job of payload.jobs ?? []) {
        if (!latest[job.site]) latest[job.site] = job;
      }
      setJobs(latest);
      setConnectionError("");
    } catch {
      setConnectionError("Katalog servisine şu anda ulaşılamıyor.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs]);

  const hasActiveJob = useMemo(
    () => Object.values(jobs).some((job) => job.status === "queued" || job.status === "running"),
    [jobs],
  );

  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => void loadJobs(), 1500);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, loadJobs]);

  async function startJob(site: SiteKey) {
    setLoadingSite(site);
    setConnectionError("");
    try {
      const response = await fetch("/api/catalog-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site }),
      });
      const payload = await response.json() as { job?: CatalogJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error || "Tarama başlatılamadı.");
      setJobs((current) => ({ ...current, [site]: payload.job! }));
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Tarama başlatılamadı.");
    } finally {
      setLoadingSite(null);
    }
  }

  return (
    <section className="catalog-export-view">
      <div className="catalog-hero panel">
        <div>
          <span className="eyebrow">RETAIL DATA PIPELINE · 4 CANLI KAYNAK</span>
          <h2>Mağaza kataloglarını Excel’e aktar</h2>
          <p>Tarama bu bilgisayarda değil, QuantScope veri ajanında çalışır. Sayfayı kapatsanız bile iş devam eder; tamamlanan dosya burada kalır.</p>
        </div>
        <div className="catalog-hero-stat"><strong>4</strong><span>bağlı mağaza</span><small>D1 kuyruk · R2 dosya deposu</small></div>
      </div>

      {connectionError && <div className="catalog-global-error">{connectionError}</div>}

      <div className="catalog-store-grid">
        {STORES.map((store) => {
          const job = jobs[store.key];
          const status = job?.status;
          const active = status === "queued" || status === "running";
          const progress = Math.max(0, Math.min(100, Number(job?.progress ?? 0)));
          return (
            <article className={`catalog-store-card panel ${status ?? "idle"}`} key={store.key}>
              <div className="catalog-card-head">
                <span className={`catalog-store-glyph ${store.key}`}>{store.glyph}</span>
                <span className={`catalog-job-state ${status ?? "idle"}`}>{status ? STATUS_LABELS[status] : "Hazır"}</span>
              </div>
              <div className="catalog-card-copy">
                <h3>{store.label}</h3>
                <p>{store.detail}</p>
                <small>{store.price}</small>
              </div>

              {(active || status === "completed") && (
                <div className="catalog-progress">
                  <div><span>{job?.message}</span><b>%{Math.round(progress)}</b></div>
                  <i><b style={{ width: `${progress}%` }} /></i>
                </div>
              )}
              {status === "failed" && <p className="catalog-job-error">{job.error || "Tarama tamamlanamadı."}</p>}

              {status === "completed" && job.downloadUrl ? (
                <a className="catalog-download" href={job.downloadUrl}>Excel’i indir ↓</a>
              ) : (
                <button
                  className="catalog-start"
                  disabled={active || loadingSite === store.key}
                  onClick={() => void startJob(store.key)}
                >
                  {active ? "Tarama devam ediyor…" : loadingSite === store.key ? "Başlatılıyor…" : status === "failed" ? "Yeniden dene" : "Verileri çek"}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <div className="catalog-footnote panel">
        <span>İŞ AKIŞI</span>
        <p>İşler kaynak sitelere yük bindirmemek için sırayla çalışır. Excel dosyaları normal fiyat ile üyelik/kampanya fiyatlarını ayrı sütunlarda tutar.</p>
      </div>
    </section>
  );
}
