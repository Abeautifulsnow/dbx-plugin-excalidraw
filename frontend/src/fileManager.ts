import { FILESYSTEM_PROVIDER_ID, type DbxPluginBridge } from "./types";

/**
 * The two directories this plugin's filesystem provider exposes. These exact
 * strings are what `FSList` reports for its own root entries, so they are the
 * only URIs the host's file manager can start a listing from.
 */
export type RevealTarget = "documents" | "exports";

export const DIRECTORY_URIS: Record<RevealTarget, string> = {
  documents: "excalidraw:/documents/",
  exports: "excalidraw:/exports/",
};

function bridge(): DbxPluginBridge | undefined {
  return (globalThis as { window?: { dbxPlugin?: DbxPluginBridge } }).window?.dbxPlugin;
}

/**
 * Asks the host to open its own file manager on one of our directories, which
 * is how a user gets from an exported-file path to the file itself without
 * leaving DBX.
 *
 * The host passes `uri` through as the file manager's initial folder after a
 * string check only, so it must name a directory the provider actually lists —
 * a file URI surfaces as a failed listing rather than a rejected request. A
 * host that omits `openFilesystem` (or denies `host.filesystem`) rejects, which
 * callers surface as a message rather than a silent no-op.
 */
export async function revealInFileManager(target: RevealTarget): Promise<void> {
  const api = bridge();
  if (!api?.openFilesystem) {
    throw new Error("host.openFilesystem is unavailable in this host");
  }
  await api.openFilesystem(FILESYSTEM_PROVIDER_ID, { uri: DIRECTORY_URIS[target] });
}
