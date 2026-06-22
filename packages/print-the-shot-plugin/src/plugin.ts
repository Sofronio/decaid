/// <reference path="./host.d.ts" />

import { renderSettingsPage } from "./pages/settings";

// ── Following visualizer.reaplugin pattern ──

const SHOT_FETCH_DELAY_MS = 5000;
const NS = "print-the-shot.reaplugin";

let shotFetchTimeoutId: ReturnType<typeof setTimeout> | null = null;
let isUploading = false;
const eventLog: string[] = [];
const uploadLog: string[] = [];

interface UploadSettings {
  serverUrl: string;
  serverEndpoint: string;
  useHttp: boolean;
  machineName: string;
  autoUpload: boolean;
  minSeconds: number;
}

const state = {
  serverUrl: "yourserverip:8000",
  serverEndpoint: "upload",
  useHttp: true,
  machineName: "",
  autoUpload: true,
  minSeconds: 6,
  lastMachineState: null as string | null,
};

function log(msg: string) {
  // host is captured from createPlugin scope
}

// ── Helpers ──

function generateMachineId(name: string): string {
  if (!name) return "UNKNOWN";
  const clean = name.replace(/[^a-zA-Z0-9]/g, "");
  if (!clean) return "UNKNOWN";
  return clean.length > 20 ? clean.substring(0, 20) : clean;
}

async function fetchShot(shotId: string | null): Promise<Record<string, unknown> | null> {
  try {
    const url = shotId
      ? `http://localhost:8080/api/v1/shots/${shotId}`
      : "http://localhost:8080/api/v1/shots/latest";
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (shotId) return data;
    // /latest returns { id, timestamp, measurements, ... } directly
    return data && data.id ? data : null;
  } catch {
    return null;
  }
}

async function getBeverageType(): Promise<string> {
  try {
    const res = await fetch("/api/v1/current-profile");
    if (!res.ok) return "espresso";
    const data = await res.json();
    return (data as any).beverageType || "espresso";
  } catch {
    return "espresso";
  }
}

// ── TCL format transform ──

function toTclFormat(shot: Record<string, unknown>): Record<string, unknown> {
  const ms = (shot as any).measurements || [];
  const elapsed: string[] = [], pressure: string[] = [], pressureGoal: string[] = [],
    flow: string[] = [], flowByWeight: string[] = [], flowGoal: string[] = [],
    basket: string[] = [], mix: string[] = [], tempGoal: string[] = [],
    weight: string[] = [], waterDispensed: string[] = [],
    stateChange: string[] = [];
  let prevSt = "";

  // t0 = first preinfusion/pouring point (plotHistoricalShot shotStartTime)
  let t0: number | null = null;
  for (let i = 0; i < ms.length; i++) {
    const ss = ms[i].machine?.state?.substate || "";
    if (ss !== "preinfusion" && ss !== "pouring") continue;
    const ts = ms[i].machine?.timestamp;
    if (ts != null) { t0 = new Date(ts as string).getTime(); break; }
  }
  if (t0 == null) t0 = 0;

  // Weight smoothing state (matching chart's SMOOTHING_FACTOR = 0.1)
  let lastScaleWeight = 0;
  let lastScaleTime = 0;
  let smoothedWeightChange = 0;

  for (let i = 0; i < ms.length; i++) {
    const m = ms[i].machine || {};
    const ss = m.state?.substate || "";
    if (ss !== "preinfusion" && ss !== "pouring") continue;

    const s = ms[i].scale || {};

    // ── Elapsed: machine timestamp diff ──
    const mts = m.timestamp;
    const et = mts != null ? ((new Date(mts as string).getTime() - t0) / 1000).toFixed(1) : "0.0";
    elapsed.push(et);

    // ── Pressure: direct ──
    pressure.push(m.pressure != null ? (m.pressure as number).toFixed(2) : "0.0");
    pressureGoal.push(m.targetPressure != null ? (m.targetPressure as number).toFixed(2) : "0.0");

    // ── Flow: direct ──
    flow.push(m.flow != null ? (m.flow as number).toFixed(2) : "0.0");
    flowGoal.push(m.targetFlow != null ? (m.targetFlow as number).toFixed(2) : "0.0");

    // ── Temperature: raw °C ──
    basket.push(m.groupTemperature != null ? (m.groupTemperature as number).toFixed(2) : "0.0");
    mix.push(m.mixTemperature != null ? (m.mixTemperature as number).toFixed(2) : "0.0");
    tempGoal.push(m.targetGroupTemperature != null ? (m.targetGroupTemperature as number).toFixed(2) : "0.0");

    // ── Weight: smoothed derivative on scale timestamp (chart algorithm) ──
    let weightChange = 0;
    if (s.weight != null) {
      const scaleTs = s.timestamp;
      if (scaleTs != null) {
        const scaleTime = (new Date(scaleTs as string).getTime() - t0) / 1000;
        if (lastScaleTime > 0 && scaleTime > lastScaleTime) {
          const timeDiff = scaleTime - lastScaleTime;
          const rawChange = ((s.weight as number) - lastScaleWeight) / timeDiff;
          smoothedWeightChange = 0.1 * rawChange + 0.9 * smoothedWeightChange;
          weightChange = smoothedWeightChange;
        }
        lastScaleWeight = s.weight as number;
        lastScaleTime = scaleTime;
      }
    }
    flowByWeight.push(weightChange.toFixed(2));

    // ── Cumulative weight (for totals.weight) ──
    weight.push(s.weight != null ? (s.weight as number).toFixed(1) : "0.0");

    // ── Volume ──
    waterDispensed.push(ms[i].volume != null ? (ms[i].volume as number).toFixed(2) : "0.0");

    // ── State change ──
    const currSt = (m.state?.state || "") + "/" + (m.state?.substate || "");
    stateChange.push(currSt !== prevSt ? "10000000.0" : "0.0");
    prevSt = currSt;
  }

  // Normalize elapsed to start from 0
  const et0 = parseFloat(elapsed[0]);
  for (let j = 0; j < elapsed.length; j++) {
    elapsed[j] = (parseFloat(elapsed[j]) - et0).toFixed(1);
  }

  const wf = (shot as any).workflow || {};
  const ann = (shot as any).annotations || {};
  const ctx = wf.context || {};
  const prof = wf.profile || {};

  return {
    version: "2",
    clock: String(Math.floor(Date.now() / 1000)),
    date: new Date().toString(),
    timestamp: String(Math.floor(Date.now() / 1000)),
    elapsed,
    pressure: { pressure, goal: pressureGoal },
    flow: { flow, by_weight: flowByWeight, goal: flowGoal },
    temperature: { basket, mix, goal: tempGoal },
    totals: { weight, water_dispensed: waterDispensed },
    state_change: stateChange,
    profile: {
      title: prof.title || "Default", author: prof.author || "Decent", notes: prof.notes || "",
      beverage_type: prof.beverage_type || "espresso", tank_temperature: "0",
      target_weight: ann.actualYield != null ? String(Math.round(ann.actualYield as number)) : "0",
      target_volume: "0", target_volume_count_start: String(prof.target_volume_count_start || 0), version: "2",
    },
    meta: {
      bean: { brand: ctx.beanBrand || "", type: "", notes: "", roast_level: "", roast_date: "" },
      shot: { enjoyment: "0", notes: "", tds: "0", ey: "0" },
      grinder: { model: ctx.grinderModel || "", setting: ctx.grinderSetting || "" },
      in: ann.actualDoseWeight != null ? String(ann.actualDoseWeight) : "0",
      out: ann.actualYield != null ? String(ann.actualYield) : "0",
      time: elapsed.length > 0 ? elapsed[elapsed.length - 1] : "0",
    },
    app: { app_name: "Decent.app", app_version: "1.0.0", data: {} },
  };
}

// ── Upload ──

async function uploadToServer(shotData: Record<string, unknown>): Promise<boolean> {
  const machineId = generateMachineId(state.machineName);
  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const protocol = state.useHttp ? "http" : "https";
  const targetUrl =
    protocol + "://" + state.serverUrl + "/" + state.serverEndpoint +
    "?machine_id=" + machineId + "&timestamp=" + ts + "&plugin_version=1.2.0";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await Promise.race([
        fetch(targetUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(shotData) }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000)),
      ]);
      if (res.ok) return true;
    } catch { /* retry */ }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// ── Shot completion handler (visualizer pattern) ──

async function handleShotComplete(logFn: (msg: string) => void) {
  if (isUploading) { uploadLog.push(now() + " already uploading, skip"); return; }
  isUploading = true;

  try {
    if (!state.autoUpload) { uploadLog.push(now() + " auto-upload disabled"); return; }

    // Retry fetching — shot may not be persisted yet
    let latestMeta = null;
    for (let retry = 0; retry < 5; retry++) {
      if (retry > 0) await new Promise((r) => setTimeout(r, 1000));
      uploadLog.push(now() + " fetching latest shot (attempt " + (retry + 1) + "/5)...");
      latestMeta = await fetchShot(null);
      if (latestMeta && latestMeta.id) break;
    }
    if (!latestMeta || !latestMeta.id) { uploadLog.push(now() + " no shot found after retries"); return; }
    const shotId = latestMeta.id as string;
    uploadLog.push(now() + " shot=" + shotId);

    const bevType = await getBeverageType();
    if (bevType === "cleaning" || bevType === "calibrate") { uploadLog.push(now() + " skip " + bevType); return; }

    uploadLog.push(now() + " fetching full shot...");
    const fullShot = await fetchShot(shotId);
    if (!fullShot) { uploadLog.push(now() + " full shot fetch failed"); return; }

    // Duration check (from full shot with measurements)
    const ms = (fullShot as any).measurements;
    let duration = 0;
    if (ms && ms.length >= 2) {
      const first = ms[0].machine?.timestamp;
      const last = ms[ms.length - 1].machine?.timestamp;
      duration = (first && last) ? Math.round((new Date(last).getTime() - new Date(first).getTime()) / 1000) : Math.round(ms.length * 0.24);
    }
    if (duration < state.minSeconds) { uploadLog.push(now() + " too short: " + duration + "s"); return; }

    const tclData = toTclFormat(fullShot);
    uploadLog.push(now() + " uploading " + (tclData.elapsed as any[])?.length + " pts...");
    const ok = await uploadToServer(tclData);
    uploadLog.push(now() + " result=" + (ok ? "OK" : "FAIL"));
  } catch (err) {
    uploadLog.push(now() + " error: " + (err instanceof Error ? err.message : "Unknown"));
  } finally {
    isUploading = false;
  }
}

function now(): string {
  return new Date().toISOString().slice(11, 23);
}

// ── Entry point ──

export default function createPlugin(host: PluginHost): PluginInstance {
  const logFn = (msg: string) => host.log(`[print-the-shot] ${msg}`);

  return {
    id: "print-the-shot.reaplugin",
    version: "1.2.0",

    onLoad(settings: Record<string, unknown>) {
      if (settings.AutoUpload !== undefined) state.autoUpload = settings.AutoUpload as boolean;
      if (settings.ServerUrl !== undefined) state.serverUrl = settings.ServerUrl as string;
      if (settings.ServerEndpoint !== undefined) state.serverEndpoint = settings.ServerEndpoint as string;
      if (settings.UseHttp !== undefined) state.useHttp = settings.UseHttp as boolean;
      if (settings.MachineName !== undefined) state.machineName = settings.MachineName as string;
      if (settings.MinSeconds !== undefined) state.minSeconds = settings.MinSeconds as number;
      logFn("Loaded. auto=" + state.autoUpload + " server=" + state.serverUrl + "/" + state.serverEndpoint);
    },

    onUnload() {
      if (shotFetchTimeoutId !== null) { clearTimeout(shotFetchTimeoutId); shotFetchTimeoutId = null; }
      logFn("Unloaded");
    },

    onEvent(event: PluginEvent) {
      if (!event || !event.name) return;

      switch (event.name) {
        case "stateUpdate": {
          const currentState = (event.payload as any)?.state?.state;
          // Track events for debugging
          eventLog.push(new Date().toISOString().slice(11, 23) + " " + state.lastMachineState + "→" + currentState);
          if (eventLog.length > 50) eventLog.shift();
          if (state.lastMachineState === "espresso" && currentState !== "espresso") {
            logFn(`Shot ended (${state.lastMachineState} → ${currentState}), scheduling upload in ${SHOT_FETCH_DELAY_MS / 1000}s`);
            if (shotFetchTimeoutId !== null) clearTimeout(shotFetchTimeoutId);
            shotFetchTimeoutId = setTimeout(() => {
              shotFetchTimeoutId = null;
              handleShotComplete(logFn);
            }, SHOT_FETCH_DELAY_MS);
          }
          state.lastMachineState = currentState;
          break;
        }

        case "shotCompleted": {
          eventLog.push(new Date().toISOString().slice(11, 23) + " shotCompleted");
          if (eventLog.length > 50) eventLog.shift();
          logFn("shotCompleted event — starting auto-upload");
          if (shotFetchTimeoutId !== null) clearTimeout(shotFetchTimeoutId);
          shotFetchTimeoutId = setTimeout(() => {
            shotFetchTimeoutId = null;
            handleShotComplete(logFn);
          }, SHOT_FETCH_DELAY_MS);
          break;
        }

        case "settingsUpdated": {
          const p = event.payload as Record<string, unknown> | undefined;
          if (p?.AutoUpload !== undefined) state.autoUpload = p.AutoUpload as boolean;
          if (p?.ServerUrl !== undefined) state.serverUrl = p.ServerUrl as string;
          if (p?.ServerEndpoint !== undefined) state.serverEndpoint = p.ServerEndpoint as string;
          if (p?.UseHttp !== undefined) state.useHttp = p.UseHttp as boolean;
          if (p?.MachineName !== undefined) state.machineName = p.MachineName as string;
          if (p?.MinSeconds !== undefined) state.minSeconds = p.MinSeconds as number;
          logFn("Settings updated. auto=" + state.autoUpload + " server=" + state.serverUrl);
          // Sync to host storage
          host.storage({ type: "write", key: "settings", namespace: NS, data: state });
          break;
        }

        case "shutdown":
          if (shotFetchTimeoutId !== null) { clearTimeout(shotFetchTimeoutId); shotFetchTimeoutId = null; }
          break;
      }
    },

    __httpRequestHandler(request: HttpRequest): HttpResponse {
      switch (request.endpoint) {
        case "ui":
          return renderSettingsPage(request);

        case "upload":
          return handleUpload(request, logFn);

        case "debug": {
          return {
            requestId: request.requestId, status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              state: state,
              isUploading: isUploading,
              hasTimeout: shotFetchTimeoutId !== null,
              pluginId: "print-the-shot.reaplugin",
              events: eventLog,
              uploadLog: uploadLog,
            }),
          };
        }

        case "save-settings": {
          if (request.method === "POST") {
            const body = request.body as Record<string, unknown> | null;
            if (body) {
              if (body.autoUpload !== undefined) state.autoUpload = body.autoUpload as boolean;
              if (body.serverUrl !== undefined) state.serverUrl = body.serverUrl as string;
              if (body.serverEndpoint !== undefined) state.serverEndpoint = body.serverEndpoint as string;
              if (body.useHttp !== undefined) state.useHttp = body.useHttp as boolean;
              if (body.machineName !== undefined) state.machineName = body.machineName as string;
              if (body.minSeconds !== undefined) state.minSeconds = body.minSeconds as number;
              host.storage({ type: "write", key: "settings", namespace: NS, data: state });
            }
            return { requestId: request.requestId, status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
          }
          return { requestId: request.requestId, status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) };
        }

        default:
          return { requestId: request.requestId, status: 404, headers: { "Content-Type": "text/plain" }, body: "Not found" };
      }
    },
  };
}

// ── Manual upload proxy ──

async function handleUpload(request: HttpRequest, logFn: (msg: string) => void): Promise<HttpResponse> {
  try {
    const { url, shot } = request.body as { url: string; shot: unknown };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await Promise.race([
          fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(shot) }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000)),
        ]);
        const body = await res.text();
        if (res.ok) return { requestId: request.requestId, status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true, statusCode: res.status, data: body }) };
        logFn(`Upload attempt ${attempt} failed: HTTP ${res.status}`);
      } catch (err) { logFn(`Upload attempt ${attempt} error: ${err instanceof Error ? err.message : "Unknown"}`); }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
    return { requestId: request.requestId, status: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: false, message: "Upload failed after 3 attempts" }) };
  } catch {
    return { requestId: request.requestId, status: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: false, message: "Invalid request" }) };
  }
}
