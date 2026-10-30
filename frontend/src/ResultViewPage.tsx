import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { withCause } from "./errors";
import { revealInFileManager } from "./fileManager";
import { persistImportedScene } from "./persistence";
import { setPref, usePrefs } from "./prefs";
import {
  appendPlacement,
  buildGridScene,
  cellText,
  deriveName,
  makeIdPrefix,
  mergeGridIntoScene,
  resolveRowLimit,
  rowChoices,
  sceneBounds,
  uniqueGridTitle,
  type GridSceneResult,
  type MergeOutcome,
  type ResultGrid,
  type StoredSceneLike,
} from "./resultScene";
import { buildPlanAiContext, buildPlanScene, parsePlan, type ParsedPlan } from "./plan";
import { buildResultAiSnapshot } from "./resultAi";
import { planRecommendations, resultRecommendations, setAiRecommendations } from "./aiRecommendations";
import { useAiRecommendations } from "./useAiRecommendations";
import { formatAll, relativeTime, type Lang, type Strings } from "./i18n";
import type { DocumentMeta, ResultSetContext } from "./types";

interface ResultViewPageProps {
  t: Strings;
  /** For the append picker's timestamps; the host locale, verbatim. */
  lang: Lang;
  /** Memoized by the caller: a fresh object per render would defeat the memos below. */
  data: ResultSetContext;
  onOpen: (meta: DocumentMeta) => void;
  onBrowse: () => void;
}

const PREVIEW_ROWS = 8;
const PREVIEW_COLUMNS = 8;

/**
 * The page's one busy/failure slot for every host-facing action: it always
 * describes the last thing the user tried, whichever action hook ran it.
 */
function useActionSlot(): ActionSlot {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return { busy, setBusy, failure, setFailure };
}

/**
 * T-B: while this tab holds a result set, seed the AI panel's suggestion
 * chips with result-interpretation prompts — they ride the same context the
 * host already gave this tab. An empty tab is a plain canvas and clears
 * instead, like every other view without data to talk about. The hook
 * re-asserts the stance on every visibilitychange, since the host keeps
 * this webview mounted behind display:none while another tab is front.
 */
function useResultViewRecommendations(hasResult: boolean, t: Strings): void {
  const viewRecommendations = useMemo(
    () => (hasResult ? resultRecommendations(t) : null),
    [hasResult, t],
  );
  useAiRecommendations(viewRecommendations);
}

export function ResultViewPage({ t, lang, data, onOpen, onBrowse }: ResultViewPageProps) {
  const prefs = usePrefs();
  // The append dialog shares the prepared grid and the SQL caption with the
  // standalone preview, so both paths lay out exactly what the page shows.
  const [appendOpen, setAppendOpen] = useState(false);
  const closeAppend = useCallback(() => setAppendOpen(false), []);
  const availableRows = data.result.rows.length;
  // Null until the user picks a count on this result; the remembered preference
  // is applied through resolveRowLimit, which tolerates arriving late.
  const [chosenRows, setChosenRows] = useState<number | null>(null);
  const rowLimit = resolveRowLimit(availableRows, prefs.resultRows, chosenRows);

  const hasResult = data.result.columns.length > 0 || availableRows > 0;
  const title = deriveName(data.sql) || t.resultViewTitle;

  // The cells are flattened to display text once; the preview and the append
  // merge must never disagree about what is going on the canvas.
  const grid = useMemo(
    () => ({ columns: data.result.columns, rows: data.result.rows.map((row) => row.map(cellText)) }),
    [data],
  );
  const caption = data.sql.replace(/\s+/g, " ").trim() || undefined;

  // What the canvas will actually hold. Building the layout here rather than
  // only on submit keeps the preview honest: the scene builder drops rows to fit
  // its byte budget and columns beyond its cap, and the page must say so instead
  // of repeating the requested counts back at the user.
  const layout = useMemo(
    () => buildGridScene(grid, { title, caption, maxRows: rowLimit }),
    [grid, rowLimit, title, caption],
  );

  const changeRowLimit = (rows: number) => {
    setChosenRows(rows);
    setPref("resultRows", rows);
  };

  // The plan surface needs the plan API capability, a connection to ask, and
  // SQL to explain; any of the three missing hides the button rather than
  // disabling it, because on a host without the API the button could never
  // succeed.
  const planReady =
    typeof window !== "undefined" &&
    window.dbxPlugin?.capabilities?.planApi === true &&
    data.connectionId !== "" &&
    data.sql.trim() !== "";
  // The AI explain rides on the same plan pipeline but opens the host's
  // built-in AI panel instead of drawing; it only exists where the host
  // advertises the ai capability, otherwise the button could never succeed.
  const aiExplainReady =
    planReady && typeof window !== "undefined" && window.dbxPlugin?.capabilities?.ai === true;
  // Unlike the plan handoff this needs no connection or SQL beyond what the
  // page already shows: the snapshot is the result set itself.
  const dataAiReady = typeof window !== "undefined" && window.dbxPlugin?.capabilities?.ai === true;
  const slot = useActionSlot();
  const { busy, failure } = slot;

  const actions = useResultViewActions({
    connectionId: data.connectionId,
    database: data.database,
    schema: data.schema,
    sql: data.sql,
    scene: layout.scene,
    slot,
    t,
    onOpen,
  });
  const aiActions = useResultViewAiActions({
    connectionId: data.connectionId,
    database: data.database,
    schema: data.schema,
    sql: data.sql,
    result: data.result,
    slot,
    t,
  });

  useResultViewRecommendations(hasResult, t);

  return (
    <div className="result-view">
      <ResultHeader
        t={t}
        busy={busy}
        canCreate={hasResult}
        canPlan={planReady}
        canAi={aiExplainReady}
        canSendDataAi={dataAiReady}
        onCreate={actions.create}
        onAppend={() => setAppendOpen(true)}
        onPlan={actions.createPlan}
        onExplainAi={aiActions.explainPlanAi}
        onSendDataAi={aiActions.sendDataAi}
        onBrowse={onBrowse}
        onReveal={actions.reveal}
      />

      {!hasResult ? (
        <div className="notice">
          <h2>{t.resultViewNoContext}</h2>
          <p>{t.resultViewNoContextBody}</p>
        </div>
      ) : (
        <>
          <ResultSummary
            t={t}
            data={data}
            layout={layout}
            availableRows={availableRows}
            rowLimit={rowLimit}
            busy={busy}
            onRowLimitChange={changeRowLimit}
          />
          {availableRows === 0 ? (
            <div className="notice">
              <p>{t.resultViewNoRows}</p>
            </div>
          ) : (
            <ResultPreview t={t} data={data} availableRows={availableRows} />
          )}
        </>
      )}

      {appendOpen && (
        <AppendCanvasDialog
          t={t}
          lang={lang}
          grid={grid}
          title={title}
          caption={caption}
          maxRows={rowLimit}
          onOpen={onOpen}
          onClose={closeAppend}
        />
      )}

      {failure && <div className="toast toast--error">{failure}</div>}
    </div>
  );
}

interface ActionSlot {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  failure: string | null;
  setFailure: (message: string | null) => void;
}

interface ResultViewActions {
  create: () => void;
  createPlan: () => void;
  reveal: () => void;
}

interface ResultViewAiActions {
  explainPlanAi: () => void;
  sendDataAi: () => void;
}

/**
 * The page's canvas-facing actions (create, plan-on-canvas, reveal), kept out
 * of the component so its body stays a description of what is rendered rather
 * than a mix of rendering and error plumbing. AI-panel actions live in
 * `useResultViewAiActions`; both share the page's single busy/failure slot, so
 * it always describes the last thing the user tried. The messages stay
 * distinct — "could not create the canvas" and "could not open the file
 * manager" are different problems and are worded as such.
 */
function useResultViewActions(params: {
  connectionId: string;
  database: string;
  /** The tab's schema; the plan EXPLAIN needs it to resolve unqualified names. */
  schema: string;
  sql: string;
  scene: GridSceneResult["scene"];
  slot: ActionSlot;
  t: Strings;
  onOpen: (meta: DocumentMeta) => void;
}): ResultViewActions {
  const { connectionId, database, schema, sql, scene, slot, t, onOpen } = params;
  const { setBusy, setFailure } = slot;

  const create = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const meta = await api.createDocument(deriveName(sql) || "");
      await api.saveScene(meta.id, scene);
      onOpen(meta);
    } catch (cause) {
      console.error("[result-view] create failed", cause);
      setFailure(t.resultViewFailed);
    } finally {
      setBusy(false);
    }
  };

  const createPlan = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const fetched = await fetchPlanMetadata({ connectionId, database, schema, sql }, t);
      if (!fetched.ok) {
        setFailure(fetched.failure);
        return;
      }
      // The plan is on its way to the canvas: pivot the AI panel's chips from
      // result interpretation to plan interpretation before navigation.
      setAiRecommendations(planRecommendations(t));
      const base = deriveName(sql);
      const name = base ? `${base} - plan` : t.planSceneTitle;
      let caption = sql.replace(/\s+/g, " ").trim();
      if (fetched.parsed.truncated) {
        const suffix = formatAll(t.planTruncated, { n: fetched.parsed.includedNodes });
        caption = caption ? `${caption} - ${suffix}` : suffix;
      }
      const planLayout = buildPlanScene(fetched.parsed, {
        title: name,
        caption: caption || undefined,
        warnings:
          fetched.warnings.length > 0
            ? { heading: t.planWarningsHeading, items: fetched.warnings, moreTemplate: t.planWarningsMore }
            : undefined,
      });
      const meta = await api.createDocument(name);
      await api.saveScene(meta.id, planLayout.scene);
      onOpen(meta);
    } catch (cause) {
      console.error("[result-view] plan canvas failed", cause);
      setFailure(withCause(t.planFailed, cause));
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    setFailure(null);
    try {
      await revealInFileManager("documents");
    } catch (cause) {
      console.error("[result-view] could not open the DBX file manager", cause);
      setFailure(t.revealFailed);
    }
  };

  return {
    create: () => void create(),
    createPlan: () => void createPlan(),
    reveal: () => void reveal(),
  };
}

/**
 * One plan fetch shared by the canvas plan and the AI plan handoff, sequential
 * on purpose: capabilities first (a connection without estimated-plan support
 * should say so instead of surfacing a host-side EXPLAIN error), then explain,
 * then parse. The failure comes back ready to render — whichever action ran
 * the pipeline puts it in the shared slot, so a failed EXPLAIN never gets
 * blamed on the AI panel by the canvas path or the other way around.
 */
async function fetchPlanMetadata(
  params: { connectionId: string; database: string; schema: string; sql: string },
  t: Strings,
): Promise<{ ok: true; parsed: ParsedPlan; dbType: string; warnings: string[] } | { ok: false; failure: string }> {
  const { connectionId, database, schema, sql } = params;
  const bridge = window.dbxPlugin;
  if (!bridge?.getPlanCapabilities || !bridge.explainPlan) {
    return { ok: false, failure: t.planFailed };
  }
  try {
    const caps = await bridge.getPlanCapabilities(connectionId);
    if (!caps?.supports?.estimatedPlan) {
      return { ok: false, failure: t.planUnsupported };
    }
    const result = await bridge.explainPlan({
      connectionId,
      database: database || undefined,
      // The host applies the tab schema as search_path on its own query path
      // but not here; without it unqualified names resolve against the
      // default search_path and miss the tables the result set came from.
      schema: schema || undefined,
      sql,
      mode: "estimated",
    });
    const parsed = parsePlan(result.format, result.rawPlan);
    if (!parsed) {
      return { ok: false, failure: t.planUnreadable };
    }
    return { ok: true, parsed, dbType: result.dbType || caps.dbType || "", warnings: result.warnings ?? [] };
  } catch (cause) {
    console.error("[result-view] plan fetch failed", cause);
    return { ok: false, failure: withCause(t.planFailed, cause) };
  }
}

/**
 * The page's AI-panel actions. The plan handoff (send: true) carries a fixed
 * interpretation prompt because a plan is meaningless without one; the generic
 * result-data handoff (send: false) is the opposite on purpose — the snapshot
 * carries the SQL and the display-ready cells, the conversation opens with a
 * neutral note, and what to ask is the user's business.
 */
function useResultViewAiActions(params: {
  connectionId: string;
  database: string;
  /** The tab's schema; the plan EXPLAIN needs it to resolve unqualified names. */
  schema: string;
  sql: string;
  /** The live result snapshot; the data handoff ships it verbatim. */
  result: ResultSetContext["result"];
  slot: ActionSlot;
  t: Strings;
}): ResultViewAiActions {
  const { connectionId, database, schema, sql, result, slot, t } = params;
  const { setBusy, setFailure } = slot;

  const explainPlanAi = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const bridge = window.dbxPlugin;
      if (!bridge?.ai?.openConversation) {
        setFailure(t.planAiFailed);
        return;
      }
      const fetched = await fetchPlanMetadata({ connectionId, database, schema, sql }, t);
      if (!fetched.ok) {
        setFailure(fetched.failure);
        return;
      }
      // Same pivot as the canvas path: the snapshot going to the AI panel is a
      // plan, so the chips should talk about plans.
      setAiRecommendations(planRecommendations(t));
      const context = buildPlanAiContext(fetched.parsed, { dbType: fetched.dbType, sql, warnings: fetched.warnings });
      // The host caps the context in UTF-8 bytes, not UTF-16 string lengths;
      // measure the same way or CJK-heavy plans slip past this check.
      if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 2 * 1024 * 1024) {
        setFailure(t.planAiTooLarge);
        return;
      }
      const title = (deriveName(sql) || t.planSceneTitle).slice(0, 200);
      await bridge.ai.openConversation({ title, prompt: t.planAiPrompt, context, send: true });
    } catch (cause) {
      console.error("[result-view] ai explain failed", cause);
      setFailure(withCause(t.planAiFailed, cause));
    } finally {
      setBusy(false);
    }
  };

  const sendDataAi = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const bridge = window.dbxPlugin;
      if (!bridge?.ai?.openConversation) {
        setFailure(t.resultDataAiFailed);
        return;
      }
      const snapshot = buildResultAiSnapshot({ connectionId, database, sql, result });
      const note =
        formatAll(t.resultDataAiPrompt, { n: snapshot.rowCount, m: result.columns.length }) +
        (snapshot.truncated ? t.resultDataAiTruncated : "");
      const title = (deriveName(sql) || t.resultViewTitle).slice(0, 200);
      await bridge.ai.openConversation({ title, prompt: note, context: snapshot.context, send: false });
    } catch (cause) {
      console.error("[result-view] data handoff to the AI panel failed", cause);
      setFailure(withCause(t.resultDataAiFailed, cause));
    } finally {
      setBusy(false);
    }
  };

  return {
    explainPlanAi: () => void explainPlanAi(),
    sendDataAi: () => void sendDataAi(),
  };
}

interface ResultHeaderProps {
  t: Strings;
  busy: boolean;
  canCreate: boolean;
  canPlan: boolean;
  canAi: boolean;
  canSendDataAi: boolean;
  onCreate: () => void;
  onAppend: () => void;
  onPlan: () => void;
  onExplainAi: () => void;
  onSendDataAi: () => void;
  onBrowse: () => void;
  onReveal: () => void;
}

function ResultHeader({ t, busy, canCreate, canPlan, canAi, canSendDataAi, onCreate, onAppend, onPlan, onExplainAi, onSendDataAi, onBrowse, onReveal }: ResultHeaderProps) {
  return (
    <header className="home-header">
      <div>
        <h1 className="home-title">{t.resultViewTitle}</h1>
        <p className="result-view__subtitle">{t.resultViewSubtitle}</p>
      </div>
      <div className="home-actions">
        <button type="button" className="btn btn--ghost" onClick={onReveal} disabled={busy}>
          {t.revealInFileManager}
        </button>
        <button type="button" className="btn" onClick={onBrowse} disabled={busy}>
          {t.resultViewOpenExisting}
        </button>
        {canPlan && (
          <button type="button" className="btn" onClick={onPlan} disabled={busy || !canCreate}>
            {busy ? t.planCreating : t.planCreate}
          </button>
        )}
        {canAi && (
          <button type="button" className="btn" onClick={onExplainAi} disabled={busy || !canCreate}>
            {t.planAi}
          </button>
        )}
        {canSendDataAi && (
          <button type="button" className="btn" onClick={onSendDataAi} disabled={busy || !canCreate}>
            {t.resultDataAi}
          </button>
        )}
        <button type="button" className="btn" onClick={onAppend} disabled={busy || !canCreate}>
          {t.resultViewAppend}
        </button>
        <button type="button" className="btn btn--primary" onClick={onCreate} disabled={busy || !canCreate}>
          {busy ? t.resultViewCreating : t.resultViewCreate}
        </button>
      </div>
    </header>
  );
}

interface ResultSummaryProps {
  t: Strings;
  data: ResultSetContext;
  layout: GridSceneResult;
  availableRows: number;
  rowLimit: number;
  busy: boolean;
  onRowLimitChange: (rows: number) => void;
}

/** What the canvas will contain, and the control that decides it. */
function ResultSummary({ t, data, layout, availableRows, rowLimit, busy, onRowLimitChange }: ResultSummaryProps) {
  return (
    <>
      <div className="result-view__meta">
        <span className="result-view__pill">
          {formatAll(t.resultViewIncluded, { n: layout.includedRows, m: layout.includedColumns })}
        </span>
        {data.database && <span className="result-view__pill">{data.database}</span>}
        {layout.droppedRows && (
          <span className="result-view__pill">
            {formatAll(t.resultViewOmitted, { n: layout.totalRows - layout.includedRows })}
          </span>
        )}
        {layout.droppedColumns && (
          <span className="result-view__pill">
            {formatAll(t.resultViewOmittedColumns, { n: layout.totalColumns - layout.includedColumns })}
          </span>
        )}
        {data.result.truncated && (
          <span className="result-view__pill result-view__pill--warn">
            {formatAll(t.resultViewHostTruncated, { n: availableRows })}
          </span>
        )}
      </div>

      {data.sql && (
        <details className="result-view__sql">
          <summary>{t.resultViewSql}</summary>
          <pre>{data.sql}</pre>
        </details>
      )}

      <div className="result-view__controls">
        <label className="result-view__control">
          <span>{t.resultViewRows}</span>
          <select
            className="input"
            value={rowLimit}
            onChange={(event) => onRowLimitChange(Number(event.target.value))}
            disabled={busy}
          >
            {rowChoices(availableRows).map((choice) => (
              <option key={choice} value={choice}>
                {formatAll(t.resultViewRowLimit, { n: choice })}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

interface ResultPreviewProps {
  t: Strings;
  data: ResultSetContext;
  availableRows: number;
}

/**
 * A truncated look at the source data. Cells go through the same cellText as the
 * canvas so the two read alike, and the header does too — a query may return
 * duplicate column names, so the key is the index.
 */
function ResultPreview({ t, data, availableRows }: ResultPreviewProps) {
  const preview = useMemo(() => {
    const columns = data.result.columns.slice(0, PREVIEW_COLUMNS);
    const rows = data.result.rows
      .slice(0, PREVIEW_ROWS)
      .map((row) => columns.map((_, index) => cellText(row[index])));
    return { columns, rows };
  }, [data]);

  const omittedColumns = data.result.columns.length - PREVIEW_COLUMNS;

  return (
    <div className="result-view__preview" role="region" aria-label={t.resultViewPreviewNote}>
      <table>
        <thead>
          <tr>
            {preview.columns.map((column, index) => {
              const text = cellText(column);
              return (
                <th key={index} title={text}>
                  {text}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} title={cell}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="result-view__note">
        {formatAll(t.resultViewPreviewNote, { n: Math.min(PREVIEW_ROWS, availableRows), total: availableRows })}
        {omittedColumns > 0 ? ` ${formatAll(t.resultViewOmittedColumns, { n: omittedColumns })}` : ""}
      </p>
    </div>
  );
}

interface AppendTarget {
  meta: DocumentMeta;
  scene: StoredSceneLike | null;
  corrupt: boolean;
}

/**
 * The append dialog's data layer: the document list with its load failure, the
 * picked target and its scene-loading state, and the single failure slot
 * shared by target loads and the append save. Extracted from the dialog so the
 * component stays a description of what it renders.
 *
 * document/list arrives in the backend's own order — last opened first — so
 * the preselected first entry is the canvas the user touched last, which is
 * where a second result set almost always belongs. document/get also bumps
 * the target's lastOpened, so weighing a canvas moves it to the top of the
 * list the same way opening it would.
 */
function useAppendTargets(t: Strings) {
  const [documents, setDocuments] = useState<DocumentMeta[] | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [target, setTarget] = useState<AppendTarget | null>(null);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.listDocuments();
        if (cancelled) {
          return;
        }
        setDocuments(response.items);
        setTargetId(response.items[0]?.id ?? null);
      } catch (error) {
        console.error("[result-view] append list failed", error);
        if (!cancelled) {
          setLoadFailure(withCause(t.resultViewAppendFailed, error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!targetId) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    setSceneLoading(true);
    setFailure(null);
    (async () => {
      try {
        const response = await api.getDocument(targetId);
        if (cancelled) {
          return;
        }
        setTarget({
          meta: response.document,
          scene: (response.scene ?? null) as StoredSceneLike | null,
          corrupt: response.corrupt,
        });
      } catch (error) {
        console.error("[result-view] append target load failed", error);
        if (!cancelled) {
          setFailure(withCause(t.resultViewAppendFailed, error));
        }
      } finally {
        if (!cancelled) {
          setSceneLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId, t]);

  return { documents, loadFailure, targetId, setTargetId, target, sceneLoading, failure, setFailure };
}

interface AppendDocumentListProps {
  t: Strings;
  lang: Lang;
  documents: DocumentMeta[];
  targetId: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}

/** The pick-one canvas list; selection state lives in the caller. */
function AppendDocumentList({ t, lang, documents, targetId, onSelect, disabled }: AppendDocumentListProps) {
  return (
    <div className="append-dialog__list" role="listbox" aria-label={t.resultViewAppendPick}>
      {documents.map((meta) => (
        <button
          key={meta.id}
          type="button"
          role="option"
          aria-selected={meta.id === targetId}
          className={`append-dialog__item${meta.id === targetId ? " append-dialog__item--selected" : ""}`}
          onClick={() => onSelect(meta.id)}
          disabled={disabled}
        >
          <span className="append-dialog__name">{meta.name}</span>
          <span className="append-dialog__time">{relativeTime(meta.updatedAt, lang, t)}</span>
        </button>
      ))}
    </div>
  );
}

interface AppendOutcomeSummaryProps {
  t: Strings;
  outcome: MergeOutcome;
}

/** What the merge will actually place, with the ceiling's omissions called out. */
function AppendOutcomeSummary({ t, outcome }: AppendOutcomeSummaryProps) {
  if (!outcome.ok) {
    return null;
  }
  return (
    <div className="result-view__meta">
      <span className="result-view__pill">
        {formatAll(t.resultViewAppendSummary, {
          n: outcome.layout.includedRows,
          m: outcome.layout.includedColumns,
        })}
      </span>
      {outcome.layout.droppedRows && (
        <span className="result-view__pill">
          {formatAll(t.resultViewOmitted, { n: outcome.layout.totalRows - outcome.layout.includedRows })}
        </span>
      )}
      {outcome.layout.droppedColumns && (
        <span className="result-view__pill">
          {formatAll(t.resultViewOmittedColumns, { n: outcome.layout.totalColumns - outcome.layout.includedColumns })}
        </span>
      )}
    </div>
  );
}

interface AppendCanvasDialogProps {
  t: Strings;
  lang: Lang;
  grid: ResultGrid;
  /** The canvas title this result would carry, numbered against the target on merge. */
  title: string;
  caption?: string;
  maxRows: number;
  onOpen: (meta: DocumentMeta) => void;
  onClose: () => void;
}

/**
 * The pick-an-existing-canvas flow for the second and further result sets.
 * Data loading lives in `useAppendTargets`; this component owns the merge
 * preview, the confirm action, and what they render. The summary line reports
 * the merged reality: rows the ceiling forced out of a nearly-full target
 * show up here before anything is saved.
 */
function AppendCanvasDialog({ t, lang, grid, title, caption, maxRows, onOpen, onClose }: AppendCanvasDialogProps) {
  const { documents, loadFailure, targetId, setTargetId, target, sceneLoading, failure, setFailure } =
    useAppendTargets(t);
  const [busy, setBusy] = useState(false);
  // One namespace per dialog session: every merge targets a different stored
  // scene, so even a repeated prefix across sessions could never collide.
  const [idPrefix] = useState(makeIdPrefix);

  // Escape closes the dialog like the backdrop does — but never under an
  // in-flight save, where closing would hide an append that still lands.
  useEffect(() => {
    if (busy) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  const liveElements = useMemo(
    () => (Array.isArray(target?.scene?.elements) ? (target!.scene!.elements as unknown[]) : []),
    [target],
  );
  const outcome = useMemo<MergeOutcome | null>(() => {
    if (!target || target.corrupt || sceneLoading) {
      return null;
    }
    return mergeGridIntoScene(target.scene, {
      grid,
      title: uniqueGridTitle(liveElements, title),
      caption,
      maxRows,
      placement: appendPlacement(sceneBounds(liveElements), idPrefix),
    });
  }, [target, sceneLoading, liveElements, grid, title, caption, maxRows, idPrefix]);

  const confirm = async () => {
    if (!outcome || !outcome.ok || !target) {
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await persistImportedScene(target.meta.id, outcome.scene);
      onOpen(target.meta);
    } catch (error) {
      console.error("[result-view] append failed", error);
      setFailure(withCause(t.resultViewAppendFailed, error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t.resultViewAppend} onClick={busy ? undefined : onClose}>
      <div className="modal__panel append-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>{t.resultViewAppend}</h2>
        <p>{t.resultViewAppendBody}</p>

        {loadFailure ? (
          <p className="append-dialog__status">{loadFailure}</p>
        ) : documents === null ? (
          <div className="append-dialog__loading">
            <div className="spinner" aria-hidden="true" />
          </div>
        ) : documents.length === 0 ? (
          <p className="append-dialog__status">{t.resultViewAppendEmptyList}</p>
        ) : (
          <AppendDocumentList
            t={t}
            lang={lang}
            documents={documents}
            targetId={targetId}
            onSelect={setTargetId}
            disabled={busy}
          />
        )}

        {target?.corrupt && <p className="append-dialog__status">{t.resultViewAppendCorrupt}</p>}
        {outcome && !outcome.ok && <p className="append-dialog__status">{t.resultViewAppendSceneFull}</p>}
        {outcome && <AppendOutcomeSummary t={t} outcome={outcome} />}

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void confirm()}
            disabled={busy || sceneLoading || !target || target.corrupt || !outcome?.ok}
          >
            {busy ? t.resultViewAppendBusy : t.resultViewAppendConfirm}
          </button>
        </div>
        {failure && <p className="append-dialog__status">{failure}</p>}
      </div>
    </div>
  );
}
