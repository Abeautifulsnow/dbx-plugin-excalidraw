import { exportToBlob, exportToSvg, serializeAsJSON, MIME_TYPES } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { api } from "./api";
import { bytesToBase64 } from "./bytes";

export type ExportKind = "excalidraw" | "png" | "svg";

// Chunks stay well below the 2 MiB UI->host bridge parameter limit even after
// base64 expansion (~4/3 ratio), matching the asset-transfer sizing.
const EXPORT_CHUNK_SIZE = 512 * 1024;

const EXTENSIONS: Record<ExportKind, string> = {
  excalidraw: ".excalidraw",
  png: ".png",
  svg: ".svg",
};

// backend/exports.go rejects export names above 160 runes; stay under the cap
// after the extension is appended, counting code points (not UTF-16 units).
const MAX_EXPORT_NAME_RUNES = 160;

function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ");
  return cleaned || "diagram";
}

function exportFileName(kind: ExportKind, baseName: string): string {
  const extension = EXTENSIONS[kind];
  const budget = MAX_EXPORT_NAME_RUNES - extension.length;
  const truncated = [...safeFileName(baseName)]
    .slice(0, budget)
    .join("")
    // The backend rejects dotfiles and names ending in a dot; Windows also
    // drops trailing dots and spaces.
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  return `${truncated || "diagram"}${extension}`;
}

// Rendering stays entirely in the frontend via the official Excalidraw APIs;
// the Go backend is never asked to render (PRD §15.4).
async function renderScene(
  kind: ExportKind,
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): Promise<Blob> {
  if (kind === "png") {
    return exportToBlob({
      elements,
      appState,
      files,
      mimeType: "image/png",
      quality: 0.92,
    });
  }
  if (kind === "svg") {
    const svg = await exportToSvg({ elements, appState, files });
    return new Blob([sanitizeSvgFonts(svg.outerHTML)], { type: "image/svg+xml" });
  }
  const json = serializeAsJSON(elements, appState, files, "local");
  return new Blob([json], { type: MIME_TYPES.excalidraw });
}

// The sandboxed workbench iframe silently swallows <a download> clicks (no
// allow-downloads; see DBX host-api.md), so the rendered blob is streamed to
// the Go sidecar, which writes it under <plugin data>/exports/ and returns
// the on-disk path for the UI to surface.
export async function exportScene(
  kind: ExportKind,
  baseName: string,
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): Promise<string> {
  const blob = await renderScene(kind, elements, appState, files);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("export produced no data");
  }
  const name = exportFileName(kind, baseName);
  const jobId = newJobId();
  let path = "";
  for (let offset = 0; offset < bytes.length; offset += EXPORT_CHUNK_SIZE) {
    const end = Math.min(offset + EXPORT_CHUNK_SIZE, bytes.length);
    const result = await api.writeExportChunk({
      jobId,
      name,
      size: bytes.length,
      offset,
      dataBase64: bytesToBase64(bytes.subarray(offset, end)),
    });
    path = result.path;
  }
  return path;
}

// crypto.randomUUID requires a secure context, which the sandboxed iframe
// cannot guarantee. The id only names a scratch file inside exports/.partial,
// so any per-session unique value is fine.
function newJobId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = "0123456789abcdef";
  let out = "";
  for (let index = 0; index < 32; index += 1) {
    out += hex[Math.floor(Math.random() * 16)];
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

// Excalidraw's SVG exporter cannot fetch fonts inside the sandbox (CSP allows
// only data:/blob: sources) and falls back to tagging @font-face rules with
// CDN URLs. Remote sources are dead weight in a shared file, so any
// @font-face rule without an inline data: source is dropped; text keeps its
// font-family names and degrades to the viewer's installed fonts.
export function sanitizeSvgFonts(svg: string): string {
  return svg.replace(/@font-face\s*\{[^{}]*\}/g, (rule) =>
    /url\(\s*(['"]?)(?:https?:|blob:)[^)]*\)/i.test(rule) ? "" : rule,
  );
}
