import { cellText } from "./resultScene";
import type { ResultSetContext } from "./types";

// Hands the current result set to the host's built-in AI panel as a one-way
// context snapshot. Deliberately generic: the plugin attaches the SQL and the
// display-ready cells and gets out of the way — what to ask (interpretation,
// anomaly checks, follow-up SQL) is the user's call, so the conversation opens
// with a neutral note instead of a scripted analysis prompt (send: false).
//
// The host rejects oversized contexts in UTF-8 bytes (2 MiB cap on the
// ai.openConversation snapshot), so rows are sampled down until the payload
// verifiably fits, and the caller is told when that happened.

const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;
// Headroom for the host's own envelope around this snapshot. Measured the same
// way clipboard.ts measures a scene write, but generous rather than exact: an
// undersized snapshot is a shame, an oversized one is a failed handoff.
const ENVELOPE_HEADROOM = 16 * 1024;

export interface ResultAiSnapshot {
  /** Machine-readable context for `ai.openConversation`. */
  context: Record<string, unknown>;
  /** How many data rows made it into the snapshot. */
  rowCount: number;
  /** True when rows were dropped to fit the host's context limit. */
  truncated: boolean;
}

function utf8Length(json: string): number {
  return new TextEncoder().encode(json).byteLength;
}

export function buildResultAiSnapshot(
  data: Pick<ResultSetContext, "connectionId" | "database" | "sql" | "result">,
  maxBytes: number = MAX_CONTEXT_BYTES - ENVELOPE_HEADROOM,
): ResultAiSnapshot {
  const columns = data.result.columns.map((column) => cellText(column));
  const rows = data.result.rows.map((row) => data.result.columns.map((_, index) => cellText(row[index])));
  const context = (rowCount: number): Record<string, unknown> => ({
    type: "dbx-result-set",
    sql: data.sql,
    connectionId: data.connectionId || undefined,
    database: data.database || undefined,
    result: { columns, rows: rows.slice(0, rowCount), truncated: rowCount < rows.length },
  });

  // Halve until it fits: the snapshot is informational, so a coarse cut beats
  // a binary search the user will never see. It never drops below one row —
  // if even that will not fit, the context goes out as is and the host's
  // rejection surfaces through the action's failure toast.
  let rowCount = rows.length;
  while (rowCount > 1 && utf8Length(JSON.stringify(context(rowCount))) > maxBytes) {
    rowCount = Math.floor(rowCount / 2);
  }
  return { context: context(rowCount), rowCount, truncated: rowCount < rows.length };
}
