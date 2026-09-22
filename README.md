# Excalidraw Studio

A lightweight, local-first diagramming workspace powered by
[Excalidraw](https://excalidraw.com), embedded directly in DBX. Create
diagrams, sketch architecture ideas, draw flows and wireframes without
leaving DBX — no cloud service involved.

## What's inside

- **Editor** — the official `@excalidraw/excalidraw` React component (0.18.x):
  shapes, text, arrows, images, frames, libraries, undo/redo, zoom, dark mode,
  PNG/SVG/`.excalidraw` export, all preserved as upstream ships it.
- **Documents** — home page with recent diagrams, search, rename, delete, and
  `.excalidraw` import. Document data stays standard-Excalidraw-compatible.
- **Result canvas** — a `result-view` contribution adds *Sketch on canvas* to
  the query-result toolbar. It lays the result set out as an annotatable table
  on a fresh canvas instead of trying to replace the data grid; see
  [Result canvas](#result-canvas).
- **Filesystem provider** — an `excalidraw:` scheme exposes the document store
  as browsable `.excalidraw` files, so DBX can open diagrams without going
  through the plugin UI; see [Filesystem provider](#filesystem-provider).
- **Persistence** — a Go sidecar owns durable local storage with atomic
  writes, per-document metadata sidecars, and startup reconciliation.
- **Autosave** — debounced (~1 s) with a serialized save queue; save status is
  always visible (Saved / Saving… / Unsaved / Save failed).
- **Export** — PNG / SVG / `.excalidraw`, rendered by the official Excalidraw
  APIs and streamed to the sidecar, which writes them under
  `<plugin data>/exports/`. The *Save as…* entries in the export menu hand the
  bytes to the host's own save dialog (`host.saveFile`) so you can pick the
  destination; the plugin folder remains the destination — and the fallback —
  everywhere else.
- **Preferences** — the result view's row count and the home screen's search
  term are remembered across sessions, stored by the sidecar next to the
  documents.
- **Localization** — the plugin's own copy ships in en/zh. The editor is handed
  the host locale verbatim, so Excalidraw's own translations cover the rest.

### Result canvas

> **Host requirement.** The result-view entry point needs a DBX build containing
> `4f3be8ccf fix(plugin): resolve result-view by UI contribution` (2026-09-20),
> which resolves the tab through `findUiContribution`. The contribution was
> introduced earlier by `b5072f1a3`, but the tab was resolved with
> `findWorkbench` at the time, so on any host released before that fix the
> toolbar button opens a tab that fails to load with `workbenchUnavailable` —
> the plugin UI never starts. The contribution is deliberately kept in the
> manifest ahead of that release: `engines.dbx` is **not** raised, because doing
> so would make the whole plugin uninstallable on every currently-released host,
> which is a worse trade than one inert entry point. Revisit `engines.dbx` once
> the fix has shipped.

Opened from the results toolbar of a query tab, the plugin receives a bounded
snapshot from the host:

```json
{ "connectionId": "...", "database": "...", "sql": "...",
  "result": { "columns": ["..."], "rows": [["..."]], "truncated": true } }
```

The host caps the payload at 500 rows and about 2 MiB of context, so the page
lets you choose how many rows to lay out and reports honestly what it left
off — rows dropped to fit the scene budget, columns beyond the cap, and the
host's own truncation. Cells are truncated to 60 characters and newlines are
flattened so every table row keeps a fixed height.

### Filesystem provider

| URI | Contents |
| --- | --- |
| `excalidraw:/` | `documents/`, `exports/` |
| `excalidraw:/documents/<uuid>.excalidraw` | one diagram |
| `excalidraw:/exports/<name>` | files written by the export flow (read-only) |

Because scenes are stored with image `dataURL`s stripped, reads rehydrate the
referenced assets, so a file copied out of this filesystem is a standard,
self-contained `.excalidraw` document. Writes run the same stripping in
reverse. A read that would exceed the byte budget the host asked for fails
loudly rather than handing back a truncated document. `mkdir` is not declared:
the layout is flat and offering folder creation would imply a hierarchy that
does not exist.

**Reaching it from the plugin.** The export menu can open `excalidraw:/exports/`
in DBX's own file manager (`host.openFilesystem`), and the result view can open
`excalidraw:/documents/`. That turns the export path in a toast into one click
from the file itself. Only directory URIs are sent: the host passes the URI
through as the file manager's *initial folder*, so a file URI would surface as a
failed listing rather than a rejected request.

### Host compatibility

The plugin targets `engines.dbx >= 0.5.68` and `host_api "1"`, and does not
raise either: a narrower `engines` range makes the whole plugin uninstallable on
older hosts, which is a worse trade than one feature degrading.

Capabilities are therefore probed and degraded rather than gated at install
time. Two worth knowing about:

| Surface | Older hosts |
| --- | --- |
| Result canvas (`result-view`) | Needs a DBX build with `4f3be8ccf fix(plugin): resolve result-view by UI contribution` (2026-09-20) — see [Result canvas](#result-canvas) |
| *Use the system save dialog* | Needs a build carrying `host.saveFile`; without it the export falls back to the plugin folder and the toast says so |

There is no host-side version gate to read: the `init`, `context` and `env`
frames carry no version or feature flags, and `init.capabilities` is a
three-boolean set (`downloadFile` / `planApi` / `storage`) that covers none of
the surfaces above. A capability is checked by calling it and handling the
refusal, which is why every one of these paths has a fallback rather than a
probe.

### Storage model

Scenes are persisted with embedded image `dataURL`s stripped; image binaries
live in a content-addressed asset store (`sha256`) and are rehydrated on load.
This keeps every autosave well below the 2 MiB UI→host bridge limit while
keeping exported `.excalidraw` files fully standard.

The sidecar resolves its data directory in this order:

1. `DBX_PLUGIN_DATA_DIR` (set `io.dbx.excalidraw` subdirectory under it),
2. `EXCALIDRAW_STUDIO_DATA_DIR` (used verbatim),
3. fallback `<user config dir>/dbx-plugins/io.dbx.excalidraw`
   (e.g. `%APPDATA%/dbx-plugins/...` on Windows, `~/.config/dbx-plugins/...`
   on Linux/macOS).

Layout under that directory:

```text
documents/<uuid>.excalidraw    scene JSON (image dataURLs stripped)
documents/<uuid>.meta.json     metadata sidecar
assets/<sha256>                image binaries, deduplicated
assets/<sha256>.json           asset metadata
exports/<name>                 files written by the export flow
prefs.json                     UI preferences, written atomically
```

## Develop

Requirements: Node.js 22+, Go 1.22+.

```bash
npm --prefix frontend install     # first time only
dbx-plugin dev --path . --port 5190
```

`dbx-plugin dev` builds the Go sidecar, runs the configured frontend build
(`[dev] ui_build` / `ui_watch` in `dbx-plugin.toml`), and serves the plugin at
`http://127.0.0.1:5190/`. The watch build prints `DBX_UI_BUILD_SUCCESS` after
each successful rebuild to trigger UI reload.

Useful frontend commands (run inside `frontend/`):

```bash
npm run build       # vendor fonts + vite build -> ../ui/
npm run typecheck   # tsc --noEmit
npm test            # vitest unit tests (persistence chunking, api adapter, ...)
```

`backend/go.mod` replaces the SDK with the vendored copy under
`backend/third_party/dbx-plugin-sdk`, so vet, test, build and the smoke run all
resolve it offline — no CLI install, no `go.work`, and no network. Keep the
vendored copy in step with the CLI's SDK when the CLI is upgraded; the smoke
script warns when the two have drifted. Requires Node.js 22+ and Go.

```bash
node scripts/backend-test.mjs   # go vet + unit tests for the store layer
node scripts/sidecar-smoke.mjs  # spawns the sidecar and drives stdio JSON-RPC:
                                # handshake, create/save/get, 1.2 MiB chunked
                                # asset upload + byte-exact round-trip, and the
                                # filesystem provider's list/read/write/guards
```

### Checks

```bash
node scripts/check-manifest.mjs  # contribution ids, required fields, icons that
                                 # exist, localization keys that resolve
node scripts/sync-version.mjs    # manifest.json is the source of truth; fails on
                                 # drift in backend/main.go or frontend/package.json
node scripts/sync-version.mjs --write   # rewrite the derived copies
```

All of these run in CI (`.github/workflows/ci.yml`) on every push and pull
request, together with the frontend typecheck, unit tests and build.

## Package

```bash
node scripts/package.mjs            # -> dist/io.dbx.excalidraw-<version>-<target>.dbxp
node scripts/package.mjs --skip-ui  # backend-only change: reuse the ui/ on disk
```

The wrapper runs the version and manifest gates, rebuilds the frontend into
`ui/`, and then calls the packager. Those are the two steps it replaces — the
packager stages directories and never builds the UI itself, which makes running
them by hand the easy way to ship a stale `ui/`:

```bash
npm --prefix frontend ci && npm --prefix frontend run build
dbx-plugin package .
```

Only the current host platform can be packaged. The packager takes a `--target`
flag, but for a Go backend it changes nothing except the artifact name and the
manifest's `bin/<target>/` path — the build never sets `GOOS` or `GOARCH`, so
asking for another platform here would produce a host-native binary under that
platform's label. CI builds the per-platform set, one native runner each.

The `.dbxp` includes the built UI, vendored Excalidraw fonts, plugin icon, and
the Go binary for the current platform. No Node.js or Go runtime is required
on the user's machine. Local builds are unsigned review candidates, which DBX
refuses until the plugin center's "allow unsigned development packages" switch
is on; install them with "Install .dbxp" or by dropping the file on that page.

## Release

1. Bump `version` in `manifest.json`, propagate it, commit, then run:

   ```bash
   node scripts/sync-version.mjs --write   # mirrors the version into the sidecar
                                           # identity and the frontend package
   node scripts/release.mjs                # official release
   node scripts/release.mjs --prerelease   # release candidate (store sync skips these)
   ```

   `release.mjs` re-runs the version and manifest guards before tagging, so a
   drifted tree cannot be released. The script refuses to run on a dirty or
   unsynced tree, derives the tag
   from the manifest version (the store validates against it), generates
   notes from `.dbx-store.json` plus the commit log, and creates the GitHub
   Release with the credentials git already has. CI then builds the frontend
   and one unsigned `.dbxp` candidate per platform together with
   `release-candidates.json`.
2. If this repository is registered with `autoUpdate: true`, DBX Store
   creates/updates the candidate PR automatically. Otherwise open one
   candidate PR against `t8y2/dbx-store:main` with the files generated by:

   ```bash
   node scripts/make-store-candidate.mjs v0.2.0   # the released tag
   # -> dist/store/publishers/runstone.json        (first submission only)
   # -> dist/store/candidates/io.dbx.excalidraw.json
   ```
3. After review, DBX Store signs the candidates and publishes them.

## Known limits (V1)

- Scene JSON must stay under ~2 MiB after image stripping (bridge limit);
  vector-only scenes of that size are exceptional.
- Exports are streamed to `<plugin data>/io.dbx.excalidraw/exports/<name>`
  through the sidecar (`export/write`); the editor toast shows the resulting
  path, and the export menu can open that folder in DBX's file manager. On hosts
  with `host.saveFile`, the *Save as…* entries write to a location the user picks
  instead. Export names are capped at 160 runes (long document titles are
  truncated automatically).
- Fonts are vendored and `EXCALIDRAW_ASSET_PATH` resolves against the document
  base URL; re-verify rendering in the real DBX sandbox.

Source code and unsigned candidates stay in this repository. DBX users install
the DBX Store-signed assets exposed by the official catalog. Do not submit
ordinary plugin source to `t8y2/dbx`.

## Credits & licenses

Excalidraw Studio is **Powered by
[Excalidraw](https://github.com/excalidraw/excalidraw)** — the editor embeds
the official `@excalidraw/excalidraw` React component (MIT, © 2020 Excalidraw).
All fonts shipped for offline use (Excalifont, Virgil, Nunito, Lilita One,
Cascadia Code, Comic Shanns, Liberation Sans, Xiaolai, Assistant) come from
the Excalidraw package and are released under the SIL Open Font License 1.1.

Full license texts and dependency attribution: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
(a copy ships inside every `.dbxp` under `assets/`).

This project is an independent DBX plugin and is not affiliated with or
endorsed by the Excalidraw project.
