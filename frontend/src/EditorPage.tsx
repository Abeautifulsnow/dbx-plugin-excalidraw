import { useCallback, useEffect, useRef, useState } from "react";
import { getSceneVersion } from "@excalidraw/excalidraw";
import type { AppState, BinaryFileData, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { api } from "./api";
import { exportScene, type ExportKind } from "./export";
import { ExcalidrawEditor } from "./ExcalidrawEditor";
import { loadDocument, persistScene } from "./persistence";
import type { DocumentMeta } from "./types";
import { format, type Lang, type Strings } from "./i18n";

type SaveStatus = "saved" | "dirty" | "saving" | "error";
type Phase = "loading" | "ready" | "corrupt" | "error";
type Toast = { message: string; kind: "error" | "success" };

const AUTOSAVE_DELAY_MS = 1000;

interface EditorPageProps {
  docId: string;
  theme: "light" | "dark";
  lang: Lang;
  t: Strings;
  onBack: () => void;
  onMetaChange: (meta: DocumentMeta) => void;
}

export function EditorPage({ docId, theme, lang, t, onBack, onMetaChange }: EditorPageProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [titleDraft, setTitleDraft] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const latestRef = useRef<{ elements: readonly ExcalidrawElement[]; appState: AppState } | null>(null);
  const filesCacheRef = useRef<Map<string, BinaryFileData>>(new Map());
  const lastSavedVersionRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const rerunRef = useRef(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadDocument(docId);
        if (cancelled) {
          return;
        }
        // Seed the cache with unavailable hash entries too, so the next save
        // re-emits the original asset reference instead of dropping it.
        filesCacheRef.current = new Map(
          Object.entries({ ...loaded.files, ...loaded.unavailableFiles }) as [string, BinaryFileData][],
        );
        lastSavedVersionRef.current = getSceneVersion(loaded.elements);
        setMeta(loaded.meta);
        setTitleDraft(loaded.meta.name);
        setInitialData({ elements: loaded.elements, appState: loaded.appState, files: loaded.files });
        setPhase("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("[editor] load failed", error);
        setPhase(error instanceof Error && error.name === "ApiError" && (error as { code?: string }).code === "DOCUMENT_CORRUPT" ? "corrupt" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // Files referenced by image elements are reconstructed from the in-memory
  // cache at save time; newly pasted/dropped images are merged in onChange.
  const referencedFiles = useCallback((): Record<string, BinaryFileData> => {
    const snapshot = latestRef.current;
    if (!snapshot) {
      return {};
    }
    const ids = new Set<string>();
    for (const element of snapshot.elements) {
      if (element.type === "image" && element.fileId) {
        ids.add(element.fileId);
      }
    }
    const files: Record<string, BinaryFileData> = {};
    for (const id of ids) {
      const file = filesCacheRef.current.get(id);
      if (file) {
        files[id] = file;
      }
    }
    return files;
  }, []);

  // Serialized save queue: a slow save can never let an older scene overwrite
  // a newer one (PRD §28); changes during a save trigger exactly one rerun.
  const runSave = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) {
      rerunRef.current = true;
      return;
    }
    const snapshot = latestRef.current;
    if (!snapshot || !meta) {
      return;
    }
    inFlightRef.current = true;
    setSaveStatus("saving");
    try {
      const updated = await persistScene(docId, snapshot.elements, snapshot.appState, referencedFiles());
      const savedVersion = getSceneVersion(snapshot.elements);
      lastSavedVersionRef.current = savedVersion;
      // An edit can land while the save is in flight; derive dirtiness from
      // the live scene instead of the queue flag so it can never be clobbered
      // by a completing save (which used to silently drop the last edit).
      const pending =
        rerunRef.current || (latestRef.current ? getSceneVersion(latestRef.current.elements) !== savedVersion : false);
      dirtyRef.current = pending;
      setSaveStatus(pending ? "dirty" : "saved");
      if (!rerunRef.current) {
        setMeta((previous) => (previous ? { ...previous, updatedAt: updated.updatedAt } : previous));
      }
      // rerunRef is deliberately left set: the finally block below re-runs
      // the save so mid-flight edits are persisted exactly one more time.
    } catch (error) {
      console.error("[editor] save failed", error);
      dirtyRef.current = true;
      setSaveStatus("error");
    } finally {
      inFlightRef.current = false;
      if (rerunRef.current) {
        rerunRef.current = false;
        void runSave();
      }
    }
  }, [docId, meta, referencedFiles]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => void runSave(), AUTOSAVE_DELAY_MS);
  }, [runSave]);

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      latestRef.current = { elements, appState };
      const instance = apiRef.current;
      if (instance?.getFiles) {
        for (const [id, file] of Object.entries(instance.getFiles())) {
          if (file && typeof file.dataURL === "string") {
            filesCacheRef.current.set(id, file as BinaryFileData);
          }
        }
      }
      // Ignore echoes that did not change the scene (initial mount, appState-only updates).
      if (getSceneVersion(elements) === lastSavedVersionRef.current) {
        return;
      }
      dirtyRef.current = true;
      setSaveStatus("dirty");
      scheduleSave();
    },
    [scheduleSave],
  );

  // Teardown flush is best-effort; debounced autosave is the primary safety net.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (dirtyRef.current) {
        void runSave();
      }
    };
  }, [runSave]);

  // Destroying the webview skips React unmount cleanups entirely, so up to
  // one autosave interval of edits could be lost on window close. Best-effort
  // flush on pagehide; runSave already handles re-entry during an in-flight
  // save, and the bridge call may outlive the page just long enough to land.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) {
        void runSave();
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [runSave]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const handle = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(handle);
  }, [toast]);

  const commitTitle = async () => {
    if (!meta) {
      return;
    }
    const name = titleDraft.trim().slice(0, 255);
    if (!name || name === meta.name) {
      setTitleDraft(meta.name);
      return;
    }
    try {
      const updated = await api.renameDocument(meta.id, name);
      setMeta(updated);
      setTitleDraft(updated.name);
      onMetaChange(updated);
    } catch (error) {
      console.error("[editor] rename failed", error);
      setTitleDraft(meta.name);
      setToast({ message: t.renameFailed, kind: "error" });
    }
  };

  const handleExport = async (kind: ExportKind) => {
    setExportOpen(false);
    const snapshot = latestRef.current;
    if (!snapshot || !meta) {
      return;
    }
    try {
      const path = await exportScene(kind, meta.name, snapshot.elements, snapshot.appState, referencedFiles());
      setToast({ message: format(t.exportSavedPath, path), kind: "success" });
    } catch (error) {
      console.error("[editor] export failed", error);
      setToast({ message: t.exportFailed, kind: "error" });
    }
  };

  if (phase === "loading") {
    return (
      <div className="editor editor--placeholder">
        <div className="spinner" aria-label={t.saving} />
      </div>
    );
  }

  if (phase === "corrupt" || phase === "error") {
    return (
      <div className="editor editor--placeholder">
        <div className="notice">
          <h2>{phase === "corrupt" ? t.corruptTitle : t.openFailed}</h2>
          <p>{phase === "corrupt" ? t.corruptBody : t.openFailedBody}</p>
          <button type="button" className="btn" onClick={onBack}>
            {t.back}
          </button>
        </div>
      </div>
    );
  }

  const statusText =
    saveStatus === "saved" ? t.saved : saveStatus === "saving" ? t.saving : saveStatus === "dirty" ? t.unsaved : t.saveFailed;

  return (
    <div className="editor" data-theme={theme}>
      <header className="editor-header">
        <button type="button" className="btn btn--ghost btn--icon" onClick={onBack} aria-label={t.back} title={t.back}>
          ←
        </button>
        <input
          className="editor-title"
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setTitleDraft(meta?.name ?? "");
              event.currentTarget.blur();
            }
          }}
          aria-label={t.renameTitle}
          spellCheck={false}
        />
        <span className={`save-status save-status--${saveStatus}`} role="status">
          {statusText}
        </span>
        <div className="export-menu">
          <button type="button" className="btn btn--ghost" onClick={() => setExportOpen((open) => !open)} aria-haspopup="menu" aria-expanded={exportOpen}>
            {t.export} ▾
          </button>
          {exportOpen && (
            <>
              <div className="export-menu__overlay" onClick={() => setExportOpen(false)} />
              <div className="export-menu__list" role="menu">
                <button type="button" role="menuitem" onClick={() => void handleExport("excalidraw")}>
                  {t.exportExcalidraw}
                </button>
                <button type="button" role="menuitem" onClick={() => void handleExport("png")}>
                  {t.exportPng}
                </button>
                <button type="button" role="menuitem" onClick={() => void handleExport("svg")}>
                  {t.exportSvg}
                </button>
              </div>
            </>
          )}
        </div>
      </header>
      {initialData && (
        <ExcalidrawEditor
          initialData={initialData}
          theme={theme}
          langCode={lang === "zh" ? "zh-CN" : "en"}
          onChange={handleChange}
          onExternalFileDrop={() => setToast({ message: t.dropBlocked, kind: "error" })}
          onApi={(instance) => {
            apiRef.current = instance;
          }}
        />
      )}
      {toast && <div className={`toast toast--${toast.kind}`}>{toast.message}</div>}
    </div>
  );
}
