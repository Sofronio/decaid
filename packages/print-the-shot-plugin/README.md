# Print The Shot Plugin

A first-party plugin for [Decent.app](../../README.md) that uploads shot data to an external server — useful for printing shot labels, logging to a local database, or integrating with shop management systems.

## Goal

After each espresso shot completes, the plugin fetches the shot data from the Decent.app REST API and POSTs it to a configurable external HTTP endpoint. It filters out cleaning/calibrate profiles and shots shorter than a configurable minimum duration.

## Architecture

Print The Shot runs across two JavaScript runtimes:

1. **flutter_js** (server-side) — executes `plugin.js`, handles the plugin lifecycle, and routes HTTP requests to the settings page generator.
2. **Browser** (client-side) — renders the settings page with the `<print-the-shot>` Web Component. The component listens for `shot-completed` CustomEvents and calls the core Decent.app REST API directly via `fetch()`.

```
Browser                          Decent.app            flutter_js
──────                          ─────────────────                ──────────
  │ GET /api/v1/plugins/                │                            │
  │   print-the-shot.reaplugin/settings │                            │
  │────────────────────────────────────>│  route to plugin           │
  │                                     │───────────────────────────>│
  │                                     │    __httpRequestHandler()  │
  │                                     │<───────────────────────────│
  │              HTML with              │    returns HTML string     │
  │         Web Component               │                            │
  │<────────────────────────────────────│                            │
  │                                     │                            │
  │ [shot-completed event]              │                            │
  │ fetch /api/v1/shots/:id             │                            │
  │────────────────────────────────────>│ core REST API (direct)     │
  │              JSON                   │                            │
  │<────────────────────────────────────│                            │
  │                                     │                            │
  │ POST external-server/upload         │                            │
  │────────────────────────────────────>│ external server            │
```

## Project Structure

```
packages/print-the-shot-plugin/
├── manifest.json             # Plugin metadata, permissions, HTTP endpoint declarations
├── package.json              # @streamline/print-the-shot-plugin, Vite + TypeScript
├── vite.config.ts            # Library mode build → single IIFE bundle
├── tsconfig.json
├── dev-server.mjs            # Local dev server for UI iteration
└── src/
    ├── plugin.ts             # Entry point: createPlugin(host), HTTP router
    ├── host.d.ts             # TypeScript declarations for the flutter_js host API
    ├── api/
    │   └── client.ts         # Browser-side REST client (inlined into HTML pages)
    ├── components/
    │   └── print-the-shot.ts # <print-the-shot> Web Component (settings UI + upload logic)
    ├── pages/
    │   ├── layout.ts         # Shared page shell, CSS, HTML wrapper
    │   └── settings.ts       # Settings page generator
    └── utils/
        └── html.ts           # Tagged template literal helper, HTML escaping
```

**Build output** (gitignored, generated into the Flutter assets directory):
```
assets/plugins/print-the-shot.reaplugin/
├── manifest.json
└── plugin.js
```

## Build

Requires Node.js 20+.

```bash
cd packages/print-the-shot-plugin
npm install
npm run build        # Production build → assets/plugins/print-the-shot.reaplugin/
npm run dev          # Watch mode — rebuilds on source changes
```

## Local Development

The dev server loads the built `plugin.js` in a Node.js VM, serves the settings page directly in the browser, and proxies REST API calls to a running Decent.app instance.

### Quick start

```bash
# Terminal 1 — watch-build the plugin
npm run dev

# Terminal 2 — start the dev server
npm run serve
```

Then open `http://localhost:4445` in a browser.

### Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT` | `4445` | Dev server port |
| `BRIDGE_URL` | `http://localhost:8080` | Decent.app URL to proxy API calls to |

```bash
PORT=5000 BRIDGE_URL=http://192.168.1.5:8080 npm run serve
```

## HTTP Endpoints

| Endpoint | URL | Purpose |
|----------|-----|---------|
| `ui` | `/api/v1/plugins/print-the-shot.reaplugin/ui` | Settings and log viewer |

## Settings

All settings are persisted in the browser's `localStorage` under the key `print_the_shot_settings`:

| Setting | Default | Description |
|---------|---------|-------------|
| `autoUpload` | `true` | Automatically upload after each shot |
| `serverUrl` | `yourserverip:8000` | External server host:port |
| `serverEndpoint` | `upload` | Upload endpoint path |
| `useHttp` | `true` | Use HTTP (uncheck for HTTPS) |
| `machineName` | `""` | Machine identifier (used in upload URL) |
| `minSeconds` | `6` | Minimum shot duration to trigger upload |

## Core REST API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/shots?limit=1` | Get latest shot (manual upload) |
| GET | `/api/v1/shots/:id` | Get specific shot data |
| GET | `/api/v1/current-profile` | Check beverage type (skip cleaning/calibrate) |
