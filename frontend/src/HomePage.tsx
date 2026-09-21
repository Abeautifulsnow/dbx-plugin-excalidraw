import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { persistImportedScene } from "./persistence";
import { setPref, usePrefs } from "./prefs";
import type { DocumentMeta } from "./types";
import { format, type Lang, type Strings } from "./i18n";

/**
 * The home screen's filter term, remembered across sessions.
 *
 * Derived from the store rather than seeded into state, so a preference that
 * arrives after this mounted still applies. Writes are delayed so a burst of
 * typing is one backend round-trip instead of one per character, and flushed on
 * unmount — opening a diagram is exactly what ends the typing, and a lost flush
 * would drop the last thing the user searched for.
 */
function useRememberedSearch(): [string, (value: string) => void] {
  const prefs = usePrefs();
  const [draft, setDraft] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current !== null) {
      setPref("homeSearch", pendingRef.current);
      pendingRef.current = null;
    }
  };

  const change = (value: string) => {
    setDraft(value);
    pendingRef.current = value;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(flush, SEARCH_PREF_DELAY_MS);
  };

  useEffect(() => flush, []);

  return [draft ?? prefs.homeSearch ?? "", change];
}

interface HomePageProps {
  lang: Lang;
  t: Strings;
  onOpen: (meta: DocumentMeta) => void;
}

/** Long enough that a burst of typing writes once, short enough that it feels immediate on leaving. */
const SEARCH_PREF_DELAY_MS = 600;

export function HomePage({ lang, t, onOpen }: HomePageProps) {
  const [documents, setDocuments] = useState<DocumentMeta[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, changeQuery] = useRememberedSearch();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ meta: DocumentMeta; value: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentMeta | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoadError(false);
    try {
      const response = await api.listDocuments();
      setDocuments(response.items);
    } catch (error) {
      console.error("[home] list failed", error);
      setDocuments(null);
      setLoadError(true);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const handle = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(handle);
  }, [toast]);

  const filtered = useMemo(() => {
    if (!documents) {
      return [];
    }
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return documents;
    }
    return documents.filter((meta) => meta.name.toLowerCase().includes(needle));
  }, [documents, query]);

  const createDocument = async () => {
    setBusy(true);
    try {
      const meta = await api.createDocument("");
      onOpen(meta);
    } catch (error) {
      console.error("[home] create failed", error);
      setToast(t.createFailed);
    } finally {
      setBusy(false);
    }
  };

  // Import parses and validates in the frontend, then persists through the
  // same document RPCs the editor uses; the backend never touches the
  // user's filesystem (PRD §14.2, §32.2).
  const importFile = async (file: File) => {
    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new ApiError("INVALID_SCENE", t.importInvalid);
      }
      const scene = parsed as { elements?: unknown };
      if (typeof parsed !== "object" || parsed === null || !Array.isArray(scene.elements)) {
        throw new ApiError("INVALID_SCENE", t.importInvalid);
      }
      const meta = await api.createDocument(file.name.replace(/\.excalidraw$/i, ""));
      await persistImportedScene(meta.id, scene as Parameters<typeof persistImportedScene>[1]);
      onOpen(meta);
    } catch (error) {
      console.error("[home] import failed", error);
      setToast(error instanceof ApiError && error.code === "INVALID_SCENE" ? t.importInvalid : t.importFailed);
    } finally {
      setBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const confirmRename = async () => {
    if (!renameTarget) {
      return;
    }
    const name = renameTarget.value.trim().slice(0, 255);
    if (!name) {
      return;
    }
    try {
      await api.renameDocument(renameTarget.meta.id, name);
      setRenameTarget(null);
      await refresh();
    } catch (error) {
      console.error("[home] rename failed", error);
      setToast(t.renameFailed);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      await api.deleteDocument(deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      console.error("[home] delete failed", error);
      setToast(t.deleteFailed);
    }
  };

  return (
    <div className="home">
      <header className="home-header">
        <h1 className="home-title">{t.productName}</h1>
        <div className="home-actions">
          <button type="button" className="btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {t.import}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void createDocument()} disabled={busy}>
            {t.newDiagram}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".excalidraw,application/json"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void importFile(file);
              }
            }}
          />
        </div>
      </header>

      <div className="home-toolbar">
        <input
          type="search"
          className="input home-search"
          placeholder={t.searchPlaceholder}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          aria-label={t.searchPlaceholder}
        />
      </div>

      {loadError && (
        <div className="notice">
          <p>{t.loadFailed}</p>
          <button type="button" className="btn" onClick={() => void refresh()}>
            {t.retry}
          </button>
        </div>
      )}

      {!loadError && documents !== null && documents.length === 0 && (
        <div className="empty">
          <div className="empty__icon" aria-hidden="true">
            ✏️
          </div>
          <h2>{t.emptyTitle}</h2>
          <p>{t.emptyBody}</p>
          <div className="empty__actions">
            <button type="button" className="btn btn--primary" onClick={() => void createDocument()} disabled={busy}>
              {t.newDiagram}
            </button>
            <button type="button" className="btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              {t.import}
            </button>
          </div>
        </div>
      )}

      {!loadError && filtered.length > 0 && (
        <section className="home-grid" aria-label={t.recent}>
          {filtered.map((meta) => (
            <article key={meta.id} className="card" onClick={() => onOpen(meta)}>
              <div className="card__preview" aria-hidden="true">
                <svg viewBox="0 0 16 16" className="card__glyph">
                  <rect x="2" y="2" width="5" height="4" rx="1" />
                  <rect x="9" y="10" width="5" height="4" rx="1" />
                  <path d="M4.5 6v3a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </div>
              <div className="card__body">
                <div className="card__name" title={meta.name}>
                  {meta.name}
                </div>
                <div className="card__time">{relativeTime(meta.updatedAt, lang, t)}</div>
              </div>
              <div className="card__menu" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  title={t.rename}
                  aria-label={`${t.rename}: ${meta.name}`}
                  onClick={() => setRenameTarget({ meta, value: meta.name })}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--danger"
                  title={t.delete}
                  aria-label={`${t.delete}: ${meta.name}`}
                  onClick={() => setDeleteTarget(meta)}
                >
                  🗑
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {renameTarget && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={t.renameTitle}>
          <div className="modal__panel">
            <h2>{t.renameTitle}</h2>
            <input
              className="input"
              value={renameTarget.value}
              autoFocus
              onChange={(event) => setRenameTarget({ ...renameTarget, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void confirmRename();
                }
                if (event.key === "Escape") {
                  setRenameTarget(null);
                }
              }}
            />
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setRenameTarget(null)}>
                {t.cancel}
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void confirmRename()}>
                {t.rename}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={t.deleteTitle}>
          <div className="modal__panel">
            <h2>
              {t.deleteTitle} “{deleteTarget.name}”?
            </h2>
            <p>{t.deleteBody}</p>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setDeleteTarget(null)}>
                {t.cancel}
              </button>
              <button type="button" className="btn btn--danger" onClick={() => void confirmDelete()}>
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast toast--error">{toast}</div>}
    </div>
  );
}

function relativeTime(iso: string, lang: Lang, t: Strings): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) {
    return t.justNow;
  }
  if (minutes < 60) {
    return format(t.minutesAgo, minutes);
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return format(t.hoursAgo, hours);
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return format(t.daysAgo, days);
  }
  return new Date(timestamp).toLocaleDateString(lang === "zh" ? "zh-CN" : "en");
}
