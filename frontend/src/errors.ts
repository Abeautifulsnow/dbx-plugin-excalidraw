/**
 * How a user-visible failure line carries its underlying cause: the base copy
 * ("保存失败") says what failed, the appended detail ("Connection is not open")
 * says why — the only diagnostic the user gets without opening DevTools, and
 * the toast is where they already are. Every catch that feeds a toast, notice
 * or status line goes through `withCause`; catches that are silent by design
 * (best-effort prefs, per-asset degradation) keep their console.warn.
 */

/** Longest host/backend detail appended to a failure line; driver errors can
 *  embed SQL fragments and a runaway toast is worse than a clipped one. */
const MAX_CAUSE_DETAIL = 300;

/** How deep an `Error.cause` chain is followed; wrappers that attach the raw
 *  host error are one hop, cycles and runaway chains stop here. */
const MAX_CAUSE_DEPTH = 3;

function detailOf(cause: unknown, depth: number): string {
  if (cause === undefined || cause === null) {
    return "";
  }
  if (cause instanceof Error) {
    const own = cause.message.trim();
    const nested = (cause as { cause?: unknown }).cause;
    if (depth + 1 < MAX_CAUSE_DEPTH && nested !== undefined && nested !== null) {
      const deeper = detailOf(nested, depth + 1);
      if (deeper) {
        return own ? `${own}: ${deeper}` : deeper;
      }
    }
    return own;
  }
  const text = String(cause);
  // A bare object's default stringification carries no information; omitting
  // it keeps the toast to the base copy instead of appending noise.
  return text === "[object Object]" ? "" : text.trim();
}

/** The underlying error's message (following `cause` wrappers), clipped. */
export function errorDetail(cause: unknown): string {
  const detail = detailOf(cause, 0);
  return detail.length > MAX_CAUSE_DETAIL ? `${detail.slice(0, MAX_CAUSE_DETAIL)}…` : detail;
}

/**
 * Appends the underlying error's message to a failure line.
 */
export function withCause(message: string, cause: unknown): string {
  const detail = errorDetail(cause);
  // An em dash separates cleanly in both plugin languages; a colon would want
  // localizing (fullwidth in zh, ASCII in en) for no information gain.
  return detail ? `${message} — ${detail}` : message;
}
