import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { EditorPage } from "./EditorPage";
import { HomePage } from "./HomePage";
import { ResultViewPage } from "./ResultViewPage";
import { readResultSet } from "./host";
import { strings } from "./i18n";
import { useHostSession } from "./useHostSession";
import type { DocumentMeta } from "./types";

type View = { name: "result" } | { name: "home" } | { name: "editor"; id: string };

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
  const { phase, theme, lang, launch } = useHostSession();
  // Null until the user navigates; the launch decides the initial surface.
  const [view, setView] = useState<View | null>(null);
  const t = strings[lang];

  // Memoized on the launch: readResultSet builds a fresh object, and handing a
  // new one down on every render would re-run the scene layout behind the
  // result view.
  const resultSet = useMemo(
    () => (launch?.surface === "result-view" ? readResultSet(launch.context) : null),
    [launch],
  );

  // No need to wait for `launch` here: the bridge resolves `ready` and then
  // dispatches `dbx-plugin-init` synchronously in the same tick (and the hook
  // primes from the cached context otherwise). A host that sends neither simply
  // falls through to the workbench.
  if (phase === "boot") {
    return null;
  }

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

  const current: View = view ?? (resultSet ? { name: "result" } : { name: "home" });
  const openDocument = (meta: DocumentMeta) => setView({ name: "editor", id: meta.id });
  const back = () => setView({ name: "home" });

  return (
    <ErrorBoundary>
      <div className="app-root" data-theme={theme}>
        {/* The result surface is only reachable through the host's toolbar, so a
            tab opened for it needs its own way back after browsing the library. */}
        {resultSet && current.name !== "result" && (
          <button type="button" className="btn result-view__return" onClick={() => setView({ name: "result" })}>
            ← {t.resultViewTitle}
          </button>
        )}
        {current.name === "result" && resultSet && (
          <ResultViewPage t={t} data={resultSet} onOpen={openDocument} onBrowse={back} />
        )}
        {current.name === "home" && <HomePage lang={lang} t={t} onOpen={openDocument} />}
        {current.name === "editor" && (
          <EditorPage
            key={current.id}
            docId={current.id}
            theme={theme}
            lang={lang}
            t={t}
            onBack={back}
            onMetaChange={() => {
              /* Home reloads its list on mount; nothing to propagate live. */
            }}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
