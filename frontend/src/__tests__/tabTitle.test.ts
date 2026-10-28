import { afterEach, describe, expect, it, vi } from "vitest";
import { TAB_TITLE_MAX_CHARS, applyTabTitle, clampTabTitle, editorTabTitle } from "../tabTitle";

describe("clampTabTitle", () => {
  it("trims whitespace and leaves short titles alone", () => {
    expect(clampTabTitle("  orders  ")).toBe("orders");
    expect(clampTabTitle("Query: orders")).toBe("Query: orders");
  });

  it("keeps a title that exactly fills the cap intact", () => {
    const exact = "y".repeat(TAB_TITLE_MAX_CHARS);
    expect(clampTabTitle(exact)).toBe(exact);
  });

  it("truncates an over-long title with an ellipsis inside the cap", () => {
    const clamped = clampTabTitle("x".repeat(500));
    expect(clamped.length).toBe(TAB_TITLE_MAX_CHARS);
    expect(clamped.endsWith("…")).toBe(true);
  });
});

describe("editorTabTitle", () => {
  it("dots an unsaved document and leaves a clean one bare", () => {
    expect(editorTabTitle("orders", true)).toBe("• orders");
    expect(editorTabTitle("orders", false)).toBe("orders");
  });

  it("clamps long names the same way with and without the dot", () => {
    const name = "n".repeat(TAB_TITLE_MAX_CHARS);
    expect(editorTabTitle(name, true)).toBe(clampTabTitle(`• ${name}`));
  });
});

describe("applyTabTitle", () => {
  const globalScope = globalThis as { window?: unknown };

  afterEach(() => {
    delete globalScope.window;
  });

  async function freshModule() {
    vi.resetModules();
    return import("../tabTitle");
  }

  function hostWith(setTitle: unknown) {
    globalScope.window = { dbxPlugin: { capabilities: { workbenchTitle: true }, setTitle } };
  }

  it("calls setTitle once per distinct title, clamped and deduplicated", async () => {
    const setTitle = vi.fn(() => Promise.resolve());
    hostWith(setTitle);
    const { applyTabTitle: apply } = await freshModule();
    apply("  orders  ");
    apply("orders");
    apply("• orders");
    expect(setTitle).toHaveBeenCalledTimes(2);
    expect(setTitle).toHaveBeenNthCalledWith(1, "orders");
    expect(setTitle).toHaveBeenNthCalledWith(2, "• orders");
  });

  it("no-ops without a host, without the capability, or without setTitle", async () => {
    const { applyTabTitle: apply } = await freshModule();
    // No host at all (node test environment before the stub is installed).
    expect(() => apply("orders")).not.toThrow();

    const quietSetTitle = vi.fn(() => Promise.resolve());
    globalScope.window = { dbxPlugin: { capabilities: {}, setTitle: quietSetTitle } };
    apply("orders");

    globalScope.window = { dbxPlugin: { capabilities: { workbenchTitle: true } } };
    apply("orders");
    expect(quietSetTitle).not.toHaveBeenCalled();
  });

  it("drops the memo after a refused call so the next change retries", async () => {
    const setTitle = vi
      .fn<(title: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce(undefined);
    hostWith(setTitle);
    const { applyTabTitle: apply } = await freshModule();
    apply("orders");
    // Let the rejection settle before the retry; a synchronous second call
    // would legitimately hit the dedupe memo instead.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    apply("orders");
    expect(setTitle).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer title's memo when an older call is refused", async () => {
    const setTitle = vi
      .fn<(title: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce(undefined);
    globalScope.window = { dbxPlugin: { capabilities: { workbenchTitle: true }, setTitle } };
    const { applyTabTitle: apply } = await freshModule();
    apply("orders");
    apply("• orders");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // The stale refusal must not invalidate the newer title's memo.
    apply("• orders");
    expect(setTitle).toHaveBeenCalledTimes(2);
    expect(setTitle).toHaveBeenLastCalledWith("• orders");
  });
});
