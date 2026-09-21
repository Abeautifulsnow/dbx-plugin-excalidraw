export interface DocumentMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  formatVersion: number;
}

export interface AssetRef {
  hash: string;
  size: number;
  mimeType: string;
}

/** Contribution ids declared in manifest.json. */
export const WORKBENCH_CONTRIBUTION = "io.dbx.excalidraw.workbench";
export const RESULT_VIEW_CONTRIBUTION = "io.dbx.excalidraw.result-view";
export const FILESYSTEM_PROVIDER_ID = "io.dbx.excalidraw.documents";

/** Which declared surface the host opened this instance for. */
export type HostSurface = "workbench" | "result-view";

/** What the host handed the plugin when it opened this tab. */
export interface HostLaunch {
  surface: HostSurface;
  /** Null when the surface had to be inferred because the init message was missed. */
  contributionId: string | null;
  context: Record<string, unknown>;
}

/**
 * Payload the host attaches when a `result-view` contribution is opened from
 * the query-result toolbar (ContentArea.vue `openPluginResultView`). The row
 * array is already capped by the host, so `truncated` describes the host's cap
 * and not anything this plugin did.
 */
export interface ResultSetContext {
  connectionId: string;
  database: string;
  sql: string;
  result: {
    columns: string[];
    rows: unknown[][];
    truncated: boolean;
  };
}

/**
 * Child context the host reads back when opening a plugin filesystem. Only
 * `uri` is used for navigation; the host type-checks it and passes it through
 * as the file manager's initial folder, without validating the scheme.
 */
export interface FilesystemChildContext {
  uri?: string;
  connectionId?: string;
}

export interface DbxPluginBridge {
  ready: Promise<void>;
  context: unknown;
  locale: string;
  theme: { appearance: "light" | "dark" };
  invoke<T = unknown>(method: string, params?: unknown, options?: { timeoutMs?: number }): Promise<T>;
  notify(method: string, params?: unknown): unknown;
  // Documented as text; the dev host currently returns the raw envelope.
  readAsset(path: string): Promise<string | { dataBase64: string; contentType: string }>;
  readAssetUrl(path: string): Promise<string>;
  /** Opens the host's own file manager on one of this plugin's filesystem providers. */
  openFilesystem?(providerId: string, childContext?: FilesystemChildContext): Promise<void>;
  /** Persist bytes through the host's native save dialog. */
  saveFile?(options: { fileName?: string; contentType?: string }, data: Uint8Array): Promise<{ path: string } | null>;
  copy?(text: string): Promise<void>;
}

declare global {
  interface Window {
    dbxPlugin?: DbxPluginBridge;
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}
