import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api";

function stubBridge(invoke: (method: string, params?: unknown) => Promise<unknown> | unknown) {
  (globalThis as unknown as { window: unknown }).window = {
    dbxPlugin: { invoke: vi.fn(invoke) },
  };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("api adapter", () => {
  it("passes through successful results", async () => {
    stubBridge(() => ({ items: [] }));
    await expect(api.listDocuments()).resolves.toEqual({ items: [] });
  });

  it("maps CATEGORY: message backend errors to typed ApiError", async () => {
    stubBridge(() => {
      throw new Error("DOCUMENT_SAVE_FAILED: Unable to save diagram.");
    });
    const error = await api.saveScene("doc", {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("DOCUMENT_SAVE_FAILED");
    expect((error as ApiError).message).toBe("Unable to save diagram.");
  });

  it("wraps non-categorized failures as BACKEND_UNAVAILABLE", async () => {
    stubBridge(() => {
      throw new Error("sidecar crashed");
    });
    const error = await api.listDocuments().catch((caught: unknown) => caught);
    expect((error as ApiError).code).toBe("BACKEND_UNAVAILABLE");
  });

  it("reports a missing plugin bridge as BACKEND_UNAVAILABLE", async () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    const error = await api.listDocuments().catch((caught: unknown) => caught);
    expect((error as ApiError).code).toBe("BACKEND_UNAVAILABLE");
  });

  it("sends method and params to the bridge", async () => {
    const invoke = vi.fn(() => ({}));
    stubBridge(invoke);
    await api.renameDocument("doc-1", "New Name");
    expect(invoke).toHaveBeenCalledWith("document/rename", { id: "doc-1", name: "New Name" });
  });

  it("routes export chunks to the export/write method", async () => {
    const invoke = vi.fn(() => ({ received: 3, complete: true, path: "p.png" }));
    stubBridge(invoke);
    const result = await api.writeExportChunk({ jobId: "job", name: "a.png", size: 3, offset: 0, dataBase64: "AAA=" });
    expect(invoke).toHaveBeenCalledWith("export/write", {
      jobId: "job",
      name: "a.png",
      size: 3,
      offset: 0,
      dataBase64: "AAA=",
    });
    expect(result.path).toBe("p.png");
  });
});
