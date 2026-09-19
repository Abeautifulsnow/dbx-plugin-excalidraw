import { restore, serializeAsJSON } from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { api, ApiError } from "./api";
import { base64ToBytes, bytesToBase64, bytesToDataURL, concatBytes, parseDataURL, sha256Hex } from "./bytes";
import type { DocumentMeta } from "./types";

// Chunks stay well below the 2 MiB UI->host bridge parameter limit even after
// base64 expansion (~4/3 ratio).
const CHUNK_SIZE = 512 * 1024;

interface StoredSceneFile {
  id?: string;
  mimeType: string;
  created?: number;
  hash?: string;
  size?: number;
  dataURL?: string;
}

interface StoredScene {
  type?: string;
  version?: number;
  source?: string;
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, StoredSceneFile>;
}

export interface LoadedDocument {
  meta: DocumentMeta;
  elements: OrderedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

// Hashes already present in backend storage; avoids re-uploading unchanged
// images on every autosave. Bounded in practice by the number of distinct
// images touched in one editor session (dataURL blobs themselves are the
// dominant memory cost and live in the editor's own cache).
const knownAssets = new Set<string>();

export async function loadDocument(id: string): Promise<LoadedDocument> {
  const response = await api.getDocument(id);
  if (response.corrupt || !response.scene) {
    throw new ApiError("DOCUMENT_CORRUPT", "The stored scene is damaged.");
  }
  const scene = response.scene as StoredScene;
  const files: BinaryFiles = {};
  for (const [fileId, entry] of Object.entries(scene.files ?? {})) {
    if (entry.hash) {
      const bytes = await downloadAsset(entry.hash);
      knownAssets.add(entry.hash);
      files[fileId] = {
        id: entry.id ?? fileId,
        mimeType: entry.mimeType,
        created: entry.created ?? Date.now(),
        dataURL: bytesToDataURL(bytes, entry.mimeType),
      } as BinaryFileData;
    } else if (typeof entry.dataURL === "string") {
      files[fileId] = entry as unknown as BinaryFileData;
    }
  }
  const restored = restore(
    { elements: (scene.elements ?? []) as ExcalidrawElement[], appState: scene.appState ?? {}, files },
    null,
    null,
  );
  return {
    meta: response.document,
    elements: restored.elements,
    appState: restored.appState,
    files: restored.files,
  };
}

// Serializes the live scene, strips image dataURLs into the content-addressed
// asset store, and persists the (now small) vector-only scene.
export async function persistScene(
  documentId: string,
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
): Promise<DocumentMeta> {
  const serialized = serializeAsJSON(elements, appState, files, "local");
  const scene = JSON.parse(serialized) as StoredScene;
  scene.files = await stripAndUploadFiles(scene.files ?? {}, documentId);
  return api.saveScene(documentId, scene);
}

// Persists an already-parsed scene object (used by .excalidraw import).
export async function persistImportedScene(
  documentId: string,
  scene: StoredScene,
): Promise<DocumentMeta> {
  scene = { ...scene, files: await stripAndUploadFiles(scene.files ?? {}, documentId) };
  return api.saveScene(documentId, scene);
}

async function stripAndUploadFiles(
  files: Record<string, StoredSceneFile>,
  documentId: string,
): Promise<Record<string, StoredSceneFile>> {
  const stripped: Record<string, StoredSceneFile> = {};
  for (const [fileId, file] of Object.entries(files)) {
    if (typeof file.dataURL !== "string" || !file.dataURL.startsWith("data:")) {
      // Nothing we can strip (should not happen for standard scenes).
      stripped[fileId] = file;
      continue;
    }
    const { mimeType, bytes } = parseDataURL(file.dataURL);
    const hash = await sha256Hex(bytes);
    if (!knownAssets.has(hash)) {
      const stat = await api.statAsset(hash);
      if (!stat.exists) {
        await uploadAsset(documentId, hash, mimeType, bytes);
      }
      knownAssets.add(hash);
    }
    stripped[fileId] = {
      id: file.id ?? fileId,
      mimeType: file.mimeType,
      created: file.created ?? Date.now(),
      hash,
      size: bytes.length,
    };
  }
  return stripped;
}

async function uploadAsset(documentId: string, hash: string, mimeType: string, bytes: Uint8Array): Promise<void> {
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, bytes.length);
    await api.putAssetChunk({
      documentId,
      hash,
      mimeType,
      size: bytes.length,
      offset,
      dataBase64: bytesToBase64(bytes.subarray(offset, end)),
    });
  }
}

async function downloadAsset(hash: string): Promise<Uint8Array> {
  const first = await api.getAssetChunk(hash, 0, CHUNK_SIZE);
  const total = first.size;
  if (total <= 0) {
    throw new ApiError("ASSET_NOT_FOUND", "The image data is missing.");
  }
  const parts = [base64ToBytes(first.dataBase64)];
  let received = parts[0].length;
  while (received < total) {
    const next = await api.getAssetChunk(hash, received, CHUNK_SIZE);
    const part = base64ToBytes(next.dataBase64);
    if (part.length === 0) {
      throw new ApiError("ASSET_NOT_FOUND", "Truncated image data.");
    }
    parts.push(part);
    received += part.length;
  }
  return concatBytes(parts);
}
