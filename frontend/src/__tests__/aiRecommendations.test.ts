import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAiRecommendations,
  isPlanDocumentName,
  planRecommendations,
  resultRecommendations,
  setAiRecommendations,
} from "../aiRecommendations";
import { strings } from "../i18n";

describe("recommendation builders", () => {
  it("builds host-valid, per-locale sets for the result and plan surfaces", () => {
    for (const t of [strings.en, strings.zh]) {
      const result = resultRecommendations(t);
      const plan = planRecommendations(t);
      expect(result).toHaveLength(3);
      expect(plan).toHaveLength(2);
      for (const rec of [...result, ...plan]) {
        expect(rec.id).toMatch(/^[a-z][a-z-]*$/);
        expect(rec.label.length).toBeGreaterThan(0);
        expect(rec.label.length).toBeLessThanOrEqual(200);
        expect(rec.prompt.length).toBeGreaterThan(0);
        expect(rec.prompt.length).toBeLessThanOrEqual(32000);
        // Runtime prompts are literal text; placeholders belong to templates,
        // which the host validates separately from these items.
        expect(rec.prompt).not.toContain("{{");
      }
      expect(new Set(result.map((rec) => rec.id)).size).toBe(3);
      expect(new Set(plan.map((rec) => rec.id)).size).toBe(2);
    }
    // The plugin ships zh and en copy: switching locale must produce a
    // different set, or the dedupe memo would swallow the swap.
    expect(resultRecommendations(strings.en)[0].label).not.toEqual(resultRecommendations(strings.zh)[0].label);
    expect(planRecommendations(strings.en)[0].prompt).not.toEqual(planRecommendations(strings.zh)[0].prompt);
  });
});

describe("isPlanDocumentName", () => {
  it("recognizes plan documents by naming convention only", () => {
    expect(isPlanDocumentName("Query: orders - plan", strings.en)).toBe(true);
    expect(isPlanDocumentName(strings.en.planSceneTitle, strings.en)).toBe(true);
    expect(isPlanDocumentName(strings.zh.planSceneTitle, strings.zh)).toBe(true);
    // Anything else is a plain canvas — including near misses.
    expect(isPlanDocumentName("orders", strings.en)).toBe(false);
    expect(isPlanDocumentName("plan", strings.en)).toBe(false);
    expect(isPlanDocumentName("Query: orders", strings.en)).toBe(false);
    expect(isPlanDocumentName("", strings.en)).toBe(false);
  });
});

describe("setAiRecommendations / clearAiRecommendations", () => {
  const globalScope = globalThis as { window?: unknown };

  afterEach(() => {
    delete globalScope.window;
  });

  async function freshModule() {
    vi.resetModules();
    return import("../aiRecommendations");
  }

  function hostWith(setRecommendations: unknown, clearRecommendations: unknown, context?: unknown) {
    globalScope.window = {
      dbxPlugin: {
        capabilities: { aiRecommendations: true },
        context,
        ai: { setRecommendations, clearRecommendations },
      },
    };
  }

  it("sends the host envelope (context + items) once per distinct set", async () => {
    const setRecommendations = vi.fn(() => Promise.resolve());
    const clearRecommendations = vi.fn(() => Promise.resolve());
    hostWith(setRecommendations, clearRecommendations, { connectionId: "conn-1", database: "analytics" });
    const m = await freshModule();
    const items = m.resultRecommendations(strings.en);
    m.setAiRecommendations(items);
    m.setAiRecommendations(m.resultRecommendations(strings.en));
    m.setAiRecommendations(m.planRecommendations(strings.en));
    expect(setRecommendations).toHaveBeenCalledTimes(2);
    expect(setRecommendations).toHaveBeenNthCalledWith(1, {
      context: { connectionId: "conn-1", database: "analytics" },
      items,
    });
    expect(setRecommendations).toHaveBeenLastCalledWith({
      context: { connectionId: "conn-1", database: "analytics" },
      items: m.planRecommendations(strings.en),
    });
    expect(clearRecommendations).not.toHaveBeenCalled();
  });

  it("clears once per pending clear, including on a fresh plain canvas", async () => {
    const setRecommendations = vi.fn(() => Promise.resolve());
    const clearRecommendations = vi.fn(() => Promise.resolve());
    hostWith(setRecommendations, clearRecommendations);
    const m = await freshModule();
    // A home booting while another tab's chips are live has sent nothing of
    // its own — its clear must still reach the host.
    m.clearAiRecommendations();
    m.clearAiRecommendations();
    expect(clearRecommendations).toHaveBeenCalledTimes(1);
    // After a set, the next clear goes out again.
    m.setAiRecommendations(m.resultRecommendations(strings.en));
    m.clearAiRecommendations();
    expect(setRecommendations).toHaveBeenCalledTimes(1);
    expect(clearRecommendations).toHaveBeenCalledTimes(2);
    // And re-setting the same set after a clear is not swallowed by the memo.
    m.setAiRecommendations(m.resultRecommendations(strings.en));
    expect(setRecommendations).toHaveBeenCalledTimes(2);
  });

  it("no-ops without a host, without the capability, or without the ai namespace", async () => {
    const quiet = vi.fn(() => Promise.resolve());
    const m = await freshModule();
    // No host at all.
    m.setAiRecommendations(m.resultRecommendations(strings.en));
    m.clearAiRecommendations();
    // Capability key missing (older host).
    globalScope.window = {
      dbxPlugin: { capabilities: {}, ai: { setRecommendations: quiet, clearRecommendations: quiet } },
    };
    m.setAiRecommendations(m.resultRecommendations(strings.en));
    // ai namespace missing entirely.
    globalScope.window = { dbxPlugin: { capabilities: { aiRecommendations: true } } };
    m.setAiRecommendations(m.resultRecommendations(strings.en));
    m.clearAiRecommendations();
    expect(quiet).not.toHaveBeenCalled();
  });

  it("retries after a refused set instead of memoizing the failure", async () => {
    const setRecommendations = vi
      .fn<(items: unknown) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce(undefined);
    hostWith(setRecommendations, vi.fn(() => Promise.resolve()));
    const m = await freshModule();
    m.setAiRecommendations(m.resultRecommendations(strings.en));
    // Let the rejection settle before the retry, mirroring the tabTitle tests.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    m.setAiRecommendations(m.resultRecommendations(strings.en));
    expect(setRecommendations).toHaveBeenCalledTimes(2);
  });

  it("force bypasses both memos for the visibility re-assert path", async () => {
    const setRecommendations = vi.fn(() => Promise.resolve());
    const clearRecommendations = vi.fn(() => Promise.resolve());
    hostWith(setRecommendations, clearRecommendations);
    const m = await freshModule();
    const items = m.resultRecommendations(strings.en);
    // Dedupe still holds without force.
    m.setAiRecommendations(items);
    m.setAiRecommendations(items);
    expect(setRecommendations).toHaveBeenCalledTimes(1);
    // A forced set re-sends the identical set (a sibling tab may have
    // rewritten the shared panel in between).
    m.setAiRecommendations(items, true);
    expect(setRecommendations).toHaveBeenCalledTimes(2);
    // Same for clears: the pending-clear memo yields to force.
    m.clearAiRecommendations();
    expect(clearRecommendations).toHaveBeenCalledTimes(1);
    m.clearAiRecommendations(true);
    m.clearAiRecommendations(true);
    expect(clearRecommendations).toHaveBeenCalledTimes(3);
    // A forced clear also re-arms the set memo: the same set goes out again.
    m.setAiRecommendations(items);
    expect(setRecommendations).toHaveBeenCalledTimes(3);
  });
});
