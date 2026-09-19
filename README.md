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
- **Persistence** — a Go sidecar owns durable local storage with atomic
  writes, per-document metadata sidecars, and startup reconciliation.
- **Autosave** — debounced (~1 s) with a serialized save queue; save status is
  always visible (Saved / Saving… / Unsaved / Save failed).

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

Backend tests and an end-to-end protocol smoke (the SDK module is not on
public Go proxies, so the scripts wire a temporary go.work to the CLI's
bundled SDK sources; requires Node.js 22+ and Go):

```bash
node scripts/backend-test.mjs   # go vet + unit tests for the store layer
node scripts/sidecar-smoke.mjs  # spawns the sidecar and drives stdio JSON-RPC:
                                # handshake, create/save/get, 1.2 MiB chunked
                                # asset upload + byte-exact round-trip
```

## Package

```bash
npm --prefix frontend ci && npm --prefix frontend run build
dbx-plugin package .
```

The `.dbxp` includes the built UI, vendored Excalidraw fonts, plugin icon, and
the Go binary for the current platform. No Node.js or Go runtime is required
on the user's machine.

## Release

1. Publish a GitHub Release. The workflow builds the frontend, then produces
   unsigned per-target candidates plus `release-candidates.json`.
2. If this repository is registered with `autoUpdate: true`, DBX Store
   creates/updates the candidate PR automatically. Otherwise open one
   candidate PR against `t8y2/dbx-store:main`.
3. After review, DBX Store signs the candidates and publishes them.

## Known limits (V1)

- Scene JSON must stay under ~2 MiB after image stripping (bridge limit);
  vector-only scenes of that size are exceptional.
- Export uses browser downloads (`<a download>`); verify inside real DBX and
  fall back to the plugin data directory if the sandbox blocks downloads.
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
