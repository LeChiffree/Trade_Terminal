import { fetchTopBinanceSymbols } from "./binance";

const POSITIVE_NEWS_TERMS = [
  "rally", "surge", "record high", "all-time high", "approval", "approved", "adoption",
  "inflow", "bullish", "recovery", "partnership", "upgrade", "rate cut", "gains",
  "yükseliş", "rekor", "onay", "benimsenme", "toparlanma", "kazanç",
];
const NEGATIVE_NEWS_TERMS = [
  "crash", "hack", "exploit", "ban", "lawsuit", "outflow", "selloff", "war", "tariff",
  "sanction", "liquidation", "fraud", "recession", "attack", "default", "downturn",
  "çöküş", "saldırı", "yasak", "dava", "tasfiye", "dolandırıcılık", "resesyon", "savaş",
];

export type GlobalNewsItem = {
  title: string;
  url: string;
  domain: string;
  publishedAt: string;
  sentiment: number;
};

export type MarketContextPayload = {
  global: {
    available: boolean;
    totalMarketCap: number;
    total24hVolume: number;
    btcDominance: number;
    turnoverRate: number;
    totalCoins: number;
    totalMarkets: number;
  };
  fearGreed: {
    available: boolean;
    value: number;
    label: string;
    previous: number;
    change: number;
    attribution: "Alternative.me";
  };
  breadth: {
    available: boolean;
    advancers: number;
    decliners: number;
    neutral: number;
    advanceRatio: number;
    averageChange: number;
  };
  news: {
    available: boolean;
    items: GlobalNewsItem[];
    provider: "GDELT" | "Google News" | "none";
  };
  scores: {
    fear: number;
    breadth: number;
    news: number;
    overall: number;
    label: string;
  };
  source: "live" | "partial" | "fallback";
  updatedAt: number;
};

type WeightedScore = { score: number; weight: number };

let contextCache: { expiresAt: number; value: MarketContextPayload } | null = null;
let contextInFlight: Promise<MarketContextPayload> | null = null;

function clamp(value: number, minimum = -100, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "QuantScope/0.2" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Context provider ${response.status}`);
  return await response.json() as unknown;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": "QuantScope/0.2" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`News provider ${response.status}`);
  return await response.text();
}

async function fetchGlobalOverview() {
  const raw = await fetchJson("https://api.coinranking.com/v2/stats") as {
    status?: unknown;
    data?: Record<string, unknown>;
  };
  const data = raw.data ?? {};
  const totalMarketCap = finiteOr(data.totalMarketCap);
  const total24hVolume = finiteOr(data.total24hVolume);
  if (raw.status !== "success" || totalMarketCap <= 0 || total24hVolume <= 0) {
    throw new Error("Invalid global market overview");
  }
  return {
    available: true,
    totalMarketCap,
    total24hVolume,
    btcDominance: finiteOr(data.btcDominance),
    turnoverRate: (total24hVolume / totalMarketCap) * 100,
    totalCoins: finiteOr(data.totalCoins),
    totalMarkets: finiteOr(data.totalMarkets),
  };
}

function translateFearLabel(label: string) {
  const translations: Record<string, string> = {
    "Extreme Fear": "Aşırı korku",
    Fear: "Korku",
    Neutral: "Nötr",
    Greed: "Açgözlülük",
    "Extreme Greed": "Aşırı açgözlülük",
  };
  return translations[label] ?? (label || "Nötr");
}

async function fetchFearGreed() {
  const raw = await fetchJson("https://api.alternative.me/fng/?limit=2&format=json") as {
    data?: Array<{ value?: unknown; value_classification?: unknown }>;
  };
  const current = raw.data?.[0];
  const previous = raw.data?.[1];
  const value = finiteOr(current?.value, 50);
  if (!current || value < 0 || value > 100) throw new Error("Invalid fear and greed index");
  const previousValue = clamp(finiteOr(previous?.value, value), 0, 100);
  return {
    available: true,
    value,
    label: translateFearLabel(String(current.value_classification ?? "Neutral")),
    previous: previousValue,
    change: value - previousValue,
    attribution: "Alternative.me" as const,
  };
}

function scoreHeadline(title: string) {
  const normalized = title.toLocaleLowerCase("en-US");
  const positive = POSITIVE_NEWS_TERMS.filter((term) => normalized.includes(term)).length;
  const negative = NEGATIVE_NEWS_TERMS.filter((term) => normalized.includes(term)).length;
  return clamp((positive - negative) * 34);
}

function parseGdeltDate(value: unknown) {
  const raw = String(value ?? "");
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return new Date().toISOString();
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

function safeNewsUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

async function fetchGdeltNews(): Promise<GlobalNewsItem[]> {
  const endpoint = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  endpoint.searchParams.set("query", '("cryptocurrency" OR bitcoin OR ethereum OR "crypto market")');
  endpoint.searchParams.set("mode", "artlist");
  endpoint.searchParams.set("maxrecords", "10");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("sort", "datedesc");
  endpoint.searchParams.set("timespan", "48h");
  const raw = await fetchJson(endpoint.toString()) as {
    articles?: Array<Record<string, unknown>>;
  };
  const seen = new Set<string>();
  const items = (raw.articles ?? []).flatMap((item): GlobalNewsItem[] => {
    const title = String(item.title ?? "").trim().replace(/\s+/g, " ").slice(0, 220);
    const url = safeNewsUrl(item.url);
    if (!title || !url || seen.has(title.toLocaleLowerCase("en-US"))) return [];
    seen.add(title.toLocaleLowerCase("en-US"));
    let domain = String(item.domain ?? "").trim().slice(0, 100);
    if (!domain) domain = new URL(url).hostname.replace(/^www\./, "");
    return [{
      title,
      url,
      domain,
      publishedAt: parseGdeltDate(item.seendate),
      sentiment: scoreHeadline(title),
    }];
  }).slice(0, 6);
  if (!items.length) throw new Error("GDELT returned no current articles");
  return items;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function rssField(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1]?.trim() ?? "");
}

async function fetchGoogleNews(): Promise<GlobalNewsItem[]> {
  const endpoint = new URL("https://news.google.com/rss/search");
  endpoint.searchParams.set("q", "cryptocurrency OR bitcoin OR ethereum OR crypto market");
  endpoint.searchParams.set("hl", "en-US");
  endpoint.searchParams.set("gl", "US");
  endpoint.searchParams.set("ceid", "US:en");
  const xml = await fetchText(endpoint.toString());
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap((match): GlobalNewsItem[] => {
    const block = match[1];
    const title = rssField(block, "title").replace(/\s+/g, " ").slice(0, 220);
    const url = safeNewsUrl(rssField(block, "link"));
    const domain = rssField(block, "source").replace(/\s+/g, " ").slice(0, 100) || "Google News";
    const parsedDate = Date.parse(rssField(block, "pubDate"));
    if (!title || !url) return [];
    return [{
      title,
      url,
      domain,
      publishedAt: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : new Date().toISOString(),
      sentiment: scoreHeadline(title),
    }];
  }).slice(0, 6);
  if (!items.length) throw new Error("Google News returned no current articles");
  return items;
}

async function fetchGlobalNews() {
  return await Promise.any([
    fetchGdeltNews().then((items) => ({ items, provider: "GDELT" as const })),
    fetchGoogleNews().then((items) => ({ items, provider: "Google News" as const })),
  ]);
}

function weightedAverage(parts: WeightedScore[]) {
  const weight = parts.reduce((total, item) => total + item.weight, 0);
  if (!weight) return 0;
  return Math.round(clamp(parts.reduce((total, item) => total + item.score * item.weight, 0) / weight));
}

function contextLabel(score: number) {
  if (score >= 45) return "Güçlü risk iştahı";
  if (score >= 15) return "Ilımlı risk iştahı";
  if (score <= -45) return "Yüksek riskten kaçış";
  if (score <= -15) return "Temkinli piyasa";
  return "Dengeli / kararsız";
}

function fallbackContext(): MarketContextPayload {
  return {
    global: { available: false, totalMarketCap: 0, total24hVolume: 0, btcDominance: 0, turnoverRate: 0, totalCoins: 0, totalMarkets: 0 },
    fearGreed: { available: false, value: 50, label: "Nötr", previous: 50, change: 0, attribution: "Alternative.me" },
    breadth: { available: false, advancers: 0, decliners: 0, neutral: 0, advanceRatio: 50, averageChange: 0 },
    news: { available: false, items: [], provider: "none" },
    scores: { fear: 0, breadth: 0, news: 0, overall: 0, label: "Veri bekleniyor" },
    source: "fallback",
    updatedAt: Date.now(),
  };
}

async function buildMarketContext(): Promise<MarketContextPayload> {
  const [globalResult, fearResult, newsResult, symbolsResult] = await Promise.allSettled([
    fetchGlobalOverview(),
    fetchFearGreed(),
    fetchGlobalNews(),
    fetchTopBinanceSymbols(50),
  ]);
  const fallback = fallbackContext();
  const global = globalResult.status === "fulfilled" ? globalResult.value : fallback.global;
  const fearGreed = fearResult.status === "fulfilled" ? fearResult.value : fallback.fearGreed;
  const newsItems = newsResult.status === "fulfilled" ? newsResult.value.items : [];
  const newsProvider = newsResult.status === "fulfilled" ? newsResult.value.provider : "none";
  const marketSymbols = symbolsResult.status === "fulfilled" && symbolsResult.value.source === "binance"
    ? symbolsResult.value.symbols.filter((item) => item.lastPrice > 0)
    : [];
  const advancers = marketSymbols.filter((item) => item.priceChangePercent > .05).length;
  const decliners = marketSymbols.filter((item) => item.priceChangePercent < -.05).length;
  const neutral = Math.max(0, marketSymbols.length - advancers - decliners);
  const advanceRatio = marketSymbols.length ? (advancers / marketSymbols.length) * 100 : 50;
  const averageChange = marketSymbols.length
    ? marketSymbols.reduce((total, item) => total + item.priceChangePercent, 0) / marketSymbols.length
    : 0;
  const breadth = marketSymbols.length ? {
    available: true,
    advancers,
    decliners,
    neutral,
    advanceRatio,
    averageChange,
  } : fallback.breadth;

  const fearScore = fearGreed.available ? Math.round(clamp((fearGreed.value - 50) * 2)) : 0;
  const breadthScore = breadth.available ? Math.round(clamp((breadth.advanceRatio - 50) * 1.4 + breadth.averageChange * 7)) : 0;
  const newsScore = newsItems.length
    ? Math.round(newsItems.reduce((total, item) => total + item.sentiment, 0) / newsItems.length)
    : 0;
  const parts: WeightedScore[] = [];
  if (fearGreed.available) parts.push({ score: fearScore, weight: .45 });
  if (breadth.available) parts.push({ score: breadthScore, weight: .35 });
  if (newsItems.length) parts.push({ score: newsScore, weight: .20 });
  const overall = weightedAverage(parts);
  const availableSources = [global.available, fearGreed.available, breadth.available, newsItems.length > 0].filter(Boolean).length;

  return {
    global,
    fearGreed,
    breadth,
    news: { available: newsItems.length > 0, items: newsItems, provider: newsProvider },
    scores: { fear: fearScore, breadth: breadthScore, news: newsScore, overall, label: contextLabel(overall) },
    source: availableSources === 4 ? "live" : availableSources ? "partial" : "fallback",
    updatedAt: Date.now(),
  };
}

export async function fetchMarketContext(): Promise<MarketContextPayload> {
  if (contextCache && contextCache.expiresAt > Date.now()) return contextCache.value;
  if (contextInFlight) return contextInFlight;
  contextInFlight = buildMarketContext().then((value) => {
    contextCache = { expiresAt: Date.now() + 5 * 60_000, value };
    return value;
  }).finally(() => {
    contextInFlight = null;
  });
  return contextInFlight;
}
