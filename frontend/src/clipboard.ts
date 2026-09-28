import { convertToExcalidrawElements, restore, serializeAsJSON } from "@excalidraw/excalidraw";
import type { AppState, BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { base64ToBytes, bytesToDataURL, sha256Hex } from "./bytes";
import { ensureAssetUploaded } from "./persistence";
import type { DbxPluginBridge } from "./types";

/**
 * Host-clipboard integration. Writing rides `clipboard.writeText` (which is
 * the host's permission-free `host.copy` path, with `copy` itself as the
 * fallback for hosts that predate the sub-object); reading needs the
 * `host.clipboard:read` permission and only exists on hosts that advertise
 * `capabilities.clipboardRead` / `clipboardImageRead` — callers gate the menu
 * entries on those flags and treat every failure here as a toast, never as a
 * broken canvas.
 */

export type ClipboardErrorCode = "READ_FAILED" | "WRITE_FAILED" | "INVALID_SCENE";

export class ClipboardError extends Error {
  readonly code: ClipboardErrorCode;

  constructor(code: ClipboardErrorCode, message: string) {
    super(message);
    this.name = "ClipboardError";
    this.code = code;
  }
}

export interface Offset {
  x: number;
  y: number;
}

export interface PastedScene {
  elements: ExcalidrawElement[];
  files: Record<string, BinaryFileData>;
}

export interface ClipboardImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

function getBridge(failureCode: ClipboardErrorCode): DbxPluginBridge {
  const bridge = (globalThis as { window?: { dbxPlugin?: DbxPluginBridge } }).window?.dbxPlugin;
  if (!bridge) {
    throw new ClipboardError(failureCode, "DBX plugin bridge is not available.");
  }
  return bridge;
}

// crypto.randomUUID needs a secure context the sandbox cannot guarantee; the
// id only has to be unique within this session (same rationale as export.ts).
// The byte-level fallbacks prefer the platform CSPRNG over Math.random so a
// guessed id can never stand in for an unguessable one.
function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < count; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomSeed(): number {
  const bytes = randomBytes(4);
  // Excalidraw seeds are 31-bit; the shift drops the sign bit.
  return ((bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 1) & 0x7fffffff;
}

/** Serializes the live scene and writes it to the system clipboard. */
export async function copySceneToClipboard(
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): Promise<void> {
  const bridge = getBridge("WRITE_FAILED");
  const json = serializeAsJSON(elements, appState, files, "local");
  if (bridge.clipboard?.writeText) {
    try {
      await bridge.clipboard.writeText(json);
      return;
    } catch (error) {
      console.error("[clipboard] writeText failed", error);
      throw new ClipboardError("WRITE_FAILED", "the host refused the clipboard write");
    }
  }
  if (bridge.copy) {
    try {
      await bridge.copy(json);
      return;
    } catch (error) {
      console.error("[clipboard] copy fallback failed", error);
      throw new ClipboardError("WRITE_FAILED", "the host refused the clipboard write");
    }
  }
  throw new ClipboardError("WRITE_FAILED", "this host has no clipboard write surface");
}

// Element references that cross the id space: a pasted scene must not collide
// with the ids already on the canvas, so every id (and every pointer to one)
// is reissued. Everything else is carried over by the spread.
interface CrossReferences {
  containerId?: string | null;
  boundElements?: { id: string; type: string }[] | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  frameId?: string | null;
  fileId?: string | null;
}

function remapSceneElements(
  elements: readonly ExcalidrawElement[],
  fileIdMap: Map<string, string>,
  offset: Offset,
): ExcalidrawElement[] {
  const idMap = new Map<string, string>();
  const groupIdMap = new Map<string, string>();
  for (const element of elements) {
    idMap.set(element.id, randomId());
  }
  for (const element of elements) {
    for (const groupId of element.groupIds) {
      if (!groupIdMap.has(groupId)) {
        groupIdMap.set(groupId, randomId());
      }
    }
  }
  return elements.map((element) => {
    const clone: Record<string, unknown> = {
      ...element,
      id: idMap.get(element.id),
      x: element.x + offset.x,
      y: element.y + offset.y,
      seed: randomSeed(),
      versionNonce: randomSeed(),
    };
    clone.groupIds = element.groupIds.map((groupId) => groupIdMap.get(groupId) ?? groupId);
    const refs = element as ExcalidrawElement & CrossReferences;
    // Structural references to an id that is not part of the pasted set are
    // dropped rather than carried over: clipboard text can come from anywhere,
    // and a surviving stale id could bind this element to an unrelated one
    // already on the canvas. An unbound text/arrow/frame child degrades
    // gracefully; a mis-bound one does not. `fileId` keeps its original value
    // instead — a dangling reference renders as Excalidraw's image
    // placeholder, the established degradation for missing asset bytes.
    if (refs.containerId) {
      clone.containerId = idMap.get(refs.containerId) ?? null;
    }
    if (refs.boundElements) {
      clone.boundElements = refs.boundElements
        .filter((bound) => idMap.has(bound.id))
        .map((bound) => ({ ...bound, id: idMap.get(bound.id) ?? bound.id }));
    }
    if (refs.startBinding) {
      clone.startBinding = idMap.has(refs.startBinding.elementId)
        ? { ...refs.startBinding, elementId: idMap.get(refs.startBinding.elementId) }
        : null;
    }
    if (refs.endBinding) {
      clone.endBinding = idMap.has(refs.endBinding.elementId)
        ? { ...refs.endBinding, elementId: idMap.get(refs.endBinding.elementId) }
        : null;
    }
    if (refs.frameId) {
      clone.frameId = idMap.get(refs.frameId) ?? null;
    }
    if (refs.fileId) {
      clone.fileId = fileIdMap.get(refs.fileId) ?? refs.fileId;
    }
    return clone as ExcalidrawElement;
  });
}

const invalidScene = () => new ClipboardError("INVALID_SCENE", "the clipboard does not hold a valid Excalidraw scene");

/**
 * Reads a serialized scene from the clipboard and prepares it for merging
 * into the open document: ids, group ids, file ids and every cross-reference
 * are remapped so nothing collides with the live scene, and the whole set is
 * shifted by `offset` (the caller passes a nudge when the canvas is not
 * empty). Throws `INVALID_SCENE` for anything that is not a scene-shaped
 * JSON and `READ_FAILED` when the clipboard cannot be read at all.
 */
export async function readSceneFromClipboard(offset: Offset = { x: 0, y: 0 }): Promise<PastedScene> {
  const bridge = getBridge("READ_FAILED");
  if (!bridge.clipboard?.readText) {
    throw new ClipboardError("READ_FAILED", "clipboard.readText is unavailable in this host");
  }
  let text: string;
  try {
    text = await bridge.clipboard.readText();
  } catch (error) {
    console.error("[clipboard] readText failed", error);
    throw new ClipboardError("READ_FAILED", "the host refused the clipboard read");
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw invalidScene();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw invalidScene();
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw invalidScene();
  }
  const scene = parsed as { elements?: unknown; appState?: unknown; files?: unknown };
  const elementsOk =
    Array.isArray(scene.elements) &&
    scene.elements.length > 0 &&
    scene.elements.every((element) => {
      if (typeof element !== "object" || element === null) {
        return false;
      }
      const candidate = element as { id?: unknown; x?: unknown; y?: unknown };
      return typeof candidate.id === "string" && typeof candidate.x === "number" && typeof candidate.y === "number";
    });
  if (!elementsOk) {
    throw invalidScene();
  }
  let restored;
  try {
    restored = restore(
      {
        elements: scene.elements as ExcalidrawElement[],
        appState: ((scene.appState ?? {}) as Partial<AppState>) ?? {},
        files: (typeof scene.files === "object" && scene.files !== null ? scene.files : {}) as BinaryFiles,
      },
      null,
      null,
    );
  } catch (error) {
    console.error("[clipboard] restore failed", error);
    throw invalidScene();
  }
  const fileIdMap = new Map(Object.keys(restored.files ?? {}).map((fileId) => [fileId, randomId()]));
  const remappedFiles: Record<string, BinaryFileData> = {};
  for (const [fileId, file] of Object.entries(restored.files ?? {})) {
    remappedFiles[fileIdMap.get(fileId) ?? fileId] = file;
  }
  return { elements: remapSceneElements(restored.elements, fileIdMap, offset), files: remappedFiles };
}

/** Reads a PNG image from the clipboard. The host gates this behind a
 *  per-session confirmation; a denial arrives here as `READ_FAILED`. */
export async function readClipboardImage(): Promise<ClipboardImage> {
  const bridge = getBridge("READ_FAILED");
  if (!bridge.clipboard?.readImage) {
    throw new ClipboardError("READ_FAILED", "clipboard.readImage is unavailable in this host");
  }
  let payload;
  try {
    payload = await bridge.clipboard.readImage();
  } catch (error) {
    console.error("[clipboard] readImage failed", error);
    throw new ClipboardError("READ_FAILED", "the host refused or could not serve the clipboard image");
  }
  if (payload.contentType !== "image/png" || typeof payload.dataBase64 !== "string" || payload.dataBase64.length === 0) {
    throw new ClipboardError("READ_FAILED", "the clipboard image is not a decodable PNG");
  }
  const bytes = base64ToBytes(payload.dataBase64);
  if (bytes.length === 0 || payload.width <= 0 || payload.height <= 0) {
    throw new ClipboardError("READ_FAILED", "the clipboard image is empty or misreported");
  }
  return { bytes, width: payload.width, height: payload.height };
}

export const MAX_IMAGE_SIDE = 800;

/** Keeps a pasted screenshot from arriving at its native (often huge) size. */
export function scaledImageSize(width: number, height: number, maxSide = MAX_IMAGE_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Uploads the image into the content-addressed asset store and builds the
 *  file + element pair to drop onto the canvas. The in-memory file keeps its
 *  dataURL so the editor renders immediately; persistence strips it again. */
export async function buildImageInsert(
  documentId: string,
  image: ClipboardImage,
  position: Offset,
): Promise<{ file: BinaryFileData; element: ExcalidrawElement }> {
  const size = scaledImageSize(image.width, image.height);
  const hash = await sha256Hex(image.bytes);
  await ensureAssetUploaded(documentId, hash, "image/png", image.bytes);
  const file = {
    id: randomId(),
    mimeType: "image/png",
    created: Date.now(),
    dataURL: bytesToDataURL(image.bytes, "image/png"),
    // FileId / dataURL are branded string types upstream; persistence.ts
    // constructs them the same way.
  } as BinaryFileData;
  const [element] = convertToExcalidrawElements([
    { type: "image", fileId: file.id, x: position.x, y: position.y, width: size.width, height: size.height },
  ]);
  if (!element) {
    throw new Error("convertToExcalidrawElements produced no image element");
  }
  return { file, element };
}

/** Center of the current (non-deleted) content, used to land pasted images
 *  where the drawing actually is; an empty canvas resolves to the origin. */
export function sceneCenter(elements: readonly ExcalidrawElement[]): Offset {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }
    minX = Math.min(minX, element.x);
    minY = Math.min(minY, element.y);
    maxX = Math.max(maxX, element.x + element.width);
    maxY = Math.max(maxY, element.y + element.height);
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0 };
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
