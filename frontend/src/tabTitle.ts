import type { DbxPluginBridge } from "./types";

/**
 * Host tab titles: the plugin keeps the tab labeled with what it is actually
 * showing — the open document's name in the editor, the view name elsewhere —
 * instead of the static contribution label every tab used to share.
 *
 * Strictly cosmetic by contract: the whole module no-ops unless the init frame
 * advertised the `workbenchTitle` capability (older hosts keep their static
 * label), and a refused call is swallowed, because a stale title must never
 * escalate into a broken view.
 *
 * Kept free of a hard `window` reference so the pure helpers stay importable
 * under the node test environment, like host.ts and api.ts.
 */

// The host caps menu labels at 120; tab titles get the same ceiling so a long
// document name cannot push its tab wider than the host is willing to render.
export const TAB_TITLE_MAX_CHARS = 120;

/** Trims and truncates with an ellipsis, keeping the result within the cap. */
export function clampTabTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > TAB_TITLE_MAX_CHARS
    ? `${trimmed.slice(0, TAB_TITLE_MAX_CHARS - 1)}…`
    : trimmed;
}

/** The editor marks an unsaved document the way desktop editors do: "• name". */
export function editorTabTitle(name: string, hasUnsaved: boolean): string {
  return clampTabTitle(hasUnsaved ? `• ${name}` : name);
}

let applied: string | null = null;

function bridgeOf(): DbxPluginBridge | undefined {
  return (globalThis as { window?: { dbxPlugin?: DbxPluginBridge } }).window?.dbxPlugin;
}

/**
 * Applies a tab title, deduplicated so rerenders that compute the same string
 * cost no host call. Without the capability or the method, nothing happens —
 * there is deliberately no probe-and-fallback here, since the init frame is
 * authoritative for whether the host takes titles.
 */
export function applyTabTitle(title: string): void {
  const next = clampTabTitle(title);
  if (next === applied) {
    return;
  }
  const instance = bridgeOf();
  if (instance?.capabilities?.workbenchTitle !== true || typeof instance.setTitle !== "function") {
    return;
  }
  applied = next;
  void Promise.resolve(instance.setTitle(next)).catch(() => {
    // Drop the memo so a later view change retries instead of assuming the
    // refused title stuck — but only when no newer title took over meanwhile,
    // or the reset would clobber the memo of a title that did land.
    if (applied === next) {
      applied = null;
    }
  });
}
