/**
 * <print-the-shot> Web Component — runs in the BROWSER.
 *
 * Listens for shot-stored events pushed over the plugin WebSocket endpoint,
 * fetches the full shot from the Decent REST API, transforms it to the TCL
 * print format (window.toTclFormat, inlined from src/api/transform.ts), and
 * uploads it to a local print server through the plugin's upload proxy
 * (avoids browser CORS). Settings live in the app-side plugin settings store.
 */

export const printTheShotComponent = `
const PLUGIN_ID = "print-the-shot.reaplugin";
const SETTINGS_URL = "/api/v1/plugins/" + PLUGIN_ID + "/settings";
const UPLOAD_URL = "/api/v1/plugins/" + PLUGIN_ID + "/upload";
const WS_URL =
  location.origin.replace(/^http/, "ws") +
  "/ws/v1/plugins/" + PLUGIN_ID + "/events";

const DEFAULT_SETTINGS = {
  AutoUpload: true,
  ServerUrl: "",
  ServerEndpoint: "upload",
  UseHttp: true,
  MachineName: "",
  MinSeconds: 6,
};

class PrintTheShot extends HTMLElement {
  constructor() {
    super();
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.isProcessing = false;
    this.socket = null;
    this.reconnectTimer = null;
    this.lastUpload = null;
    this.logs = [];
  }

  connectedCallback() {
    this.version = this.getAttribute("data-version") || "unknown";
    this.offset = 0;
    this.currentShot = null;
    this.render();
    this.cacheEls();
    this.loadSettings().then(() => {
      this.updateUI();
      this.connectSocket();
    });
    this.bindEvents();
    this.loadLatest();
    this.log("Print The Shot v" + this.version + " initialized", "info");
  }

  // ---------- DOM ----------

  render() {
    this.innerHTML = \`
      <div class="header">
        <h3>Print The Shot</h3>
        <span class="status-badge"><span class="status-dot">●</span> <span id="status-text">Connecting…</span></span>
      </div>
      <div class="settings-grid">
        <div class="settings-column">
          <div class="settings-group">
            <label class="settings-label">Server address</label>
            <input id="set-server-url" type="text" placeholder="192.168.1.20:8000" />
          </div>
          <div class="settings-group">
            <label class="settings-label">Upload path</label>
            <input id="set-server-endpoint" type="text" />
          </div>
          <div class="settings-group row">
            <input id="set-use-http" type="checkbox" />
            <label class="settings-label" for="set-use-http">Use HTTP</label>
          </div>
          <div class="settings-group row">
            <input id="set-auto-upload" type="checkbox" />
            <label class="settings-label" for="set-auto-upload">Auto upload</label>
          </div>
        </div>
        <div class="settings-column">
          <div class="settings-group">
            <label class="settings-label">Machine name</label>
            <input id="set-machine-name" type="text" placeholder="DE1" />
          </div>
          <div class="settings-group">
            <label class="settings-label">Minimum shot length (s)</label>
            <input id="set-min-seconds" type="number" min="0" />
          </div>
          <div class="settings-group">
            <label class="settings-label">Last upload</label>
            <div id="last-upload" class="log-info">—</div>
          </div>
        </div>
      </div>
      <div class="chart-section">
        <div class="chart-header">
          <button id="prev-shot" class="btn-secondary">◀ Prev</button>
          <div class="chart-title">
            <div id="shot-title">Loading…</div>
            <div id="shot-meta" class="log-info"></div>
          </div>
          <button id="next-shot" class="btn-secondary">Next ▶</button>
        </div>
        <canvas id="chart" height="300"></canvas>
      </div>
      <div class="controls">
        <button id="print-current" class="btn-primary">Print current shot</button>
        <button id="manual-upload" class="btn-secondary">Upload last shot</button>
        <button id="save-settings" class="btn-secondary">Save settings</button>
        <button id="clear-logs" class="btn-secondary">Clear log</button>
      </div>
      <div class="log-container" id="log-container"></div>
      <div class="footer">
        <span>plugin v<span id="plugin-version"></span></span>
        <span id="conn-state"></span>
      </div>
    \`;
  }

  cacheEls() {
    this.$ = (id) => this.querySelector(id);
    this.statusText = this.$("#status-text");
    this.connState = this.$("#conn-state");
    this.pluginVersion = this.$("#plugin-version");
    this.lastUploadEl = this.$("#last-upload");
    this.logContainer = this.$("#log-container");
    this.pluginVersion.textContent = this.version;
  }

  bindEvents() {
    this.$("#manual-upload").addEventListener("click", () => this.manualUpload());
    this.$("#print-current").addEventListener("click", () => this.printCurrent());
    this.$("#prev-shot").addEventListener("click", () => this.stepShot(-1));
    this.$("#next-shot").addEventListener("click", () => this.stepShot(1));
    this.$("#save-settings").addEventListener("click", () => this.saveSettings());
    this.$("#clear-logs").addEventListener("click", () => {
      this.logs = [];
      this.logContainer.innerHTML = "";
    });
  }

  // ---------- Shot browser ----------

  async loadLatest() {
    this.offset = 0;
    try {
      const res = await fetch("/api/v1/shots?limit=1");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const items = data.items || [];
      if (items.length === 0) {
        this.setShotMeta(null, "No shots yet");
        return;
      }
      this.currentShot = items[0];
      this.showShotMeta(this.currentShot);
      const full = await this.fetchShotWithRetry(this.currentShot.id);
      if (full) this.renderCurve(window.toTclFormat(full));
    } catch (e) {
      this.log("Failed to load latest shot: " + e.message, "warn");
    }
  }

  async stepShot(dir) {
    const target = Math.max(0, this.offset + dir);
    try {
      const res = await fetch("/api/v1/shots?limit=1&offset=" + target);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const items = data.items || [];
      if (items.length === 0) {
        this.log(dir > 0 ? "No older shots" : "Already at the latest shot", "info");
        return;
      }
      this.offset = target;
      this.currentShot = items[0];
      this.showShotMeta(this.currentShot);
      const full = await this.fetchShotWithRetry(this.currentShot.id);
      if (full) this.renderCurve(window.toTclFormat(full));
    } catch (e) {
      this.log("Failed to load shot: " + e.message, "warn");
    }
  }

  showShotMeta(shot) {
    if (!shot) return;
    const when = new Date(shot.timestamp).toLocaleString();
    const wf = shot.workflow || {};
    const title = (wf.profile && wf.profile.title) || "—";
    this.$("#shot-title").textContent = title + "  ·  " + when;
    const ann = shot.annotations || {};
    const dose = ann.actualDoseWeight != null ? ann.actualDoseWeight : "?";
    const yield_ = ann.actualYield != null ? ann.actualYield : "?";
    const ctx = (shot.workflow && shot.workflow.context) || {};
    const bean = ctx.coffeeName || "";
    this.$("#shot-meta").textContent =
      "in " + dose + "g · out " + yield_ + "g" + (bean ? " · " + bean : "");
  }

  setShotMeta(_, text) {
    this.$("#shot-title").textContent = text;
    this.$("#shot-meta").textContent = "";
  }

  renderCurve(tcl) {
    const canvas = this.$("#chart");
    const ctx = canvas.getContext("2d");
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Single shared 0-10 axis: pressure/water flow/coffee flow plot directly;
    // temperature (0-100 °C) is scaled into 0-10.
    const series = [
      { label: "Pressure (bar)", color: "#00b672", data: tcl.pressure.pressure },
      { label: "Water flow (g/s)", color: "#6c9bff", data: tcl.flow.flow },
      { label: "Coffee flow (g/s)", color: "#a2693d", data: tcl.flow.by_weight },
      { label: "Temp °C (÷10)", color: "#ff7880", data: (tcl.temperature.basket || []).map((v) => parseFloat(v) / 10) },
    ];
    const x = (tcl.elapsed || []).map(Number);
    if (x.length === 0) return;

    const pad = { l: 44, r: 10, t: 34, b: 22 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const xMax = Math.max.apply(null, x) || 1;
    const yMax = 10;

    // grid lines + y ticks at 0,2,4,6,8,10
    ctx.strokeStyle = "#2a3a5e";
    ctx.lineWidth = 1;
    for (let tick = 0; tick <= yMax; tick += 2) {
      const py = pad.t + plotH - (tick / yMax) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.l, py);
      ctx.lineTo(W - pad.r, py);
      ctx.stroke();
      ctx.fillStyle = "#8a9aba";
      ctx.font = "9px sans-serif";
      ctx.fillText(String(tick), 2, py + 3);
    }

    // legend
    ctx.font = "10px sans-serif";
    let lx = pad.l;
    for (const ser of series) {
      ctx.fillStyle = ser.color;
      ctx.fillRect(lx, pad.t - 22, 10, 10);
      ctx.fillText(ser.label, lx + 14, pad.t - 13);
      lx += 14 + ctx.measureText(ser.label).width + 16;
    }

    // lines
    for (const ser of series) {
      ctx.beginPath();
      for (let i = 0; i < x.length; i++) {
        const px = pad.l + (x[i] / xMax) * plotW;
        const v = parseFloat(ser.data[i]) || 0;
        const py = pad.t + plotH - (v / yMax) * plotH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = ser.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // x axis labels
    ctx.fillStyle = "#8a9aba";
    ctx.font = "10px sans-serif";
    ctx.fillText("0", pad.l, H - 6);
    ctx.fillText(xMax.toFixed(1) + " s", W - 34, H - 6);
  }

  async printCurrent() {
    if (!this.currentShot) {
      this.log("No shot selected — load one first", "warn");
      return;
    }
    if (!this.settings.ServerUrl) {
      this.log("No server configured — set Server address and save", "warn");
      return;
    }
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const full = await this.fetchShotWithRetry(this.currentShot.id);
      if (!full) {
        this.log("Shot fetch failed", "error");
        return;
      }
      if (!this.passesFilters(full)) return;
      const tcl = window.toTclFormat(full);
      const url = this.buildTargetUrl();
      this.log("Printing shot " + this.currentShot.id.slice(0, 8) + " → " + url, "info");
      const result = await this.uploadWithRetry(url, tcl);
      this.lastUploadEl.textContent = result.ok ? "OK" : "FAILED";
      this.log("Print " + (result.ok ? "OK" : "FAILED"), result.ok ? "success" : "error");
    } finally {
      this.isProcessing = false;
    }
  }

  // ---------- Settings ----------

  async loadSettings() {
    try {
      const res = await fetch(SETTINGS_URL);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    } catch (e) {
      this.log("Failed to load settings: " + e.message, "warn");
    }
  }

  async saveSettings() {
    const next = {
      AutoUpload: this.$("#set-auto-upload").checked,
      ServerUrl: this.$("#set-server-url").value.trim(),
      ServerEndpoint: this.$("#set-server-endpoint").value.trim() || "upload",
      UseHttp: this.$("#set-use-http").checked,
      MachineName: this.$("#set-machine-name").value.trim(),
      MinSeconds: parseInt(this.$("#set-min-seconds").value, 10) || 0,
    };
    try {
      const res = await fetch(SETTINGS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      this.settings = next;
      this.log("Settings saved", "success");
    } catch (e) {
      this.log("Failed to save settings: " + e.message, "error");
    }
  }

  updateUI() {
    this.$("#set-auto-upload").checked = !!this.settings.AutoUpload;
    this.$("#set-server-url").value = this.settings.ServerUrl || "";
    this.$("#set-server-endpoint").value = this.settings.ServerEndpoint || "";
    this.$("#set-use-http").checked = !!this.settings.UseHttp;
    this.$("#set-machine-name").value = this.settings.MachineName || "";
    this.$("#set-min-seconds").value = this.settings.MinSeconds || 0;
  }

  // ---------- WebSocket ----------

  connectSocket() {
    try {
      this.socket = new WebSocket(WS_URL);
    } catch (e) {
      this.setStatus("offline", "Socket failed");
      this.scheduleReconnect();
      return;
    }
    this.socket.onopen = () => {
      this.setStatus("live", "Live");
      this.log("Connected to shot events", "info");
    };
    this.socket.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg && typeof msg.id === "string") {
          this.log("Shot stored: " + msg.id.slice(0, 8), "info");
          this.processShot(msg.id);
        }
      } catch (e) {
        this.log("Bad event payload", "warn");
      }
    };
    this.socket.onclose = () => {
      this.setStatus("offline", "Reconnecting…");
      this.scheduleReconnect();
    };
    this.socket.onerror = () => {
      this.setStatus("offline", "Connection error");
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSocket();
    }, 5000);
  }

  setStatus(state, text) {
    this.statusText.textContent = text;
    const dot = this.statusText.parentElement.querySelector(".status-dot");
    if (dot) dot.style.color = state === "live" ? "#4ade80" : "#f87171";
    if (this.connState) this.connState.textContent = state;
  }

  // ---------- Shot pipeline ----------

  async processShot(shotId) {
    if (this.isProcessing) {
      this.log("Already processing, skipping " + shotId.slice(0, 8), "warn");
      return;
    }
    this.isProcessing = true;
    try {
      if (!this.settings.AutoUpload) {
        this.log("Auto-upload disabled, skipping", "info");
        return;
      }
      if (!this.settings.ServerUrl) {
        this.log("No server configured — set Server address and save", "warn");
        return;
      }
      const shot = await this.fetchShotWithRetry(shotId);
      if (!shot) {
        this.log("Shot fetch failed: " + shotId, "error");
        return;
      }
      if (!this.passesFilters(shot)) return;

      const tcl = window.toTclFormat(shot);
      const url = this.buildTargetUrl();
      this.log("Uploading " + tcl.elapsed.length + " pts to " + url, "info");
      const result = await this.uploadWithRetry(url, tcl);
      this.lastUpload = {
        at: new Date().toISOString(),
        id: shotId,
        ok: result.ok,
        attempts: result.attempts,
      };
      localStorage.setItem(
        "print_the_shot_last_upload",
        JSON.stringify(this.lastUpload)
      );
      this.lastUploadEl.textContent =
        (result.ok ? "OK" : "FAILED") +
        " — " +
        shotId.slice(0, 8) +
        " (" +
        result.attempts +
        " attempt" +
        (result.attempts > 1 ? "s" : "") +
        ")";
      this.log(
        "Upload " + (result.ok ? "OK" : "FAILED") + " after " + result.attempts + " attempts",
        result.ok ? "success" : "error"
      );
    } finally {
      this.isProcessing = false;
    }
  }

  async fetchShotWithRetry(shotId) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch("/api/v1/shots/" + shotId);
        if (res.ok) return await res.json();
      } catch (e) {
        /* retry */
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  }

  passesFilters(shot) {
    const beverage = (shot.workflow && shot.workflow.profile &&
      shot.workflow.profile.beverage_type) || "espresso";
    if (beverage === "cleaning" || beverage === "calibrate") {
      this.log("Skipping " + beverage + " shot", "info");
      return false;
    }
    const ms = shot.measurements || [];
    let duration = 0;
    if (ms.length >= 2) {
      const first = ms[0].machine && ms[0].machine.timestamp;
      const last = ms[ms.length - 1].machine && ms[ms.length - 1].machine.timestamp;
      duration = first && last
        ? Math.round((new Date(last).getTime() - new Date(first).getTime()) / 1000)
        : Math.round(ms.length * 0.24);
    }
    if (duration < this.settings.MinSeconds) {
      this.log("Shot too short (" + duration + "s < " + this.settings.MinSeconds + "s), skipping", "info");
      return false;
    }
    return true;
  }

  buildTargetUrl() {
    const machineId = PrintTheShot.generateMachineId(this.settings.MachineName);
    const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
    const protocol = this.settings.UseHttp ? "http" : "https";
    const server = String(this.settings.ServerUrl).replace(/^https?:[/][/]/, "");
    return (
      protocol +
      "://" +
      server +
      "/" +
      this.settings.ServerEndpoint +
      "?machine_id=" +
      machineId +
      "&timestamp=" +
      ts +
      "&plugin_version=" +
      this.version
    );
  }

  async uploadWithRetry(url, shot) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(UPLOAD_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url, shot: shot }),
        });
        const data = await res.json();
        if (data && data.success) {
          return { ok: true, attempts: attempt };
        }
        this.log(
          "Attempt " + attempt + " failed: " + (data && data.message || "HTTP " + res.status),
          "warn"
        );
      } catch (e) {
        this.log("Attempt " + attempt + " error: " + e.message, "warn");
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
    }
    return { ok: false, attempts: 3 };
  }

  async manualUpload() {
    if (this.isProcessing) return;
    try {
      const res = await fetch("/api/v1/shots/latest");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const shot = await res.json();
      if (!shot || !shot.id) {
        this.log("No shot found", "warn");
        return;
      }
      this.log("Manual upload of " + shot.id.slice(0, 8), "info");
      this.isProcessing = true;
      try {
        if (!this.passesFilters(shot)) return;
        const tcl = window.toTclFormat(shot);
        const url = this.buildTargetUrl();
        const result = await this.uploadWithRetry(url, tcl);
        this.lastUploadEl.textContent = result.ok ? "OK" : "FAILED";
        this.log("Manual upload " + (result.ok ? "OK" : "FAILED"), result.ok ? "success" : "error");
      } finally {
        this.isProcessing = false;
      }
    } catch (e) {
      this.log("Manual upload error: " + e.message, "error");
    }
  }

  // ---------- Log ----------

  log(msg, level) {
    const entry = document.createElement("div");
    entry.className = "log-entry log-" + (level || "info");
    const time = new Date().toISOString().slice(11, 19);
    entry.textContent = time + "  " + msg;
    this.logContainer.appendChild(entry);
    this.logContainer.scrollTop = this.logContainer.scrollHeight;
    this.logs.push({ t: time, msg: msg, level: level || "info" });
    if (this.logs.length > 200) this.logs.shift();
  }

  static generateMachineId(name) {
    if (!name) return "UNKNOWN";
    const clean = String(name).replace(/[^A-Za-z0-9]/g, "");
    if (!clean) return "UNKNOWN";
    return clean.length > 20 ? clean.substring(0, 20) : clean;
  }
}

customElements.define("print-the-shot", PrintTheShot);
`;
