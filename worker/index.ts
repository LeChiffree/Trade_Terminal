/** Cloudflare Worker entry point for QuantScope. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  runScannerTick,
  runScheduledScannerMinute,
  type ScannerEnv,
} from "../lib/background-scanner";

interface Env extends ScannerEnv {
  ASSETS: Fetcher;
  SCANNER_COORDINATOR?: DurableObjectNamespace;
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

const SCANNER_OBJECT_NAME = "global-market-scanner";
const SCANNER_ALARM_CADENCE_MS = 15_000;

function nextScannerAlarm(now = Date.now()) {
  return (
    Math.floor(now / SCANNER_ALARM_CADENCE_MS + 1) *
    SCANNER_ALARM_CADENCE_MS
  );
}

async function startScannerCoordinator(namespace?: DurableObjectNamespace) {
  if (!namespace) return;
  const response = await namespace
    .getByName(SCANNER_OBJECT_NAME)
    .fetch("https://scanner.internal/start", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Scanner coordinator start failed (${response.status})`);
  }
}

export class ScannerCoordinator implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/start") {
      return new Response("Not found", { status: 404 });
    }
    const currentAlarm = await this.state.storage.getAlarm();
    if (currentAlarm === null || currentAlarm < Date.now() - 30_000) {
      await this.state.storage.setAlarm(nextScannerAlarm());
    }
    return Response.json({
      running: true,
      nextAlarm: (await this.state.storage.getAlarm()) ?? null,
    });
  }

  async alarm(): Promise<void> {
    try {
      const result = await runScannerTick(this.env, Date.now());
      await this.state.storage.put("lastRun", {
        at: Date.now(),
        result,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 500) : "Scanner alarm failed";
      await this.state.storage.put("lastRun", {
        at: Date.now(),
        error: message,
      });
      console.error("Scanner alarm tick failed", error);
    } finally {
      await this.state.storage.setAlarm(nextScannerAlarm());
    }
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/api/scanner") {
      ctx.waitUntil(
        startScannerCoordinator(env.SCANNER_COORDINATOR).catch((error) => {
          console.error("Scanner coordinator bootstrap failed", error);
        }),
      );
    }

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
    try {
      await runScheduledScannerMinute(
        env,
        scheduledMinute,
        async (delayMs) => await scheduler.wait(delayMs),
      );
    } catch (error) {
      console.error("Scheduled scanner failed", error);
      throw error;
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
