import { useEffect, useState } from "react";
import { ensureFonts } from "./fonts";
import { getLaunch, primeLaunchFromBridge, subscribeLaunch } from "./host";
import { pickLang, type Lang } from "./i18n";
import type { HostLaunch } from "./types";

export type HostPhase = "boot" | "ready" | "nohost";

export interface HostSession {
  phase: HostPhase;
  theme: "light" | "dark";
  lang: Lang;
  launch: HostLaunch | null;
}

/**
 * Owns everything that depends on the host: boot phase, theme, locale and the
 * launch the host handed us. Kept out of App so the rendering decisions there
 * read as a plain switch over the session.
 */
export function useHostSession(): HostSession {
  const [phase, setPhase] = useState<HostPhase>(() => (window.dbxPlugin ? "boot" : "nohost"));
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [lang, setLang] = useState<Lang>("en");
  const [launch, setLaunch] = useState<HostLaunch | null>(() => getLaunch());

  useEffect(() => subscribeLaunch(setLaunch), []);

  useEffect(() => {
    const bridge = window.dbxPlugin;
    if (!bridge) {
      return;
    }
    let cancelled = false;
    const refresh = () => {
      setTheme(bridge.theme?.appearance === "dark" ? "dark" : "light");
      setLang(pickLang(bridge.locale));
    };
    bridge.ready.then(
      () => {
        if (cancelled) {
          return;
        }
        // The init message may have been dispatched before this bundle ran; the
        // bridge caches the context it resolved `ready` with, so pull it back.
        if (primeLaunchFromBridge()) {
          console.warn("[app] dbx-plugin-init was missed; surface inferred from the host context");
        }
        refresh();
        void ensureFonts();
        setPhase("ready");
      },
      () => {
        if (!cancelled) {
          setPhase("nohost");
        }
      },
    );
    // The bridge dispatches these on `document`, and a CustomEvent does not
    // bubble to `window`, so a window listener never fires.
    document.addEventListener("dbx-plugin-env", refresh);
    return () => {
      cancelled = true;
      document.removeEventListener("dbx-plugin-env", refresh);
    };
  }, []);

  return { phase, theme, lang, launch };
}
