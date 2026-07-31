import { sendGmailMessage } from "@/lib/smtp";

export const dynamic = "force-dynamic";

type EmailRequest = {
  action?: "test" | "alert";
  symbol?: string;
  interval?: string;
  direction?: string;
  lastPrice?: number;
  threshold?: number;
  quantScore?: number;
  confidence?: number;
};

const attempts = new Map<string, { count: number; resetAt: number }>();

const configured = () => Boolean(
  process.env.FASTACT_EMAIL_SENDER &&
  process.env.FASTACT_EMAIL_APP_PASSWORD &&
  process.env.FASTACT_EMAIL_RECIPIENT,
);

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );
}

function formatNumber(value: unknown, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(number)
    : "—";
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function isRateLimited(request: Request) {
  const key =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local";
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 5;
}

function createContent(body: EmailRequest) {
  if (body.action === "test") {
    return {
      subject: "QuantScope e-posta bağlantı testi",
      text: "Bağlantı başarılı. QuantScope alarm motoru e-posta göndermeye hazır.",
      html:
        "<h2 style=\"margin:0 0 12px\">Bağlantı başarılı</h2>" +
        "<p>QuantScope alarm motoru e-posta göndermeye hazır.</p>",
    };
  }
  if (body.action !== "alert") return null;

  const symbol = String(body.symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  const interval = String(body.interval ?? "").replace(/[^0-9mhdw]/gi, "").slice(0, 8);
  const direction = String(body.direction ?? "").slice(0, 30);
  const lastPrice = Number(body.lastPrice);
  const threshold = Number(body.threshold);
  const quantScore = Number(body.quantScore);
  const confidence = Number(body.confidence);
  if (
    !symbol ||
    !interval ||
    !Number.isFinite(lastPrice) ||
    !Number.isFinite(threshold) ||
    !Number.isFinite(quantScore) ||
    !Number.isFinite(confidence)
  ) {
    return null;
  }

  const title = `[${direction || "ALARM"}] ${symbol} ${interval} fiyat alarmı`;
  const detail = `${symbol} fiyatı ${formatNumber(lastPrice)} seviyesine ulaştı. Eşik: ${formatNumber(threshold)}. Quant skor: ${formatNumber(quantScore, 0)}. Güven: %${formatNumber(confidence, 0)}.`;
  return {
    subject: title,
    text: detail,
    html:
      `<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>` +
      `<p><b>${escapeHtml(symbol)}</b> fiyatı <b>${formatNumber(lastPrice)}</b> seviyesine ulaştı.</p>` +
      `<p>Eşik: <b>${formatNumber(threshold)}</b><br>` +
      `Quant skor: <b>${formatNumber(quantScore, 0)}</b><br>` +
      `Güven: <b>%${formatNumber(confidence, 0)}</b></p>` +
      "<p style=\"color:#64748b\">Bu bildirim QuantScope tarafından otomatik oluşturuldu.</p>",
  };
}

export async function GET() {
  return Response.json(
    {
      configured: configured(),
      recipientConfigured: Boolean(process.env.FASTACT_EMAIL_RECIPIENT),
      provider: "gmail-smtp",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "İstek kaynağı doğrulanamadı." }, { status: 403 });
  }
  if (isRateLimited(request)) {
    return Response.json({ error: "Çok fazla gönderim isteği." }, { status: 429 });
  }
  if (!configured()) {
    return Response.json({ error: "E-posta servisi yapılandırılmadı." }, { status: 503 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "JSON istek gövdesi gerekli." }, { status: 415 });
  }

  let body: EmailRequest;
  try {
    const raw = await request.text();
    if (raw.length > 10_000) {
      return Response.json({ error: "İstek gövdesi çok büyük." }, { status: 413 });
    }
    body = JSON.parse(raw) as EmailRequest;
  } catch {
    return Response.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }
  const content = createContent(body);
  if (!content) {
    return Response.json({ error: "E-posta alanları eksik veya geçersiz." }, { status: 422 });
  }

  try {
    await sendGmailMessage({
      sender: String(process.env.FASTACT_EMAIL_SENDER),
      appPassword: String(process.env.FASTACT_EMAIL_APP_PASSWORD),
      recipient: String(process.env.FASTACT_EMAIL_RECIPIENT),
      ...content,
    });
    return Response.json({ sent: true });
  } catch {
    return Response.json(
      { error: "E-posta şu anda gönderilemedi. Yapılandırmayı kontrol edin." },
      { status: 502 },
    );
  }
}
