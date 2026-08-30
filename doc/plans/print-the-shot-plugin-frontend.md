# Print The Shot plugin — frontend-driven rebuild

## Why

June 2026 fork work (commits f4db068a, fc73b233) shipped a "print the shot"
plugin whose shot transform + upload logic ran in the backend
(`flutter_js`/plugin.js). Rebuilding on current upstream main moves the
processing into a browser page served by the plugin, leaving the backend thin.
Backed up on the fork as `backup/print-the-shot-old` before resetting the fork
`main`.

## Architecture decision

- Trigger: upstream `shotStored` event (`{id}`, permission `events.shots`,
  emitted from `lib/main.dart` on persistence). No `plugin_manager.dart`
  changes — the old `shotsChangedStream`/`shotCompleted` hacks are gone.
- Frontend: page at `/api/v1/plugins/print-the-shot.reaplugin/ui` subscribes to
  `/ws/v1/plugins/print-the-shot.reaplugin/events`; plugin `onEvent` forwards
  ids via `host.emit`. Page fetches the full shot, filters beverage/duration,
  transforms to TCL, and uploads through the plugin `upload` proxy (single
  `fetch` per attempt, Dart HttpClient = no CORS). Page owns the 3-attempt
  retry loop so the log viewer/status UI see every attempt.
- Settings: manifest `settings` → app-side plugin settings store
  (`GET/POST /api/v1/plugins/<id>/settings`), editable from the app's Plugins
  screen; page mirrors manifest defaults. One transform only
  (`src/api/transform.ts`, inlined into the page via `toString()`).
- Upload format: TCL simple variant, verified field-by-field against the
  target server (`DecentEspressoPrintTheShot-beta/print_the_shot_server.py`:
  `elapsed`, `pressure.pressure`, `flow.flow`/`by_weight`,
  `temperature.basket`, `meta.bean.*`, `profile.title`, `clock`,
  `machine_id` query param).

## Old bugs avoided

- No-op `log()` stub → working `host.log`.
- Three divergent transforms → one module + vitest contract tests.
- DOM `shot-completed` event never dispatched → WebSocket push.
- Dead `/api/v1/current-profile` beverage check → shot's own
  `workflow.profile.beverage_type`.
- Double-upload dual paths → single page-driven path.
- Manual upload hardcoded 6 s → settings `minSeconds`.
- Invalid `http` manifest permission → current wire permissions.
- `meta.bean.type` always empty → mapped from
  `workflow.context.coffeeName`/extras.

## Tradeoff

Auto-upload happens only while the page is open (pinned WebView or desktop
browser). `shotStored` already reaches the plugin JS, so a backend auto-upload
path can be added later without restructuring.
