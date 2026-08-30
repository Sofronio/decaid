/// <reference path="./host.d.ts" />

import { toTclFormat } from "./api/transform";
import { renderSettingsPage } from "./pages/settings";

const VERSION = "1.3.0";
const UPLOAD_TIMEOUT_MS = 10000;
const SHOT_FETCH_RETRIES = 3;
const SHOT_FETCH_DELAY_MS = 1000;
const UPLOAD_ATTEMPTS = 3;
const UPLOAD_BACKOFF_MS = 2000;
const API_BASE = "http://localhost:8080/api/v1";

interface PrintState {
  autoUpload: boolean;
  serverUrl: string;
  serverEndpoint: string;
  useHttp: boolean;
  machineName: string;
  minSeconds: number;
}

function defaultState(): PrintState {
  return {
    autoUpload: true,
    serverUrl: "",
    serverEndpoint: "upload",
    useHttp: true,
    machineName: "",
    minSeconds: 6,
  };
}

function applySettings(state: PrintState, settings: Record<string, unknown>) {
  if (typeof settings.AutoUpload === "boolean") state.autoUpload = settings.AutoUpload;
  if (typeof settings.ServerUrl === "string") state.serverUrl = settings.ServerUrl;
  if (typeof settings.ServerEndpoint === "string") state.serverEndpoint = settings.ServerEndpoint;
  if (typeof settings.UseHttp === "boolean") state.useHttp = settings.UseHttp;
  if (typeof settings.MachineName === "string") state.machineName = settings.MachineName;
  if (typeof settings.MinSeconds === "number") state.minSeconds = settings.MinSeconds;
}

function machineId(name: string): string {
  const clean = String(name || "").replace(/[^A-Za-z0-9]/g, "");
  return clean ? clean.slice(0, 20) : "UNKNOWN";
}

async function fetchShotWithRetry(shotId: string): Promise<Record<string, unknown> | null> {
  for (let attempt = 1; attempt <= SHOT_FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/shots/${shotId}`);
      if (res.ok) return await res.json();
    } catch {
      // retry
    }
    if (attempt < SHOT_FETCH_RETRIES) {
      await new Promise((r) => setTimeout(r, SHOT_FETCH_DELAY_MS));
    }
  }
  return null;
}

function passesFilters(
  shot: Record<string, unknown>,
  state: PrintState,
  log: (msg: string) => void
): boolean {
  const wf = (shot.workflow || {}) as Record<string, any>;
  const beverage = (wf.profile && wf.profile.beverage_type) || "espresso";
  if (beverage === "cleaning" || beverage === "calibrate") {
    log(`skipping ${beverage} shot`);
    return false;
  }
  const ms = (shot.measurements as Array<Record<string, any>>) || [];
  let duration = 0;
  if (ms.length >= 2) {
    const first = ms[0].machine && ms[0].machine.timestamp;
    const last = ms[ms.length - 1].machine && ms[ms.length - 1].machine.timestamp;
    duration =
      first && last
        ? Math.round((new Date(last as string).getTime() - new Date(first as string).getTime()) / 1000)
        : Math.round(ms.length * 0.24);
  }
  if (duration < state.minSeconds) {
    log(`shot too short (${duration}s < ${state.minSeconds}s), skipping`);
    return false;
  }
  return true;
}

function buildTargetUrl(state: PrintState): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const protocol = state.useHttp ? "http" : "https";
  const server = String(state.serverUrl).replace(/^https?:[/][/]/, "");
  return (
    `${protocol}://${server}/${state.serverEndpoint}` +
    `?machine_id=${machineId(state.machineName)}&timestamp=${ts}&plugin_version=${VERSION}`
  );
}

async function uploadWithRetry(
  url: string,
  tcl: Record<string, unknown>,
  log: (msg: string) => void
): Promise<boolean> {
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      const res = await Promise.race([
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tcl),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("upload timeout")), UPLOAD_TIMEOUT_MS)
        ),
      ]);
      if (res.ok) {
        log(`upload OK (attempt ${attempt})`);
        return true;
      }
      log(`attempt ${attempt} failed: HTTP ${res.status}`);
    } catch (e) {
      log(`attempt ${attempt} error: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (attempt < UPLOAD_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, UPLOAD_BACKOFF_MS));
    }
  }
  log("upload FAILED after " + UPLOAD_ATTEMPTS + " attempts");
  return false;
}

async function autoProcessShot(
  shotId: string,
  state: PrintState,
  log: (msg: string) => void
) {
  if (!state.serverUrl) {
    log("no server configured, skipping auto-upload");
    return;
  }
  log(`auto-upload shot ${shotId.slice(0, 8)}`);
  const shot = await fetchShotWithRetry(shotId);
  if (!shot) {
    log("shot fetch failed");
    return;
  }
  if (!passesFilters(shot, state, log)) return;
  const tcl = toTclFormat(shot);
  await uploadWithRetry(buildTargetUrl(state), tcl, log);
}

export default function createPlugin(host: PluginHost): PluginInstance {
  const log = (msg: string) => host.log(`[print-the-shot] ${msg}`);
  const state = defaultState();
  let inFlight = false;

  return {
    id: "print-the-shot.reaplugin",
    version: VERSION,

    onLoad(settings: Record<string, unknown>) {
      applySettings(state, settings);
      log(
        `loaded v${VERSION}, auto-upload ${state.autoUpload ? "ON" : "OFF"}, ` +
          `server=${state.serverUrl || "unset"}`
      );
    },

    onUnload() {},

    onEvent(event: PluginEvent) {
      if (event.name !== "shotStored") return;
      const id = (event.payload as { id?: unknown } | undefined)?.id;
      if (typeof id !== "string") return;
      host.emit("events", { id });
      if (inFlight) {
        log("auto-upload already in flight, skipping " + id.slice(0, 8));
        return;
      }
      if (!state.autoUpload) {
        log("auto-upload disabled, skipping " + id.slice(0, 8));
        return;
      }
      inFlight = true;
      autoProcessShot(id, state, log).finally(() => {
        inFlight = false;
      });
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
    const rawShot = body.shot as Record<string, unknown>;
    const tcl = Array.isArray(rawShot.elapsed) ? rawShot : toTclFormat(rawShot);
    const res = await Promise.race([
      fetch(body.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tcl),
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
