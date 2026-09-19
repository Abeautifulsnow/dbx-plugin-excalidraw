import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { EditorPage } from "./EditorPage";
import { HomePage } from "./HomePage";
import { ensureFonts } from "./fonts";
import { pickLang, strings, type Lang } from "./i18n";
import type { DocumentMeta } from "./types";

type Phase = "boot" | "ready" | "nohost";
type View = { name: "home" } | { name: "editor"; id: string };

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[app] unhandled error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="editor editor--placeholder">
          <div className="notice">
            <h2>Something went wrong</h2>
            <pre className="notice__detail">{this.state.error.message}</pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [phase, setPhase] = useState<Phase>(() => (window.dbxPlugin ? "boot" : "nohost"));
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [lang, setLang] = useState<Lang>("en");
  const [view, setView] = useState<View>({ name: "home" });

  useEffect(() => {
    if (!window.dbxPlugin) {
      return;
    }
    let cancelled = false;
    const refresh = () => {
      const bridge = window.dbxPlugin;
      if (!bridge) {
        return;
      }
      setTheme(bridge.theme?.appearance === "dark" ? "dark" : "light");
      setLang(pickLang(bridge.locale));
    };
    window.dbxPlugin.ready.then(
      () => {
        if (!cancelled) {
          refresh();
          void ensureFonts();
          setPhase("ready");
        }
      },
      () => {
        if (!cancelled) {
          setPhase("nohost");
        }
      },
    );
    window.addEventListener("dbx-plugin-env", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("dbx-plugin-env", refresh);
    };
  }, []);

  if (phase === "boot") {
    return null;
  }

  const t = strings[lang];

  if (phase === "nohost") {
    return (
      <div className="editor editor--placeholder">
        <div className="notice">
          <h2>{t.backendMissing}</h2>
          <p>{t.backendMissingBody}</p>
        </div>
      </div>
    );
  }

  const openDocument = (meta: DocumentMeta) => setView({ name: "editor", id: meta.id });

  return (
    <ErrorBoundary>
      <div className="app-root" data-theme={theme}>
        {view.name === "home" ? (
          <HomePage lang={lang} t={t} onOpen={openDocument} />
        ) : (
          <EditorPage
            key={view.id}
            docId={view.id}
            theme={theme}
            lang={lang}
            t={t}
            onBack={() => setView({ name: "home" })}
            onMetaChange={() => {
              /* Home reloads its list on mount; nothing to propagate live. */
            }}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
