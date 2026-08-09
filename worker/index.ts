/** Cloudflare Worker entry point for QuantScope. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { runScheduledScannerMinute } from "../lib/background-scanner";
import { runBistPaperTradingCycleIfDue } from "../lib/bist-paper-trading";

interface Env {
  ASSETS: Fetcher;
  DB?: D1Database;
  FASTACT_EMAIL_SENDER?: string;
  FASTACT_EMAIL_APP_PASSWORD?: string;
  FASTACT_EMAIL_RECIPIENT?: string;
  BINANCE_API_KEY?: string;
  BINANCE_API_SECRET?: string;
  BINANCE_FUTURES_BASE_URL?: string;
  BINANCE_FUTURES_TRADING_ENABLED?: string;
  BINANCE_FUTURES_DEMO_ONLY?: string;
  BINANCE_FUTURES_MARGIN_USDT?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(response);
    }

    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const scheduledMinute = Math.floor(Date.now() / 60_000) * 60_000;
    const [scannerResult, bistPaperResult] = await Promise.allSettled([
      runScheduledScannerMinute(
        env,
        scheduledMinute,
        async (delayMs) => await scheduler.wait(delayMs),
      ),
      env.DB
        ? runBistPaperTradingCycleIfDue(env.DB, Date.now())
        : Promise.resolve({ skipped: true, reason: "database-not-configured" }),
    ]);
    if (bistPaperResult.status === "rejected") {
      console.error("Scheduled BIST paper trade failed", bistPaperResult.reason);
    }
    if (scannerResult.status === "rejected") {
      console.error("Scheduled scanner failed", scannerResult.reason);
      throw scannerResult.reason;
    }
  },
};

function withSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default worker;
