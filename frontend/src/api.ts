import type { DocumentMeta } from "./types";

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
  if (!window.dbxPlugin) {
    throw new ApiError("BACKEND_UNAVAILABLE", "DBX plugin bridge is not available.");
  }
  try {
    return await window.dbxPlugin.invoke<T>(method, params);
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
};
