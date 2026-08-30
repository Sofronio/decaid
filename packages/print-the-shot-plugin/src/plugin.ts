/// <reference path="./host.d.ts" />

import { renderSettingsPage } from "./pages/settings";

const VERSION = "1.3.0";
const UPLOAD_TIMEOUT_MS = 10000;

export default function createPlugin(host: PluginHost): PluginInstance {
  const log = (msg: string) => host.log(`[print-the-shot] ${msg}`);

  return {
    id: "print-the-shot.reaplugin",
    version: VERSION,

    onLoad() {
      log("loaded v" + VERSION);
    },

    onUnload() {},

    onEvent(event: PluginEvent) {
      if (event.name === "shotStored") {
        const id = (event.payload as { id?: unknown } | undefined)?.id;
        if (typeof id === "string") {
          host.emit("events", { id });
        }
      }
    },

    __httpRequestHandler(request: HttpRequest): HttpResponse | Promise<HttpResponse> {
      switch (request.endpoint) {
        case "ui":
          return {
            requestId: request.requestId,
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache",
            },
            body: renderSettingsPage(request, VERSION),
          };

        case "upload":
          if (request.method === "POST") {
            return handleUploadProxy(request, log);
          }
          return methodNotAllowed(request);

        case "debug":
          return {
            requestId: request.requestId,
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version: VERSION }),
          };

        default:
          return notFound(request);
      }
    },
  };
}

async function handleUploadProxy(
  request: HttpRequest,
  log: (msg: string) => void
): Promise<HttpResponse> {
  const body = request.body as { url?: string; shot?: unknown } | null;
  if (!body || typeof body.url !== "string" || body.shot == null) {
    return json(request, 400, {
      success: false,
      message: "url and shot are required",
    });
  }
  try {
    const res = await Promise.race([
      fetch(body.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body.shot),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("upload timeout")), UPLOAD_TIMEOUT_MS)
      ),
    ]);
    const text = await res.text();
    return json(request, 200, {
      success: res.ok,
      statusCode: res.status,
      data: text,
    });
  } catch (e) {
    log("proxy upload failed: " + (e instanceof Error ? e.message : String(e)));
    return json(request, 502, {
      success: false,
      message: e instanceof Error ? e.message : "upload failed",
    });
  }
}

function json(request: HttpRequest, status: number, data: unknown): HttpResponse {
  return {
    requestId: request.requestId,
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

function methodNotAllowed(request: HttpRequest): HttpResponse {
  return {
    requestId: request.requestId,
    status: 405,
    headers: { "Content-Type": "text/plain" },
    body: "Method not allowed",
  };
}

function notFound(request: HttpRequest): HttpResponse {
  return {
    requestId: request.requestId,
    status: 404,
    headers: { "Content-Type": "text/plain" },
    body: "Not found",
  };
}
