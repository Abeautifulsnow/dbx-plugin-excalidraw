import { useMemo, useState } from "react";
import { api } from "./api";
import { buildGridScene, cellText, deriveName, initialRowLimit, rowChoices, type GridSceneResult } from "./resultScene";
import { formatAll, type Strings } from "./i18n";
import type { DocumentMeta, ResultSetContext } from "./types";

interface ResultViewPageProps {
  t: Strings;
  /** Memoized by the caller: a fresh object per render would defeat the memos below. */
  data: ResultSetContext;
  onOpen: (meta: DocumentMeta) => void;
  onBrowse: () => void;
}

const PREVIEW_ROWS = 8;
const PREVIEW_COLUMNS = 8;

export function ResultViewPage({ t, data, onOpen, onBrowse }: ResultViewPageProps) {
  const availableRows = data.result.rows.length;
  const [rowLimit, setRowLimit] = useState(() => initialRowLimit(availableRows));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasResult = data.result.columns.length > 0 || availableRows > 0;
  const title = deriveName(data.sql) || t.resultViewTitle;

  // What the canvas will actually hold. Building the layout here rather than
  // only on submit keeps the preview honest: the scene builder drops rows to fit
  // its byte budget and columns beyond its cap, and the page must say so instead
  // of repeating the requested counts back at the user.
  const layout = useMemo(
    () =>
      buildGridScene(
        { columns: data.result.columns, rows: data.result.rows.map((row) => row.map(cellText)) },
        { title, caption: data.sql.replace(/\s+/g, " ").trim() || undefined, maxRows: rowLimit },
      ),
    [data, rowLimit, title],
  );

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const meta = await api.createDocument(deriveName(data.sql) || "");
      await api.saveScene(meta.id, layout.scene);
      onOpen(meta);
    } catch (cause) {
      console.error("[result-view] create failed", cause);
      setError(t.resultViewFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="result-view">
      <ResultHeader t={t} busy={busy} canCreate={hasResult} onCreate={() => void create()} onBrowse={onBrowse} />

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
            onRowLimitChange={setRowLimit}
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

      {error && <div className="toast toast--error">{error}</div>}
    </div>
  );
}

interface ResultHeaderProps {
  t: Strings;
  busy: boolean;
  canCreate: boolean;
  onCreate: () => void;
  onBrowse: () => void;
}

function ResultHeader({ t, busy, canCreate, onCreate, onBrowse }: ResultHeaderProps) {
  return (
    <header className="home-header">
      <div>
        <h1 className="home-title">{t.resultViewTitle}</h1>
        <p className="result-view__subtitle">{t.resultViewSubtitle}</p>
      </div>
      <div className="home-actions">
        <button type="button" className="btn" onClick={onBrowse} disabled={busy}>
          {t.resultViewOpenExisting}
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
