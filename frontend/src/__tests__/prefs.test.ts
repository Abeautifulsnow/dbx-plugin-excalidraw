import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  getPrefs: vi.fn(async () => ({ values: {} as Record<string, unknown> })),
  setPref: vi.fn(async () => ({ values: {} })),
}));

vi.mock("../api", () => ({ api: apiMock }));

beforeEach(() => {
  vi.clearAllMocks();
  // The module keeps its cache and load flag at module scope, so each test needs
  // a fresh copy to observe a real first load.
  vi.resetModules();
});

async function prefsModule() {
  return import("../prefs");
}

describe("preferences", () => {
  it("keeps known keys and drops everything else", async () => {
    apiMock.getPrefs.mockResolvedValueOnce({
      values: { resultRows: 500, homeSearch: "invoice", somethingElse: 7 },
    });
    const { loadPrefs, currentPrefs } = await prefsModule();
    await loadPrefs();
    expect(currentPrefs()).toEqual({ resultRows: 500, homeSearch: "invoice" });
  });

  it("drops values of the wrong shape instead of trusting them", async () => {
    apiMock.getPrefs.mockResolvedValueOnce({
      values: { resultRows: -3, homeSearch: 42 },
    });
    const { loadPrefs, currentPrefs } = await prefsModule();
    await loadPrefs();
    expect(currentPrefs()).toEqual({});
  });

  it("drops a key an earlier build wrote and this one no longer knows", async () => {
    // `exportViaDialog` was replaced by explicit save-as entries in the export
    // menu, so a leftover value must not resurface.
    apiMock.getPrefs.mockResolvedValueOnce({
      values: { exportViaDialog: true, homeSearch: "invoice" },
    });
    const { loadPrefs, currentPrefs } = await prefsModule();
    await loadPrefs();
    expect(currentPrefs()).toEqual({ homeSearch: "invoice" });
  });

  it("falls back to defaults when the store cannot be read", async () => {
    apiMock.getPrefs.mockRejectedValueOnce(new Error("BACKEND_UNAVAILABLE: sidecar is down"));
    const { loadPrefs, currentPrefs } = await prefsModule();
    await expect(loadPrefs()).resolves.toEqual({});
    expect(currentPrefs()).toEqual({});
  });

  it("reads the store only once", async () => {
    const { loadPrefs } = await prefsModule();
    await loadPrefs();
    await loadPrefs();
    expect(apiMock.getPrefs).toHaveBeenCalledOnce();
  });

  it("applies a change locally at once and persists it", async () => {
    const { loadPrefs, setPref, currentPrefs } = await prefsModule();
    await loadPrefs();
    setPref("homeSearch", "invoice");
    expect(currentPrefs().homeSearch).toBe("invoice");
    expect(apiMock.setPref).toHaveBeenCalledWith("homeSearch", "invoice");
  });

  it("keeps the local value when persisting fails", async () => {
    apiMock.setPref.mockRejectedValueOnce(new Error("PREFS_SAVE_FAILED: disk is full"));
    const { loadPrefs, setPref, currentPrefs } = await prefsModule();
    await loadPrefs();
    setPref("resultRows", 25);
    // A preference is not worth interrupting the user for; the value still
    // applies for this session.
    expect(currentPrefs().resultRows).toBe(25);
  });
});
