import { exportToBlob, exportToSvg, serializeAsJSON, MIME_TYPES } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type ExportKind = "excalidraw" | "png" | "svg";

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ");
  return cleaned || "diagram";
}

// Rendering stays entirely in the frontend via the official Excalidraw APIs;
// the Go backend is never asked to render (PRD §15.4).
export async function exportScene(
  kind: ExportKind,
  baseName: string,
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): Promise<void> {
  const name = safeFileName(baseName);
  if (kind === "excalidraw") {
    const json = serializeAsJSON(elements, appState, files, "local");
    downloadBlob(`${name}.excalidraw`, new Blob([json], { type: MIME_TYPES.excalidraw }));
    return;
  }
  if (kind === "png") {
    const blob = await exportToBlob({
      elements,
      appState,
      files,
      mimeType: "image/png",
      quality: 0.92,
    });
    downloadBlob(`${name}.png`, blob);
    return;
  }
  const svg = await exportToSvg({ elements, appState, files });
  downloadBlob(`${name}.svg`, new Blob([svg.outerHTML], { type: "image/svg+xml" }));
}
