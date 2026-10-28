import type { Strings } from "./i18n";
import type { AiRecommendationPayload, AiRecommendationUpdate, DbxPluginBridge } from "./types";

export type { AiRecommendationPayload } from "./types";

/**
 * The AI panel's suggestion chips (roadmap T-B, runtime half only). The
 * declarative half (`workbench.ai.recommendations` in the manifest) was
 * implemented and then **deliberately reverted**: `PluginWorkbenchContribution`
 * carries `#[serde(deny_unknown_fields)]` on every host, and hosts built
 * before the field landed (2026-09-27, e6edd02bb) reject a manifest carrying
 * `ai` outright — the plugin would be uninstallable there, well above this
 * manifest's `engines.dbx >= 0.5.68` floor. The declarative templates come
 * back only if that floor ever rises past the field's introduction; until
 * then this module owns the whole feature, capability-gated so nothing
 * changes on hosts without the panel.
 *
 * View contract: a view holding data seeds the panel with prompts worth
 * clicking (the result view with result prompts, then plan prompts once a
 * plan is parsed); plain canvases clear the set. Gated on the init-frame
 * `aiRecommendations` capability and `host.ai` (already declared), strictly
 * cosmetic — a refused call never escalates. No hard `window` reference, so
 * the pure helpers stay importable under the node test environment.
 */

/** Result sets: interpret the data, suggest how to draw it, review the SQL. */
export function resultRecommendations(t: Strings): AiRecommendationPayload[] {
  return [
    { id: "interpret-result", label: t.recInterpretResultLabel, prompt: t.recInterpretResultPrompt, order: 1 },
    { id: "suggest-visualization", label: t.recVisualizeLabel, prompt: t.recVisualizePrompt, order: 2 },
    { id: "review-sql", label: t.recOptimizeSqlLabel, prompt: t.recOptimizeSqlPrompt, order: 3 },
  ];
}

/** Execution plans: read the tree, propose concrete changes per node. */
export function planRecommendations(t: Strings): AiRecommendationPayload[] {
  return [
    { id: "interpret-plan", label: t.recInterpretPlanLabel, prompt: t.recInterpretPlanPrompt, order: 1 },
    { id: "plan-suggestions", label: t.recPlanSuggestionsLabel, prompt: t.recPlanSuggestionsPrompt, order: 2 },
  ];
}

/**
 * The plan canvas is recognizable by its naming convention: either the derived
 * "<query> - plan" name or the standalone localized title. A rename that drops
 * both simply degrades the document back to a plain canvas.
 */
export function isPlanDocumentName(name: string, t: Strings): boolean {
  return name === t.planSceneTitle || name.endsWith(" - plan");
}

// Canonical JSON of the set this process believes is live; null = nothing live.
let current: string | null = null;
// Whether a clear already went out and no set has followed — a fresh plain
// canvas (a home that boots while another tab's chips are live) must still be
// able to clear, so "no set yet" may not short-circuit it.
let clearSent = false;

function stableOf(recs: AiRecommendationPayload[]): string {
  return JSON.stringify(recs.map(({ id, label, prompt, order }) => ({ id, label, prompt, order })));
}

function bridgeOf(): DbxPluginBridge | undefined {
  return (globalThis as { window?: { dbxPlugin?: DbxPluginBridge } }).window?.dbxPlugin;
}

/**
 * Replaces the panel's chips with this set, deduplicated so rerenders that
 * compute the same set cost no host call. `force` bypasses the memo — the
 * re-assert path uses it, because a sibling tab may have rewritten the shared
 * panel in between and the memo must not swallow the re-send. A refusal drops
 * the memo so a later identical set retries instead of assuming it landed.
 */
export function setAiRecommendations(recs: AiRecommendationPayload[], force = false): void {
  const instance = bridgeOf();
  if (instance?.capabilities?.aiRecommendations !== true || typeof instance.ai?.setRecommendations !== "function") {
    return;
  }
  const next = stableOf(recs);
  if (!force && next === current) {
    return;
  }
  current = next;
  clearSent = false;
  // Host contract (pluginHostBridge.requirePluginAiRecommendationUpdate): an
  // envelope of the tab context (snapshotted for placeholder interpolation)
  // plus at most five items — a bare array is rejected, which used to fail
  // silently under the cosmetic-catch below.
  const update: AiRecommendationUpdate = { context: workbenchContext(), items: recs };
  void Promise.resolve(instance.ai.setRecommendations(update)).catch(() => {
    current = null;
  });
}

/**
 * Removes the chips; repeated clears while none is pending are no-ops unless
 * forced (same re-assert rationale as `setAiRecommendations`).
 */
export function clearAiRecommendations(force = false): void {
  if (!force && clearSent) {
    return;
  }
  const instance = bridgeOf();
  if (typeof instance?.ai?.clearRecommendations !== "function") {
    return;
  }
  clearSent = true;
  current = null;
  void Promise.resolve(instance.ai.clearRecommendations()).catch(() => {
    clearSent = false;
  });
}

/** The tab context the host handed this instance, plain-object guarded. */
function workbenchContext(): Record<string, unknown> {
  const context = bridgeOf()?.context;
  return context && typeof context === "object" && !Array.isArray(context)
    ? (context as Record<string, unknown>)
    : {};
}
