import { RESULT_VIEW_CONTRIBUTION, type HostLaunch, type HostSurface, type ResultSetContext } from "./types";

// The host tells a plugin which declared surface opened it through the init
// message: workbench tabs and result-view tabs share one UI entrypoint, so
// nothing else distinguishes them at the protocol level.
//
// `installHostListeners` is called by the entry module rather than at module
// scope, so this file stays importable outside a browser (its pure helpers are
// unit-tested under the node environment). Registration still happens while the
// bundle is evaluating, before any postMessage can be delivered.
//
// Registration alone is not a guarantee: the sandbox runs the plugin bundle as a
// deferred module, so a parser yield while a large document is being read can
// deliver the message before the bundle runs at all. `primeLaunchFromBridge` is
// the fallback for that case.
let launch: HostLaunch | null = null;
const listeners = new Set<(launch: HostLaunch | null) => void>();
let installed = false;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function publish(next: HostLaunch | null): void {
  launch = next;
  for (const listener of listeners) {
    listener(launch);
  }
}

function surfaceOf(contributionId: string): HostSurface {
  return contributionId === RESULT_VIEW_CONTRIBUTION ? "result-view" : "workbench";
}

/**
 * Subscribes to the host's launch and context messages. Idempotent, so a
 * re-evaluated module (HMR) cannot double-register and fire every listener
 * twice.
 */
export function installHostListeners(): void {
  if (installed) {
    return;
  }
  installed = true;

  document.addEventListener("dbx-plugin-init", (event) => {
    const detail = asRecord((event as CustomEvent).detail);
    if (typeof detail.contributionId !== "string") {
      return;
    }
    publish({
      surface: surfaceOf(detail.contributionId),
      contributionId: detail.contributionId,
      context: asRecord(detail.context),
    });
  });

  // The host re-pushes context when the underlying tab changes. The event
  // carries the context alone, so the surface established at launch is carried
  // forward.
  document.addEventListener("dbx-plugin-context", (event) => {
    if (!launch) {
      return;
    }
    publish({ ...launch, context: asRecord((event as CustomEvent).detail) });
  });
}

/**
 * Recovers the launch when the init message was dispatched before this module
 * was evaluated. The bridge caches the context it resolved `ready` with, so
 * reading it back is authoritative for the payload; the contribution id is not
 * recoverable, and the surface is therefore inferred — a result-view payload is
 * the only one carrying a `result` object.
 *
 * Returns true when this call is what established the launch, so the caller can
 * log the degraded path.
 */
export function primeLaunchFromBridge(): boolean {
  if (launch) {
    return false;
  }
  const context = asRecord(window.dbxPlugin?.context);
  if (Object.keys(context).length === 0) {
    return false;
  }
  publish({
    surface: context.result ? "result-view" : "workbench",
    contributionId: null,
    context,
  });
  return true;
}

export function getLaunch(): HostLaunch | null {
  return launch;
}

export function subscribeLaunch(listener: (launch: HostLaunch | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads the result-view payload defensively. The shape is host-owned, not a
 * contract this plugin controls, so a missing or reshaped field degrades to an
 * empty value instead of throwing inside render.
 */
export function readResultSet(context: Record<string, unknown>): ResultSetContext {
  const raw = asRecord(context.result);
  const columns = Array.isArray(raw.columns) ? raw.columns.map((column) => String(column)) : [];
  const rows = Array.isArray(raw.rows)
    ? raw.rows.map((row) => (Array.isArray(row) ? row : [row]))
    : [];
  return {
    connectionId: asString(context.connectionId),
    database: asString(context.database),
    sql: asString(context.sql),
    result: { columns, rows, truncated: raw.truncated === true },
  };
}
