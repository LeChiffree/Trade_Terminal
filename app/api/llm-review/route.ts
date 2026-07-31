export const dynamic = "force-dynamic";

type ReviewInput = {
  symbol?: string;
  interval?: string;
  regime?: string;
  facts?: Array<{
    name: string;
    family: string;
    value: string;
    state: string;
    interpretation: string;
    score?: number;
  }>;
  levels?: { supports?: number[]; resistances?: number[]; atr?: number };
};

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

const clamp = (value: unknown, min = -100, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));

function demoReview(input: ReviewInput): LlmReview {
  const facts = input.facts ?? [];
  const scores = facts.map((fact) => Number(fact.score)).filter(Number.isFinite);
  const independent = scores.length ? scores.reduce((sum, score) => sum + Math.tanh(score / 45) * 24, 0) / Math.sqrt(scores.length) : 0;
  const directionScore = Math.round(clamp(independent));
  const positives = facts.filter((fact) => Number(fact.score) > 22).sort((a, b) => Number(b.score) - Number(a.score));
  const negatives = facts.filter((fact) => Number(fact.score) < -22).sort((a, b) => Number(a.score) - Number(b.score));
  return {
    direction_score: directionScore,
    confidence: Math.round(clamp(52 + Math.abs(directionScore) * .25, 0, 85)),
    tradeability_score: 62,
    risk_score: 38,
    approval: Math.abs(directionScore) < 15 ? "uncertain" : negatives.length && positives.length ? "approve_with_caution" : "approve",
    market_regime: input.regime ?? "Bilinmiyor",
    top_reasons: positives.slice(0, 3).map((fact) => fact.interpretation),
    contradictions: negatives.slice(0, 2).map((fact) => fact.interpretation),
    risk_flags: ["Gerçek LLM anahtarı bağlı değil; bu sonuç yalnızca entegrasyon önizlemesidir."],
    summary_tr: "Second approver akışı çalışıyor. Gerçek model bağlandığında bu demo değerlendirmesi bağımsız LLM yorumu ile değiştirilecek.",
    provider: "local-demo",
    configured: false,
  };
}

function normalizeReview(value: Record<string, unknown>, provider: string): LlmReview {
  const approvalValues = new Set(["approve", "approve_with_caution", "reject", "uncertain"]);
  const stringArray = (item: unknown) => Array.isArray(item) ? item.slice(0, 5).map(String) : [];
  const approval = String(value.approval ?? "uncertain");
  return {
    direction_score: Math.round(clamp(value.direction_score)),
    confidence: Math.round(clamp(value.confidence, 0, 100)),
    tradeability_score: Math.round(clamp(value.tradeability_score, 0, 100)),
    risk_score: Math.round(clamp(value.risk_score, 0, 100)),
    approval: approvalValues.has(approval) ? approval as LlmReview["approval"] : "uncertain",
    market_regime: String(value.market_regime ?? "Bilinmiyor"),
    top_reasons: stringArray(value.top_reasons),
    contradictions: stringArray(value.contradictions),
    risk_flags: stringArray(value.risk_flags),
    summary_tr: String(value.summary_tr ?? "Model özeti alınamadı."),
    provider,
    configured: true,
  };
}

export async function GET() {
  return Response.json({
    configured: Boolean(process.env.LLM_API_KEY && process.env.LLM_MODEL),
    provider: process.env.LLM_PROVIDER ?? (process.env.LLM_API_KEY ? "openai-compatible" : "local-demo"),
    model: process.env.LLM_MODEL ?? null,
  });
}

export async function POST(request: Request) {
  const input = await request.json() as ReviewInput;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!apiKey || !model) return Response.json(demoReview(input));

  const baseUrl = (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const provider = process.env.LLM_PROVIDER ?? "openai-compatible";
  const systemPrompt = `Sen açıklanabilir teknik analiz yapan bağımsız bir risk onaylayıcısısın. Sana hesaplanmış ve doğrulanmış piyasa gerçekleri verilecek. İndikatörleri yeniden hesaplama, veride olmayan fiyat veya seviye uydurma. Aynı correlation_group içindeki benzer göstergeleri ayrı bağımsız oy gibi sayma. ATR ve volatiliteyi yön sinyali sayma. Quant motorunun final skoru sana verilmez; bağımsız karar üret. Yalnızca geçerli JSON döndür. Şema: {"direction_score":-100..100,"confidence":0..100,"tradeability_score":0..100,"risk_score":0..100,"approval":"approve|approve_with_caution|reject|uncertain","market_regime":"string","top_reasons":["..."],"contradictions":["..."],"risk_flags":["..."],"summary_tr":"Türkçe kısa özet"}.`;
  const payloadForModel = {
    symbol: input.symbol,
    interval: input.interval,
    regime: input.regime,
    levels: input.levels,
    facts: (input.facts ?? []).slice(0, 45).map(({ name, family, value, state, interpretation }) => ({ name, family, value, state, interpretation })),
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(payloadForModel) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`LLM ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")) as Record<string, unknown>;
    return Response.json(normalizeReview(parsed, provider));
  } catch (error) {
    return Response.json({ ...demoReview(input), error: error instanceof Error ? error.message : "LLM request failed" }, { status: 200 });
  }
}
