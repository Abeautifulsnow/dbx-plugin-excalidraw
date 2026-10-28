import { useEffect } from "react";
import {
  clearAiRecommendations,
  setAiRecommendations,
  type AiRecommendationPayload,
} from "./aiRecommendations";

/**
 * Wires a view to the AI panel's suggestion chips. The argument decides the
 * view's stance: an array seeds the panel with that set, `null` clears it,
 * `undefined` means this view has nothing to say yet (the editor before its
 * document metadata arrives) and the effect stays out of the way.
 *
 * The set is asserted on mount **and re-asserted every time the view becomes
 * visible**: the host keeps plugin webviews mounted behind `display:none`
 * when the user switches tabs (App.vue renders them with `v-for` + `v-show`
 * so SSH terminals are never destroyed), so returning to a tab does not
 * remount it — and a sibling tab may have rewritten the shared panel in
 * between. Plugin pages run in an iframe, and hiding the host container
 * flips its `visibilityState`, which makes `visibilitychange` the reliable
 * "this tab is front again" signal. The re-assertions force past the dedupe
 * memo on purpose; identical sets still cost one host call per tab switch,
 * which is the price of a panel shared across tabs without a read-back API.
 */
export function useAiRecommendations(recs: AiRecommendationPayload[] | null | undefined): void {
  useEffect(() => {
    if (recs === undefined) {
      return;
    }
    const assert = () => {
      if (recs === null) {
        clearAiRecommendations(true);
      } else {
        setAiRecommendations(recs, true);
      }
    };
    assert();
    document.addEventListener("visibilitychange", assert);
    return () => document.removeEventListener("visibilitychange", assert);
  }, [recs]);
}
