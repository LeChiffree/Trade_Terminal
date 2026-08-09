import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const env = parseEnv(await readFile(new URL("../.env.local", import.meta.url), "utf8"));
const baseUrl = env.BINANCE_FUTURES_BASE_URL;
if (baseUrl !== "https://demo-fapi.binance.com") {
  throw new Error("Demo doğrulama aracı yalnızca demo-fapi.binance.com kullanır.");
}
if (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET) {
  throw new Error("Binance Demo anahtarları .env.local içinde bulunamadı.");
}

const timeResponse = await fetch(`${baseUrl}/fapi/v1/time`);
const time = await timeResponse.json();
if (!timeResponse.ok || !Number.isFinite(time.serverTime)) {
  throw new Error("Binance Demo sunucu saati alınamadı.");
}
const query = `recvWindow=5000&timestamp=${time.serverTime}`;
const signature = createHmac("sha256", env.BINANCE_API_SECRET)
  .update(query)
  .digest("hex");
const response = await fetch(
  `${baseUrl}/fapi/v3/account?${query}&signature=${signature}`,
  { headers: { "X-MBX-APIKEY": env.BINANCE_API_KEY } },
);
const account = await response.json();
if (!response.ok || account.code) {
  throw new Error(account.msg || `Binance Demo HTTP ${response.status}`);
}

const positionQuery = `recvWindow=5000&timestamp=${time.serverTime}`;
const positionSignature = createHmac("sha256", env.BINANCE_API_SECRET)
  .update(positionQuery)
  .digest("hex");
const positionResponse = await fetch(
  `${baseUrl}/fapi/v2/positionRisk?${positionQuery}&signature=${positionSignature}`,
  { headers: { "X-MBX-APIKEY": env.BINANCE_API_KEY } },
);
const positionRisk = await positionResponse.json();
if (!positionResponse.ok || positionRisk.code) {
  throw new Error(positionRisk.msg || `Binance Demo HTTP ${positionResponse.status}`);
}

const testParameters = new URLSearchParams({
  symbol: "BTCUSDT",
  side: "BUY",
  type: "MARKET",
  quantity: "0.001",
  newClientOrderId: `qs-permission-${Date.now()}`,
  recvWindow: "5000",
  timestamp: String(time.serverTime),
});
testParameters.set(
  "signature",
  createHmac("sha256", env.BINANCE_API_SECRET)
    .update(testParameters.toString())
    .digest("hex"),
);
const testResponse = await fetch(
  `${baseUrl}/fapi/v1/order/test?${testParameters}`,
  {
    method: "POST",
    headers: { "X-MBX-APIKEY": env.BINANCE_API_KEY },
  },
);
const testOrder = await testResponse.json();

console.log(JSON.stringify({
  ok: true,
  environment: "Binance USD-M Futures Demo",
  canTrade: Boolean(account.canTrade),
  testOrderAccepted: testResponse.ok && !testOrder.code,
  testOrderErrorCode: testOrder.code ?? null,
  testOrderError: testOrder.msg ?? null,
  totalWalletBalance: Number(account.totalWalletBalance ?? 0),
  availableBalance: Number(account.availableBalance ?? 0),
  openPositions: (positionRisk ?? []).filter(
    (position) => Number(position.positionAmt) !== 0,
  ).length,
  positions: (positionRisk ?? [])
    .filter((position) => Number(position.positionAmt) !== 0)
    .map((position) => ({
      symbol: position.symbol,
      positionAmt: Number(position.positionAmt),
      entryPrice: Number(position.entryPrice),
      markPrice: Number(position.markPrice),
      leverage: Number(position.leverage),
      marginType: position.marginType,
      liquidationPrice: Number(position.liquidationPrice),
      unrealizedProfit: Number(
        position.unRealizedProfit ?? position.unrealizedProfit ?? 0,
      ),
    })),
}));
