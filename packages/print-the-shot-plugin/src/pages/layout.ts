import { html } from "../utils/html";

/** Shared CSS for Print The Shot pages */
export function sharedStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      padding: 16px;
    }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid #2a3a5e;
    }
    .header h3 { font-size: 18px; color: #eee; }
    .status-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      border-radius: 20px;
      background: #2a3a5e;
      font-size: 14px;
    }
    .status-dot { font-size: 10px; color: #4ade80; }

    /* ── Settings grid ── */
    .settings-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      padding: 12px 0;
    }
    .settings-column { display: flex; flex-direction: column; gap: 12px; }
    .settings-group { display: flex; flex-direction: column; gap: 4px; }
    .settings-group.row { flex-direction: row; align-items: center; gap: 10px; }
    .settings-label { font-size: 13px; color: #8a9aba; font-weight: 600; }

    .settings-group input[type="text"],
    .settings-group input[type="number"] {
      padding: 6px 10px;
      border: 1px solid #2a3a5e;
      border-radius: 6px;
      background: #0f0f1a;
      color: #eee;
      font-size: 14px;
      width: 100%;
    }
    .settings-group input[type="text"]:focus,
    .settings-group input[type="number"]:focus {
      outline: none;
      border-color: #e94560;
    }
    .settings-group input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: #e94560;
    }

    /* ── Buttons ── */
    .controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      padding: 8px 0;
    }
    .btn-primary {
      padding: 8px 20px;
      border: none;
      border-radius: 6px;
      background: #e94560;
      color: #fff;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
    }
    .btn-primary:hover { background: #c73652; }
    .btn-secondary {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      background: #2a3a5e;
      color: #eee;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
    }
    .btn-secondary:hover { background: #3a4a6e; }

    /* ── Log viewer ── */
    .log-container {
      background: #0f0f1a;
      border-radius: 8px;
      padding: 12px;
      max-height: 200px;
      overflow-y: auto;
      font-family: "Courier New", monospace;
      font-size: 12px;
      line-height: 1.6;
    }
    .log-container::-webkit-scrollbar { width: 6px; }
    .log-container::-webkit-scrollbar-track { background: #0f0f1a; }
    .log-container::-webkit-scrollbar-thumb { background: #2a3a5e; border-radius: 3px; }

    .log-entry { padding: 2px 0; border-bottom: 1px solid #1a1a2e; }
    .log-entry:last-child { border-bottom: none; }
    .log-info { color: #8a9aba; }
    .log-success { color: #4ade80; }
    .log-warn { color: #fbbf24; }
    .log-error { color: #f87171; }

    /* ── Footer ── */
    .footer {
      padding-top: 12px;
      border-top: 1px solid #2a3a5e;
      font-size: 12px;
      color: #5a6a8a;
      display: flex;
      justify-content: space-between;
    }

    /* ── Responsive ── */
    @media (max-width: 700px) {
      .settings-grid { grid-template-columns: 1fr; }
    }
  `;
}

/**
 * Wrap page content in a full HTML document with shared styles
 * and browser-side scripts.
 */
export function pageShell(
  title: string,
  content: string,
  scripts: string[] = []
): string {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Print The Shot - ${title}</title>
  <style>${sharedStyles()}</style>
</head>
<body>
  ${content}
  ${scripts.map((s) => `<script>${s}</script>`).join("\n")}
</body>
</html>`;
}
