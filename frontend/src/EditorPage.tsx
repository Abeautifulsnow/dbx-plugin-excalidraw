import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { getSceneVersion } from "@excalidraw/excalidraw";
import type { AppState, BinaryFileData, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { api } from "./api";
import { exportScene, saveSceneViaHost, type ExportKind } from "./export";
import { ExcalidrawEditor } from "./ExcalidrawEditor";
import {
  buildImageInsert,
  ClipboardError,
  copySceneToClipboard,
  readClipboardImage,
  readSceneFromClipboard,
  sceneCenter,
  type Offset,
} from "./clipboard";
import { revealInFileManager, type RevealTarget } from "./fileManager";
import { loadDocument, persistScene } from "./persistence";
import type { DocumentMeta } from "./types";
import { excalidrawLangCode, format, type Strings } from "./i18n";

type SaveStatus = "saved" | "dirty" | "saving" | "error";
type Phase = "loading" | "ready" | "corrupt" | "error";
/** Where an export lands: the plugin's own folder, or wherever the user picks. */
type ExportDelivery = "folder" | "dialog";
/**
 * The last export that reached the disk, kept on screen until the user
 * dismisses it. A toast is too short-lived for the one fact the user cannot
 * rediscover from inside the plugin — where the file actually went.
 */
type ExportReceipt = { message: string; inPluginFolder: boolean };
/** The live scene, as the editor last reported it. */
type SceneSnapshot = { elements: readonly ExcalidrawElement[]; appState: AppState };

interface ExportMenuActions {
  exportAs: (kind: ExportKind, delivery: ExportDelivery) => void;
  reveal: (target: RevealTarget) => void;
  copyJson: () => void;
}

/**
 * The export menu's actions — the only part of the editor that talks to the host
 * and the sidecar. Kept out of the component so its body stays a description of
 * what is on screen; every dependency is passed in because none of it is state
 * the render needs.
 *
 * Three report channels: `reportReceipt` carries the location of a file that
 * is now on disk and stays until dismissed, `report` carries a transient
 * failure, and `reportInfo` a transient confirmation (for news like a
 * clipboard write that cannot be rediscovered later either).
 */
function useExportMenuActions(params: {
  meta: DocumentMeta | null;
  snapshot: RefObject<SceneSnapshot | null>;
  files: () => Record<string, BinaryFileData>;
  t: Strings;
  report: (message: string) => void;
  reportInfo: (message: string) => void;
  /** Only ever called with a location that is now on disk. */
  reportReceipt: (receipt: ExportReceipt) => void;
  closeMenu: () => void;
}): ExportMenuActions {
  const { meta, snapshot, files, t, report, reportInfo, reportReceipt, closeMenu } = params;

  const exportAs = async (kind: ExportKind, delivery: ExportDelivery) => {
    closeMenu();
    const current = snapshot.current;
    if (!current || !meta) {
      return;
    }
    const { elements, appState } = current;
    const referenced = files();

    // The previous receipt is left alone until this attempt actually lands a
    // file: a cancelled dialog and a failed write both leave that earlier file
    // on disk, so erasing its location up front would lose the only record of
    // it. Nothing shows a path that is not on disk, because only a success
    // reaches `reportReceipt`.

    // The plugin folder is the default and the fallback: it is the only delivery
    // whose bytes have been verified end to end. "Save as…" asks the host for its
    // native dialog instead, and lands in the plugin folder when the host cannot
    // provide one — the fallback message says what happened without guessing
    // which failure it was, since a rejected write arrives here too.
    if (delivery === "dialog") {
      try {
        const path = await saveSceneViaHost(kind, meta.name, elements, appState, referenced);
        // A null path is the user dismissing the dialog, which is not a failure
        // and needs no message.
        if (path) {
          reportReceipt({ message: format(t.exportSavedPath, path), inPluginFolder: false });
        }
        return;
      } catch (error) {
        console.error("[editor] system save dialog failed; falling back to the plugin folder", error);
      }
    }

    try {
      const path = await exportScene(kind, meta.name, elements, appState, referenced);
      const template = delivery === "dialog" ? t.exportSaveDialogFallback : t.exportSavedPath;
      reportReceipt({ message: format(template, path), inPluginFolder: true });
    } catch (error) {
      console.error("[editor] export failed", error);
      report(t.exportFailed);
    }
  };

  const copyJson = async () => {
    closeMenu();
    const current = snapshot.current;
    if (!current || !meta) {
      return;
    }
    try {
      await copySceneToClipboard(current.elements, current.appState, files());
      reportInfo(t.copySceneDone);
    } catch (error) {
      console.error("[editor] scene copy failed", error);
      report(t.copySceneFailed);
    }
  };

  const reveal = async (target: RevealTarget) => {
    closeMenu();
    try {
      await revealInFileManager(target);
    } catch (error) {
      console.error("[editor] could not open the DBX file manager", error);
      report(t.revealFailed);
    }
  };

  return {
    exportAs: (kind, delivery) => void exportAs(kind, delivery),
    reveal: (target) => void reveal(target),
    copyJson: () => void copyJson(),
  };
}

const AUTOSAVE_DELAY_MS = 1000;

/** Transient toast: failures in the error variant, confirmations in info. */
type Toast = { variant: "info" | "error"; message: string };

/** A pasted scene is nudged so it does not land exactly on existing content. */
const PASTE_NUDGE: Offset = { x: 32, y: 32 };

interface EditorPageProps {
  docId: string;
  theme: "light" | "dark";
  /** The host locale verbatim; the editor ships more translations than we do. */
  locale: string;
  t: Strings;
  onBack: () => void;
  onMetaChange: (meta: DocumentMeta) => void;
}

export function EditorPage({ docId, theme, locale, t, onBack, onMetaChange }: EditorPageProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [titleDraft, setTitleDraft] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [receipt, reportReceipt] = useState<ExportReceipt | null>(null);
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
      setToast({ variant: "error", message: t.renameFailed });
    }
  };

  const actions = useExportMenuActions({
    meta,
    snapshot: latestRef,
    files: referencedFiles,
    t,
    report: (message) => setToast({ variant: "error", message }),
    reportInfo: (message) => setToast({ variant: "info", message }),
    reportReceipt,
    closeMenu: () => setExportOpen(false),
  });

  // The clipboard reads exist only on hosts that advertise them (init-frame
  // capability keys, absent keys meaning unsupported), so the paste menu hides
  // itself rather than offering entries that can only fail. The copy entry in
  // the export menu stays visible everywhere: it degrades through `copy`.
  const capabilities = window.dbxPlugin?.capabilities;
  const canReadClipboard = capabilities?.clipboardRead === true;
  const canReadClipboardImage = capabilities?.clipboardImageRead === true;

  const pasteFailureMessage = (error: unknown): string =>
    error instanceof ClipboardError && error.code === "INVALID_SCENE" ? t.pasteSceneInvalid : t.pasteFailed;

  const pasteSceneFromClipboard = async () => {
    setPasteOpen(false);
    const instance = apiRef.current;
    if (!instance) {
      return;
    }
    // The offset decision can use the pre-await snapshot, but the merge must
    // not: a clipboard read can wait out the host's rate limit, and merging a
    // stale array would silently drop whatever was drawn in the meantime.
    const canvasWasEmpty = !latestRef.current || latestRef.current.elements.length === 0;
    try {
      const pasted = await readSceneFromClipboard(canvasWasEmpty ? { x: 0, y: 0 } : PASTE_NUDGE);
      const pastedFiles = Object.values(pasted.files);
      if (pastedFiles.length > 0) {
        instance.addFiles(pastedFiles);
      }
      instance.updateScene({ elements: [...(latestRef.current?.elements ?? []), ...pasted.elements] });
      setToast({ variant: "info", message: format(t.pasteSceneDone, pasted.elements.length) });
    } catch (error) {
      console.error("[editor] scene paste failed", error);
      setToast({ variant: "error", message: pasteFailureMessage(error) });
    }
  };

  const pasteImageFromClipboard = async () => {
    setPasteOpen(false);
    const instance = apiRef.current;
    if (!instance || !meta) {
      return;
    }
    try {
      const image = await readClipboardImage();
      const position = sceneCenter(latestRef.current?.elements ?? []);
      const insert = await buildImageInsert(meta.id, image, position);
      instance.addFiles([insert.file]);
      instance.updateScene({ elements: [...(latestRef.current?.elements ?? []), insert.element] });
      setToast({ variant: "info", message: t.pasteImageDone });
    } catch (error) {
      console.error("[editor] image paste failed", error);
      setToast({ variant: "error", message: pasteFailureMessage(error) });
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
        {canReadClipboard && (
          <div className="export-menu">
            <button type="button" className="btn btn--ghost" onClick={() => setPasteOpen((open) => !open)} aria-haspopup="menu" aria-expanded={pasteOpen}>
              {t.paste} ▾
            </button>
            {pasteOpen && (
              <>
                <div className="export-menu__overlay" onClick={() => setPasteOpen(false)} />
                <div className="export-menu__list" role="menu">
                  <button type="button" role="menuitem" onClick={() => void pasteSceneFromClipboard()}>
                    {t.pasteScene}
                  </button>
                  {canReadClipboardImage && (
                    <button type="button" role="menuitem" onClick={() => void pasteImageFromClipboard()}>
                      {t.pasteImage}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <div className="export-menu">
          <button type="button" className="btn btn--ghost" onClick={() => setExportOpen((open) => !open)} aria-haspopup="menu" aria-expanded={exportOpen}>
            {t.export} ▾
          </button>
          {exportOpen && (
            <>
              <div className="export-menu__overlay" onClick={() => setExportOpen(false)} />
              <div className="export-menu__list" role="menu">
                <button type="button" role="menuitem" onClick={() => actions.exportAs("excalidraw", "folder")}>
                  {t.exportExcalidraw}
                </button>
                <button type="button" role="menuitem" onClick={() => actions.exportAs("png", "folder")}>
                  {t.exportPng}
                </button>
                <button type="button" role="menuitem" onClick={() => actions.exportAs("svg", "folder")}>
                  {t.exportSvg}
                </button>
                <div className="export-menu__separator" role="separator" />
                <button type="button" role="menuitem" onClick={() => actions.exportAs("excalidraw", "dialog")}>
                  {t.saveAsExcalidraw}
                </button>
                <button type="button" role="menuitem" onClick={() => actions.exportAs("png", "dialog")}>
                  {t.saveAsPng}
                </button>
                <button type="button" role="menuitem" onClick={() => actions.exportAs("svg", "dialog")}>
                  {t.saveAsSvg}
                </button>
                <div className="export-menu__separator" role="separator" />
                <button type="button" role="menuitem" onClick={() => actions.reveal("exports")}>
                  {t.openExportsFolder}
                </button>
                <div className="export-menu__separator" role="separator" />
                <button type="button" role="menuitem" onClick={() => actions.copyJson()}>
                  {t.copySceneJson}
                </button>
              </div>
            </>
          )}
        </div>
      </header>
      {receipt && (
        <div className="export-receipt" role="status">
          <span className="export-receipt__message">{receipt.message}</span>
          {receipt.inPluginFolder && (
            <button type="button" className="btn btn--ghost" onClick={() => actions.reveal("exports")}>
              {t.openExportsFolder}
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            aria-label={t.dismiss}
            title={t.dismiss}
            onClick={() => reportReceipt(null)}
          >
            ×
          </button>
        </div>
      )}
      {initialData && (
        <ExcalidrawEditor
          initialData={initialData}
          theme={theme}
          langCode={excalidrawLangCode(locale)}
          onChange={handleChange}
          onExternalFileDrop={() => setToast({ variant: "error", message: t.dropBlocked })}
          onApi={(instance) => {
            apiRef.current = instance;
          }}
        />
      )}
      {toast && <div className={`toast toast--${toast.variant}`}>{toast.message}</div>}
    </div>
  );
}
