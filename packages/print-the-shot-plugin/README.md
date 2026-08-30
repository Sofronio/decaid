# Print The Shot plugin

Transforms finished espresso shots into the TCL print format and uploads them
to a local print server (e.g. a Raspberry Pi running the
[DecentEspressoPrintTheShot](https://github.com/Sofronio/DecentEspressoPrintTheShot-beta)
server). A thermal printer prints the shot curve as a receipt.

## Architecture: frontend-driven

The plugin runs in the app's `flutter_js` runtime but stays intentionally
thin. All shot processing happens in a browser page served by the plugin:

```
shot completes
  → app broadcasts shotStored {id} (already upstream, no app change)
  → plugin onEvent → host.emit("events", {id})
  → page (WebSocket /ws/v1/plugins/print-the-shot.reaplugin/events) receives id
  → page GET /api/v1/shots/<id>
  → page transforms to TCL format (toTclFormat)
  → page POSTs {url, shot} to the plugin "upload" endpoint (avoids CORS)
  → plugin does one fetch() to the print server (Dart HttpClient)
  → retries orchestrated by the page (3 attempts, 2 s backoff)
```

The page must stay open (pinned in the app WebView or a desktop browser) for
auto-upload; it also offers manual upload and a live log viewer.

Settings live in the app-side plugin settings store and are editable from the
app's Plugins screen; the page reads and writes them over
`GET/POST /api/v1/plugins/print-the-shot.reaplugin/settings`.

## Build

```bash
npm install
npm run build   # writes assets/plugins/print-the-shot.reaplugin/{plugin.js, manifest.json}
npm test        # vitest transform tests
npm run serve   # dev harness on :4445 with /api proxy to the running app
```
