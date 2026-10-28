import { useEffect } from "react";
import { applyTabTitle } from "./tabTitle";

/**
 * Declares the host tab title for whichever view is mounted; `null` means
 * another view owns the title right now and this effect must stay out of its
 * way. The editor page passes the open document's name (dotted while anything
 * is unsaved); the outer views pass their own name and drop to `null` while
 * the editor is up, so the switch back re-runs the hook and takes the title
 * back. Pure wiring — the capability gate, dedupe and truncation live in
 * `tabTitle.ts`, and a host without the capability simply ignores all of it.
 */
export function useTabTitle(title: string | null): void {
  useEffect(() => {
    if (title !== null) {
      applyTabTitle(title);
    }
  }, [title]);
}
