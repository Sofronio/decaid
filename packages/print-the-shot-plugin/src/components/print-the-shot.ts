/**
 * <print-the-shot> Web Component
 *
 * Listens for shot-completed events, uploads shot data to a configurable
 * external server. Provides a settings UI and log viewer.
 * Runs in the BROWSER (not flutter_js).
 */

export const printTheShotComponent = `
class PrintTheShot extends HTMLElement {
  #settings = null;
  #isProcessing = false;
  #pluginVersion = '1.2.0';
  #logContainer = null;
  #statusDisplay = null;

  // ---------- HTML escaping ----------

  _esc(val) {
    if (val == null) return '';
    return String(val).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ---------- Lifecycle ----------

  connectedCallback() {
    this.#settings = PrintTheShot.loadSettings();
    this.render();
    this.#logContainer = this.querySelector('#log-container');
    this.#statusDisplay = this.querySelector('#status-display');
    this.updateUI();
    this._bindEvents();

    this.log('Plugin initialized', 'info');
    this.log('Server: ' + this.#settings.serverUrl + '/' + this.#settings.serverEndpoint, 'info');
    this.log('Auto-upload: ' + (this.#settings.autoUpload ? 'ON' : 'OFF'), 'info');
    this.log('Min duration: ' + this.#settings.minSeconds + 's', 'info');
    // Sync settings to plugin for auto-upload
    this._syncSettingsToPlugin();
  }

  _bindEvents() {
    // Listen for shot completion dispatched by the Decent app framework
    document.addEventListener('shot-completed', (event) => {
      this.log('Shot completion detected', 'info');
      this.handleShotComplete(event.detail);
    });

    // Manual upload button
    this.querySelector('#manual-upload')?.addEventListener('click', () => {
      this.manualUpload();
    });

    // Save settings
    this.querySelector('#save-settings')?.addEventListener('click', () => {
      this.saveSettingsFromUI();
    });

    // Auto-save on change
    this.querySelectorAll('[data-setting]').forEach((el) => {
      el.addEventListener('change', () => {
        this.saveSettingsFromUI();
      });
    });

    // Clear logs
    this.querySelector('#clear-logs')?.addEventListener('click', () => {
      if (this.#logContainer) {
        this.#logContainer.innerHTML = '';
        this.log('Logs cleared', 'info');
      }
    });
  }

  // ---------- Settings persistence (localStorage) ----------

  static getDefaultSettings() {
    return {
      autoUpload: true,
      serverUrl: 'yourserverip:8000',
      serverEndpoint: 'upload',
      useHttp: true,
      machineName: '',
      minSeconds: 6,
      lastUploadShot: null,
      lastUploadResult: null,
      lastUploadId: null,
      lastAction: null
    };
  }

  static get STORAGE_KEY() {
    return 'print_the_shot_settings';
  }

  static loadSettings() {
    try {
      const stored = localStorage.getItem(PrintTheShot.STORAGE_KEY);
      if (stored) {
        return { ...PrintTheShot.getDefaultSettings(), ...JSON.parse(stored) };
      }
    } catch (err) {
      console.warn('[PrintTheShot] Failed to load settings:', err);
    }
    return PrintTheShot.getDefaultSettings();
  }

  static saveSettings(settings) {
    try {
      localStorage.setItem(PrintTheShot.STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('[PrintTheShot] Failed to save settings:', err);
    }
  }

  saveSettingsFromUI() {
    const getValue = (id) => {
      const el = this.querySelector('#' + id);
      return el ? el.value : '';
    };
    const getChecked = (id) => {
      const el = this.querySelector('#' + id);
      return el ? el.checked : false;
    };

    this.#settings.serverUrl = getValue('server-url') || this.#settings.serverUrl;
    this.#settings.serverEndpoint = getValue('server-endpoint') || this.#settings.serverEndpoint;
    this.#settings.useHttp = getChecked('use-http');
    this.#settings.autoUpload = getChecked('auto-upload');
    this.#settings.machineName = getValue('machine-name') || this.#settings.machineName;
    this.#settings.minSeconds = Number(getValue('min-seconds')) || this.#settings.minSeconds;

    PrintTheShot.saveSettings(this.#settings);
    this.log('Settings saved', 'info');
    // Sync settings to plugin for auto-upload
    this._syncSettingsToPlugin();
    this.updateUI();
  }

  async _syncSettingsToPlugin() {
    try {
      await fetch('/api/v1/plugins/print-the-shot.reaplugin/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.#settings)
      });
    } catch (e) {
      // Non-critical — plugin auto-upload just won't have latest settings
    }
  }

  // ---------- Shot handling ----------

  async handleShotComplete(shotEvent) {
    if (!this.#settings.autoUpload) {
      this.log('Auto-upload is disabled, skipping', 'warn');
      this.updateStatus('Auto-upload disabled');
      return;
    }

    if (this.#isProcessing) {
      this.log('Already processing, skipping', 'warn');
      return;
    }

    const shotId = shotEvent?.shotId || shotEvent?.id;
    if (!shotId) {
      this.log('Shot event missing ID', 'warn');
      return;
    }

    this.#isProcessing = true;
    this.updateStatus('Processing...');

    try {
      // Get full shot for duration/beverage checks
      const fullShot = await DecentApi.getShot(shotId);
      if (!fullShot) {
        this.log('Failed to fetch shot data', 'error');
        this.updateStatus('Failed to fetch shot data');
        this.#isProcessing = false;
        return;
      }

      this.log('Shot data fetched: ID=' + shotId + ', measurements=' + (fullShot.measurements?.length || 0), 'info');

      // Convert to TCL ::shot::create format (parallel arrays)
      var shotData = DecentApi.toTclFormat(fullShot);

      // Skip cleaning / calibrate profiles
      const beverageType = await DecentApi.getBeverageType();
      if (beverageType === 'cleaning' || beverageType === 'calibrate') {
        this.log("Not uploaded: Profile was '" + beverageType + "'", 'warn');
        this.updateStatus('Not uploaded: ' + beverageType + ' profile');
        this.#settings.lastUploadResult = "Not uploaded: Profile was '" + beverageType + "'";
        PrintTheShot.saveSettings(this.#settings);
        this.#isProcessing = false;
        return;
      }

      // Check minimum duration
      const duration = await DecentApi.getShotDuration(shotId);
      if (duration < this.#settings.minSeconds) {
        this.log('Not uploaded: shot duration ' + duration + 's < ' + this.#settings.minSeconds + 's minimum', 'warn');
        this.updateStatus('Not uploaded: too short (' + duration + 's)');
        this.#settings.lastUploadResult = 'Not uploaded: shot duration was less than ' + this.#settings.minSeconds + ' seconds';
        PrintTheShot.saveSettings(this.#settings);
        this.#isProcessing = false;
        return;
      }

      // Upload to external server
      this.log('Uploading shot ' + shotId + '...', 'info');
      this.updateStatus('Uploading...');

      // Use REST API ISO timestamp for display (TCL timestamp is Unix seconds)
      const timestamp = fullShot.timestamp || Date.now();
      const result = await PrintTheShot.uploadToServer(shotData, this.#settings, this.#pluginVersion);

      this.#settings.lastUploadShot = String(timestamp);
      this.#settings.lastUploadResult = result.message;
      this.#settings.lastAction = 'upload';
      PrintTheShot.saveSettings(this.#settings);

      if (result.success) {
        this.log('Upload successful: ' + result.message, 'success');
        this.updateStatus('✅ Upload successful');
      } else {
        this.log('Upload failed: ' + result.message, 'error');
        this.updateStatus('❌ Upload failed');
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.log('Error processing shot: ' + errorMsg, 'error');
      this.updateStatus('Error: ' + errorMsg);
      this.#settings.lastUploadResult = 'Error: ' + errorMsg;
      PrintTheShot.saveSettings(this.#settings);
    }

    this.#isProcessing = false;
    this.updateUI();
  }

  async manualUpload() {
    if (this.#isProcessing) {
      this.log('Already processing, please wait', 'warn');
      return;
    }

    this.log('Manual upload initiated', 'info');
    this.updateStatus('Manual upload...');

    try {
      const shot = await DecentApi.getLatestShot();
      if (!shot) {
        this.log('No shot data available', 'warn');
        this.updateStatus('No shot data available');
        return;
      }

      if (shot.duration < 6) {
        this.log('Shot data too short: ' + shot.duration + 's', 'warn');
        this.updateStatus('Shot too short (' + shot.duration + 's)');
        return;
      }

      await this.handleShotComplete({ shotId: shot.id, ...shot });

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.log('Manual upload error: ' + errorMsg, 'error');
      this.updateStatus('Error: ' + errorMsg);
    }
  }

  // ---------- External server upload ----------

  static async uploadToServer(shotData, settings, pluginVersion) {
    const machineId = PrintTheShot.generateMachineId(settings.machineName);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);

    const protocol = settings.useHttp ? 'http' : 'https';
    const targetUrl = protocol + '://' + settings.serverUrl + '/' + settings.serverEndpoint +
      '?machine_id=' + machineId + '&timestamp=' + timestamp + '&plugin_version=' + pluginVersion;

    console.log('[PrintTheShot] Upload URL:', targetUrl);

    // Route through the plugin's proxy endpoint (Dart HttpClient, no CORS).
    // The plugin sends the raw shot data as the body, matching the TCL plugin format.
    try {
      const response = await fetch('/api/v1/plugins/print-the-shot.reaplugin/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, shot: shotData })
      });

      const result = await response.json();

      if (result.success) {
        console.log('[PrintTheShot] Upload successful');
        return {
          success: true,
          message: 'Upload successful (ID: ' + machineId + ')',
          statusCode: result.statusCode,
          data: result.data
        };
      } else {
        return {
          success: false,
          message: result.message || 'Upload failed'
        };
      }
    } catch (err) {
      console.error('[PrintTheShot] Upload proxy error:', err);
      return {
        success: false,
        message: 'Upload proxy error: ' + (err instanceof Error ? err.message : 'Unknown error')
      };
    }
  }

  static generateMachineId(machineName) {
    if (!machineName) return 'UNKNOWN';
    let clean = machineName.replace(/[^a-zA-Z0-9]/g, '');
    if (!clean) return 'UNKNOWN';
    if (clean.length > 20) clean = clean.substring(0, 20);
    return clean;
  }

  // ---------- UI helpers ----------

  updateUI() {
    if (this.#statusDisplay) {
      this.#statusDisplay.textContent = this.#settings.lastUploadResult || 'Ready';
    }
    const timeEl = this.querySelector('#last-upload-time');
    if (timeEl) {
      const ts = this.#settings.lastUploadShot;
      timeEl.textContent = ts ? PrintTheShot.formatTimestamp(Number(ts)) : 'No shot recorded';
    }
    const machineEl = this.querySelector('#current-machine-display');
    if (machineEl) {
      machineEl.textContent = this.#settings.machineName || 'UNKNOWN';
    }
    const resultEl = this.querySelector('#last-result-display');
    if (resultEl) {
      resultEl.textContent = this.#settings.lastUploadResult || '';
    }
  }

  updateStatus(message) {
    if (this.#statusDisplay) {
      this.#statusDisplay.textContent = message;
    }
  }

  log(message, level) {
    level = level || 'info';
    if (!this.#logContainer) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry log-' + level;
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = '[' + timestamp + '] ' + message;
    this.#logContainer.appendChild(entry);
    this.#logContainer.scrollTop = this.#logContainer.scrollHeight;

    const consoleMethod = level === 'error' ? 'error' :
                          level === 'warn' ? 'warn' : 'log';
    console[consoleMethod]('[PrintTheShot] ' + message);
  }

  static formatTimestamp(timestamp) {
    if (!timestamp) return 'No shot recorded';
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return 'Shot started today at ' + date.toLocaleTimeString();
    }
    return 'Shot started on ' + date.toLocaleDateString() + ' at ' + date.toLocaleTimeString();
  }

  // ---------- Render ----------

  render() {
    const s = this.#settings;
    this.innerHTML = '<div class="print-the-shot">' +
      '<div class="header">' +
        '<h3>🖨️ Print The Shot</h3>' +
        '<div class="status-badge">' +
          '<span class="status-dot">●</span>' +
          '<span class="status-text" id="status-display">' + this._esc(s.lastUploadResult || 'Ready') + '</span>' +
        '</div>' +
      '</div>' +

      '<div class="settings-grid">' +
        '<div class="settings-column">' +
          '<div class="settings-group">' +
            '<label class="settings-label">Server URL</label>' +
            '<input type="text" id="server-url" data-setting="serverUrl" value="' + this._esc(s.serverUrl) + '" placeholder="yourserverip:8000">' +
          '</div>' +
          '<div class="settings-group">' +
            '<label class="settings-label">Server Endpoint</label>' +
            '<input type="text" id="server-endpoint" data-setting="serverEndpoint" value="' + this._esc(s.serverEndpoint) + '" placeholder="upload">' +
          '</div>' +
          '<div class="settings-group row">' +
            '<label><input type="checkbox" id="use-http" data-setting="useHttp"' + (s.useHttp ? ' checked' : '') + '> Use HTTP (uncheck for HTTPS)</label>' +
          '</div>' +
          '<div class="settings-group row">' +
            '<label><input type="checkbox" id="auto-upload" data-setting="autoUpload"' + (s.autoUpload ? ' checked' : '') + '> Auto-Upload</label>' +
          '</div>' +
          '<div class="settings-group row">' +
            '<label for="min-seconds">Min duration (seconds):</label>' +
            '<input type="number" id="min-seconds" data-setting="minSeconds" value="' + s.minSeconds + '" min="1" max="60" style="width:60px;">' +
          '</div>' +
        '</div>' +

        '<div class="settings-column">' +
          '<div class="settings-group">' +
            '<label class="settings-label">Machine Name</label>' +
            '<input type="text" id="machine-name" data-setting="machineName" value="' + this._esc(s.machineName) + '" placeholder="DE1-XXXX">' +
          '</div>' +
          '<div class="settings-group">' +
            '<label class="settings-label">Current Machine</label>' +
            '<div id="current-machine-display" style="color:#4e85f4;font-weight:bold;">' + this._esc(s.machineName || 'UNKNOWN') + '</div>' +
          '</div>' +
          '<div class="settings-group">' +
            '<label class="settings-label">Last upload</label>' +
            '<div id="last-upload-time" style="color:#4e85f4;">' + (s.lastUploadShot ? PrintTheShot.formatTimestamp(Number(s.lastUploadShot)) : 'No shot recorded') + '</div>' +
          '</div>' +
          '<div class="settings-group">' +
            '<label class="settings-label">Result</label>' +
            '<div id="last-result-display" style="color:#4e85f4;">' + this._esc(s.lastUploadResult || '') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="controls">' +
        '<button id="manual-upload" class="btn-primary">📤 Manual Upload Last Shot</button>' +
        '<button id="save-settings" class="btn-secondary">💾 Save Settings</button>' +
        '<button id="clear-logs" class="btn-secondary">🗑️ Clear Logs</button>' +
      '</div>' +

      '<div class="log-container" id="log-container">' +
        '<div class="log-entry log-info">[' + new Date().toLocaleTimeString() + '] Plugin ready</div>' +
      '</div>' +

      '<div class="footer">' +
        '<span>Version: ' + this.#pluginVersion + '</span>' +
        '<span>Server: ' + this._esc(s.serverUrl) + '/' + this._esc(s.serverEndpoint) + '</span>' +
      '</div>' +
    '</div>';
  }
}

customElements.define('print-the-shot', PrintTheShot);
`;
