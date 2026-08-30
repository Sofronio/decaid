# Scenario: Print The Shot plugin (frontend-driven upload)

Verifies the frontend-driven plugin pattern end to end: the bundled
`print-the-shot.reaplugin` forwards `shotStored` ids over its `events`
WebSocket endpoint, serves the page at `/ui`, proxies one upload attempt per
call at `/upload`, and the page (browser) orchestrates filters, transform, and
retries. No app source changes are involved — everything observable is
REST/WS/HTML.

## Preconditions

Bundled plugin is copied into the app documents `plugins/` dir and auto-loaded
(bundled plugins load by default). Run with simulated devices so shots can be
pulled without hardware:

```bash
./flutter_with_commit.sh run --skip-skins -d macos --dart-define=simulate=1
```

Optional for the upload half: the user's print server
(`DecentEspressoPrintTheShot-beta`, Python `http.server`) running on a LAN
host (or localhost) at port 8000.

## Steps

1. Confirm the plugin loaded and reports its version:

```bash
curl -s http://localhost:8080/api/v1/plugins/print-the-shot.reaplugin/debug | jq .
# → {"version":"1.3.0"}
```

2. Confirm the page is served:

```bash
curl -s http://localhost:8080/api/v1/plugins/print-the-shot.reaplugin/ui | grep -o '<print-the-shot[^>]*>'
```

3. Subscribe to the events socket in a background shell:

```bash
websocat --no-async-stdio -n -U ws://localhost:8080/ws/v1/plugins/print-the-shot.reaplugin/events
```

4. Configure the target server via the settings store (same endpoint the page
   uses):

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"ServerUrl":"localhost:8000","ServerEndpoint":"upload","UseHttp":true,"MachineName":"DE1-SMOKE","AutoUpload":true,"MinSeconds":5}' \
  http://localhost:8080/api/v1/plugins/print-the-shot.reaplugin/settings
curl -s http://localhost:8080/api/v1/plugins/print-the-shot.reaplugin/settings | jq .
```

5. Pull an espresso shot in the app UI (simulated machine + scale). The events
   socket receives `{"id":"<uuid>"}`.

6. Exercise the upload proxy directly with a stored TCL-shaped payload:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:8000/upload?machine_id=SMOKE&timestamp=t&plugin_version=1.3.0","shot":'"$(cat sample_shots/prodigal_el_rafugio.json | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))')"'}' \
  http://localhost:8080/api/v1/plugins/print-the-shot.reaplugin/upload | jq -e '.success == true'
```

7. Browser end-to-end: open `http://localhost:8080/api/v1/plugins/print-the-shot.reaplugin/ui`,
   keep it open, pull another shot. The page log shows fetch → transform →
   upload attempts; the server log shows the POST and produces a chart image.
   The connection badge reads "Live"; without the plugin loaded the badge
   cycles "Reconnecting…".

8. Regression: `plugin-decent-proxy.md` and `shot-state-ws.md` scenarios
   (adjacent plugin/WS surfaces).
