import type { DocumentMeta, DbxPluginBridge } from "./types";

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

// Backend protocol errors carry "CATEGORY: message" text; everything else is
// treated as a transport/backend availability problem.
async function call<T>(method: string, params: unknown): Promise<T> {
  const bridge = (globalThis as { window?: { dbxPlugin?: DbxPluginBridge } }).window?.dbxPlugin;
  if (!bridge) {
    throw new ApiError("BACKEND_UNAVAILABLE", "DBX plugin bridge is not available.");
  }
  try {
    return await bridge.invoke<T>(method, params);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const raw = error instanceof Error ? error.message : String(error);
    const match = raw.match(/^([A-Z][A-Z_]+):\s*(.*)$/s);
    throw match ? new ApiError(match[1], match[2]) : new ApiError("BACKEND_UNAVAILABLE", raw);
  }
}

export interface PutChunkParams {
  documentId: string;
  hash: string;
  mimeType: string;
  size: number;
  offset: number;
  dataBase64: string;
}

export interface ExportChunkParams {
  jobId: string;
  name: string;
  size: number;
  offset: number;
  dataBase64: string;
}

export const api = {
  listDocuments: () => call<{ items: DocumentMeta[] }>("document/list", {}),

  createDocument: (name: string) => call<DocumentMeta>("document/create", { name }),

  getDocument: (id: string) =>
    call<{ document: DocumentMeta; scene: unknown | null; corrupt: boolean }>("document/get", { id }),

  saveScene: (id: string, scene: unknown) => call<DocumentMeta>("document/saveScene", { id, scene }),

  renameDocument: (id: string, name: string) => call<DocumentMeta>("document/rename", { id, name }),

  deleteDocument: (id: string) => call<{ success: boolean }>("document/delete", { id }),

  statAsset: (hash: string) =>
    call<{ exists: boolean; asset: { hash: string; size: number; mimeType: string } }>("asset/stat", { hash }),

  putAssetChunk: (params: PutChunkParams) =>
    call<{ received: number; complete: boolean }>("asset/putChunk", params),

  getAssetChunk: (hash: string, offset: number, length: number) =>
    call<{ dataBase64: string; size: number; mimeType: string }>("asset/getChunk", { hash, offset, length }),

  writeExportChunk: (params: ExportChunkParams) =>
    call<{ received: number; complete: boolean; path: string }>("export/write", params),

  // Preferences live in the sidecar's own data directory rather than in
  // `host.storage`: the sidecar already owns that directory (DBX_PLUGIN_DATA_DIR
  // resolves to the same `plugin-data/<id>` the host KV would use), so a pref
  // store there costs no extra manifest permission and no first-mover risk.
  getPrefs: () => call<{ values: Record<string, unknown> }>("prefs/get", {}),

  setPref: (key: string, value: unknown) => call<{ values: Record<string, unknown> }>("prefs/set", { key, value }),
};
