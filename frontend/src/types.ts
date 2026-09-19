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
}

declare global {
  interface Window {
    dbxPlugin?: DbxPluginBridge;
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}
