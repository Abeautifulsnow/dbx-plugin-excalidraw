import { useSyncExternalStore } from "react";
import { api } from "./api";

/**
 * Small persisted UI preferences, stored by the Go sidecar under the plugin
 * data directory.
 *
 * These are deliberately limited to values that change what the UI does on the
 * next render; anything the canvas itself owns (scene state, document titles)
 * lives in the document store instead. A preference that fails to save is not
 * worth interrupting the user for, so writes are best-effort.
 */
export interface Prefs {
  /** Last row count chosen in the result view. */
  resultRows?: number;
  /** Last search term typed on the home screen. */
  homeSearch?: string;
}

/**
 * Keys this build knows about. Kept in step with `normalizePref` in
 * `backend/prefs.go` by hand: the sidecar must validate independently (it cannot
 * trust what the UI sends), so adding a key means editing both. A key the
 * backend knows but this list does not is dropped here on load, and vice versa
 * is refused on save — either way it fails silently, which is why the two lists
 * carry a comment pointing at each other.
 */
const PREF_KEYS = ["resultRows", "homeSearch"] as const;

let cache: Prefs = {};
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentPrefs(): Prefs {
  return cache;
}

/** Drops anything the current build does not know about, so a downgrade cannot resurrect stale keys. */
function sanitize(values: Record<string, unknown>): Prefs {
  const prefs: Prefs = {};
  for (const key of PREF_KEYS) {
    const value = values[key];
    if (key === "resultRows" && typeof value === "number" && Number.isFinite(value) && value > 0) {
      prefs.resultRows = Math.floor(value);
    }
    if (key === "homeSearch" && typeof value === "string") {
      prefs.homeSearch = value;
    }
  }
  return prefs;
}

/**
 * Reads the stored preferences once. Called during boot so components can seed
 * their initial state from it; a failure leaves every default in place rather
 * than blocking startup.
 */
export async function loadPrefs(): Promise<Prefs> {
  if (loaded) {
    return cache;
  }
  try {
    const result = await api.getPrefs();
    cache = sanitize(result.values ?? {});
  } catch (error) {
    console.warn("[prefs] could not load preferences", error);
    cache = {};
  }
  loaded = true;
  emit();
  return cache;
}

/** Applies a preference locally at once and persists it in the background. */
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  cache = { ...cache, [key]: value };
  emit();
  void api.setPref(key, value).catch((error) => {
    console.warn("[prefs] could not save preference", key, error);
  });
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, currentPrefs, currentPrefs);
}
