# Diagram Studio V1 PRD — Revision Recommendations (R1)

**Base document:** `DBX_Diagram_Studio_V1_PRD.md` (V1.0, development-ready)
**Date:** 2026-09-18
**Status:** Proposed — apply before Phase 1 implementation starts.
**Purpose:** Reconcile the PRD with the actual DBX plugin contracts (Manifest v1, Host API 1.x, Sidecar Protocol v1) and close the gaps found in review. Each numbered revision references the PRD sections it amends.

---

## 0. Summary

| ID  | PRD sections        | Priority | Change |
|-----|---------------------|----------|--------|
| R1  | §25, §26            | P0 | Replace HTTP REST API with the Sidecar JSON-RPC method surface |
| R2  | §11, §16, §25.5, §43 | P0 | Content-addressed asset store so image scenes survive the 2 MiB bridge limit |
| R3  | §14, §15, §35       | P0 | Import/export without host file dialogs; frontend-orchestrated import |
| R4  | §31                 | P0 | Concrete offline-asset mechanism (`EXCALIDRAW_ASSET_PATH` + vendored fonts) |
| R5  | §8.1                | P1 | Pin exact Excalidraw/React versions |
| R6  | §10.2, §33          | P0 | Per-document meta sidecar instead of `index.json`; startup reconciliation |
| R7  | §9.3                | P1 | Mandate official `serializeAsJSON` / `restore` APIs |
| R8  | §22, §8.3           | P0 | Vite/sandbox build constraints and dev workflow |
| R9  | §18, §19            | P1 | Exact theme/locale wiring via `window.dbxPlugin` |
| R10 | §43                 | P0 | Acceptance criteria additions |
| R11 | §36 (repo action)   | P0 | Manifest cleanup: drop the `connection-provider` contribution |
| R12 | §36 (repo action)   | P0 | Plugin identity: id namespace and product name decision |

---

## 1. R1 — Backend API: JSON-RPC over stdio, not HTTP

**Change.** DBX plugin backends are persistent sidecar subprocesses speaking JSON-RPC 2.0 over stdin/stdout. There is no HTTP server and no localhost port. Replace the §25 endpoint table with:

| PRD endpoint                  | Sidecar method        | Notes |
|-------------------------------|-----------------------|-------|
| `GET /health`                 | —                     | Covered by the `plugin/initialize` handshake; the Go SDK serves it automatically |
| `GET /api/documents`          | `document/list`       | Metadata only, no scene parsing |
| `POST /api/documents`         | `document/create`     | `{ name }` → metadata |
| `GET /api/documents/{id}`     | `document/get`        | Metadata + scene JSON + asset manifest (R2) |
| `PUT /api/documents/{id}/scene` | `document/saveScene` | Scene JSON with assets stripped (R2) |
| `PATCH /api/documents/{id}`   | `document/rename`     | `{ name }` |
| `DELETE /api/documents/{id}`  | `document/delete`     | Removes scene + meta; see asset GC in R2 |
| `POST /api/import`            | —                     | Frontend-orchestrated: parse → `document/create` + `document/saveScene` + `asset/putChunk` (the PRD §25.8 alternative is the chosen path) |
| —                             | `asset/putChunk`      | R2 |
| —                             | `asset/getChunk`      | R2 |

Method names must be non-empty, ≤256 chars, no whitespace (protocol rule). UUID validation on every `{id}` (§26 unchanged). The template's `dbx-plugin-excalidraw/ping` method is removed.

**Error mapping (§26).** JSON-RPC codes carry transport-level semantics; application codes live in `error.data`:

| Situation                     | code            | `error.data.code`      |
|-------------------------------|-----------------|------------------------|
| Invalid UUID / malformed body | `-32602`        | `INVALID_REQUEST`      |
| Unknown document              | `-32000`        | `DOCUMENT_NOT_FOUND`   |
| Payload over limit            | `-32600`/`-32000` | `DOCUMENT_TOO_LARGE` |
| Storage failure               | `-32000`        | `DOCUMENT_SAVE_FAILED` |

Never leak OS paths in `message` (§26 unchanged).

---

## 2. R2 — Images vs. the 2 MiB bridge limit (design change)

**Problem.** Hard platform limits: UI→host bridge JSON params **2 MiB**; sidecar single JSON message **8 MiB**. Excalidraw embeds images as base64 data URLs inside `files`; a few pasted screenshots exceed 2 MiB easily. PRD §16 requires images to survive restart, so a naive `saveScene` that inlines `files` starts failing regularly — this breaks autosave itself, not just large documents.

**Design.** Content-addressed asset separation at the persistence adapter (PRD §22 `persistence.ts`):

1. **On save**, the frontend strips `files[*].dataURL` and keeps file metadata (mimeType, size, created). Binaries go to the backend keyed by SHA-256 under `<plugin data>/diagram-studio/assets/<sha256>`. The stored scene JSON is vector-only and stays small.
2. **Transfer** uses chunked RPC on the default JSONL transport — no `host.binary` permission, no framed transport, no extra manifest permissions:
   - `asset/putChunk { documentId, hash, mimeType, size, offset, dataBase64 }` — raw chunk ≤ 512 KiB (≈683 KiB base64, comfortably under the 2 MiB bridge limit). Chunks append to a temp file; the final chunk commits atomically. Idempotent per `(hash, offset)`.
   - `asset/getChunk { hash, offset }` → `{ dataBase64, size, mimeType }`.
3. **On load**, the UI reassembles Excalidraw `BinaryFileData` objects and hydrates the scene before `restore()`.
4. **On export**, the running editor already holds images in memory, so `serializeAsJSON` / `exportToBlob` / `exportToSvg` produce standard files unmodified — §4.3 format compatibility holds at the exchange boundary while internal storage stays split.
5. **GC.** `document/delete` removes the scene and meta. Assets are deduplicated by hash and retained in V1; a later sweep can drop unreferenced hashes. Not release-blocking.
6. **Ceiling.** `document/saveScene` rejects scene JSON > 2 MB with `DOCUMENT_TOO_LARGE` (the 2 MiB UI→host bridge limit from R2; the earlier "8 MiB" here was a typo for the sidecar message limit). Pure-vector scenes that large are exceptional; add scene chunking only if real usage appears.

**Autosave interaction (§11).** Debounce unchanged (1000 ms default). Each unique image hash transfers once; later saves referencing the same image are no-ops, so the expensive path is naturally rare.

**New P0 acceptance item** — see R10.

---

## 3. R3 — Import/export without host file dialogs

**Change.** Host API 1.x has **no** generic file picker or save dialog. Available primitives: `readAsset`/`readAssetUrl` (package-internal resources only), `openFilesystem` (opens the plugin's own filesystem contribution), and a sandboxed iframe (`allow-scripts`, no network, no filesystem). Resolve §35's "where available" to: *not available in Host API 1.x*.

- **Import (§14):** `<input type="file" accept=".excalidraw,application/json">` inside the sandbox iframe. The frontend reads and validates the file (§14.2 flow), then creates the document via RPC (R1 table). The backend never touches the user's filesystem, which also satisfies §32.2 untrusted-input handling at the bridge boundary.
- **Export (§15):** Blob + `<a download>`. Sandboxed iframes may block downloads (no `allow-downloads` flag); verify in real DBX early (spike S3). Fallbacks in order: (a) backend writes to `<plugin data>/diagram-studio/exports/<name>.<ext>` and the success toast surfaces the absolute path; (b) PNG copy to clipboard where Excalidraw supports it.
- **PRD edits:** §35 drop the file-dialog assumptions; §15.4 note the fallback chain; move the dialog spike from Phase 5 to Phase 1 (see §13 below).

---

## 4. R4 — Offline assets, concrete mechanism (§31)

- Vendor the Excalidraw fonts (Excalifont, Cassannet, Nunito; include legacy Virgil only if the pinned version requires it) into `ui/assets/excalidraw/` — inside `ui.root`.
- Set `window.EXCALIDRAW_ASSET_PATH` to the vendored directory at bootstrap (per the official integration docs) so the editor never resolves CDN URLs.
- Verify with networking blocked, in both the dev host and real DBX. Any external request or CSP violation is a release blocker (R10 makes this check explicit).

---

## 5. R5 — Pin dependency versions (§8.1)

Record exact pins when implementation starts (`@excalidraw/excalidraw` patch version + matching React major). Excalidraw's public API moves quickly; treat upgrades as feature changes requiring a P0-editor regression pass. Write the chosen pins into PRD §8.1.

---

## 6. R6 — Storage layout: meta sidecar instead of `index.json` (§10.2)

**Change.** Replace the single `index.json` with per-document sidecars:

```text
diagram-studio/
├── documents/
│   ├── <uuid>.excalidraw      # scene JSON, assets stripped (R2)
│   └── <uuid>.meta.json       # id, name, createdAt, updatedAt, lastOpenedAt, formatVersion, asset refs
└── assets/
    └── <sha256>               # image binaries, deduplicated
```

- Listing reads only `*.meta.json` (small files) — satisfies §33 without parsing scenes.
- Crash consistency becomes single-file-scoped: atomic write (tmp → fsync → rename) per file. No two-phase index/document coupling, no window where a saved scene is invisible to the index.
- **Startup reconciliation** (once, at sidecar start): scene without meta → rebuild meta (`name: "Recovered <uuid8>"`, timestamps from file mtime); meta without scene → drop the meta.
- The `recovery/` copy (§12.2) stays optional/P1 — atomic writes plus reconciliation already cover the §12.1 crash list.

---

## 7. R7 — Serialization via official APIs (§9.3)

Use the package's `serializeAsJSON(elements, appState, files)` and `restore()` instead of hand-picking `appState` fields. The persistence adapter owns the strip/rehydrate step from R2; nothing else may reshape scene JSON (§4.3).

---

## 8. R8 — Frontend build constraints (§22, §8.3)

- Vite `base: './'`; all emitted assets inside `ui.root`; no absolute paths, no CDN URLs, no dev-server references in the package.
- `dbx-plugin.toml` gains `[dev]` `ui_build` / `ui_watch` command arrays; the build must print a standalone `DBX_UI_BUILD_SUCCESS` line for hot reload to trigger.
- Editor mount: audit the ancestor chain for non-zero computed size (`min-height: 0` under flex/grid) before Phase 2 sign-off (§8.3 kept, checklist item added).

---

## 9. R9 — Theme/locale wiring (§18, §19)

- **Theme:** map `window.dbxPlugin.theme.appearance` → the Excalidraw `theme` prop; re-apply on the `dbx-plugin-env` event for runtime switching without restart (§18.2).
- **Locale:** `window.dbxPlugin.locale` drives plugin UI copy via a small built-in i18n table (zh-CN + en minimum); manifest `localizations` continues to cover contribution labels (§19's two-layer model confirmed as designed).

---

## 10. R10 — Acceptance criteria additions (§43)

P0 additions:

- [ ] Autosave succeeds for a scene with embedded images whose total serialized size exceeds 2 MiB (R2).
- [ ] Fonts load offline: zero external requests and zero CSP violations with networking blocked (R4).
- [ ] Import via sandbox file input and export via download verified in real DBX — or the documented fallback shipped (R3).

---

## 11. R11 — Manifest cleanup (repo action, P0)

The scaffold manifest carries a `connection-provider` contribution (a host/port form) and the backend implements `connection/*` handlers. A diagram workspace has no connection concept; the fake form is user-visible noise and forces `capabilities: ["connections"]`. Remove:

- the `connection-provider` contribution block and its `localizations` entries,
- the `connection/*` handlers in `backend/main.go` (along with the template `ping` method),
- and declare a backend capability that reflects reality (e.g. `documents`).

Keep the single workbench contribution. Net effect: fewer manifest fields and **no permissions needed at all** (chunked-JSON asset transfer avoids `host.binary` — R2 decision).

---

## 12. R12 — Plugin identity (decision required before first publish)

- Current id `io.dbx.excalidraw` sits in a namespace that reads as DBX-official, while the publisher is `runstone`. Ids are **immutable after publishing**. Either confirm `io.dbx.excalidraw` is acceptable for third-party plugins, or switch now to a publisher-owned id (e.g. `com.runstone.diagram-studio`).
- Product name: the PRD says "Diagram Studio"; manifest/README say "Excalidraw Studio". Pick one and align manifest `name`, `localizations`, and README — and remove "visualizing database schemas" from the README/manifest description (PRD §3 non-goal).

---

## 13. Phase plan adjustments (§44)

- **Phase 1** additionally runs the three spikes below; Phase 5's dialog work is already resolved by then.
- **Phase 3** implements R2 (asset separation) and R6 (meta sidecar), not just the PRD's original "metadata" bullet.

**Spikes (P0, before Phase 2 sign-off):**

| ID | Spike | Question answered |
|----|-------|-------------------|
| S1 | React + Vite + Excalidraw bundle in sandbox | Loads in dev host and real DBX; fonts vendored; zero external requests / CSP errors |
| S2 | >2 MiB image scene save/load | Chunked asset path (R2) works end-to-end before persistence code hardens |
| S3 | Export download behavior | Does `<a download>` work in the sandbox; primary path vs fallback (R3) |

---

## 14. Open decisions

1. **Plugin id namespace** (R12) — blocks first publish, not development.
2. **Product name** — "Diagram Studio" vs "Excalidraw Studio" (R12).
3. **Asset transport** — chunked JSON (recommended: default transport, no extra permissions) vs framed binary (`host.binary`, more moving parts). Revisit only if S2 shows chunked transfer is too slow.
4. **Export fallback order** if S3 rejects both the download and clipboard paths.
