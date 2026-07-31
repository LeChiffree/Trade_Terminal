export const dynamic = "force-dynamic";

const configured = () => Boolean(
  process.env.GMAIL_CLIENT_ID &&
  process.env.GMAIL_CLIENT_SECRET &&
  process.env.GMAIL_REFRESH_TOKEN &&
  process.env.ALERT_EMAIL_TO,
);

export async function GET() {
  return Response.json({ configured: configured(), recipientConfigured: Boolean(process.env.ALERT_EMAIL_TO) });
}

function base64Encode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64UrlEncode(value: string) {
  return base64Encode(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function POST(request: Request) {
  if (!configured()) {
    return Response.json({ error: "Gmail API henüz bağlanmadı." }, { status: 503 });
  }
  const body = await request.json() as { subject?: string; html?: string };
  const subject = String(body.subject ?? "QuantScope test alarmı").slice(0, 180);
  const html = String(body.html ?? "QuantScope Gmail bağlantı testi.").slice(0, 20_000);
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: String(process.env.GMAIL_CLIENT_ID),
        client_secret: String(process.env.GMAIL_CLIENT_SECRET),
        refresh_token: String(process.env.GMAIL_REFRESH_TOKEN),
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) throw new Error(`OAuth ${tokenResponse.status}`);
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) throw new Error("Access token missing");
    const encodedSubject = `=?UTF-8?B?${base64Encode(subject)}?=`;
    const message = [
      `To: ${process.env.ALERT_EMAIL_TO}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
      html,
    ].join("\r\n");
    const sendResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: base64UrlEncode(message) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!sendResponse.ok) throw new Error(`Gmail ${sendResponse.status}`);
    const result = await sendResponse.json() as { id?: string };
    return Response.json({ sent: true, messageId: result.id ?? null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Email failed" }, { status: 502 });
  }
}
