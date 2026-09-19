import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  getDocument: vi.fn(),
  saveScene: vi.fn(),
  renameDocument: vi.fn(),
  deleteDocument: vi.fn(),
  statAsset: vi.fn(),
  putAssetChunk: vi.fn(),
  getAssetChunk: vi.fn(),
}));

vi.mock("../api", () => {
  return {
    api: apiMock,
    ApiError: class ApiError extends Error {
      readonly code: string;
      constructor(code: string, message: string) {
        super(message);
        this.name = "ApiError";
        this.code = code;
      }
    },
  };
});

vi.mock("@excalidraw/excalidraw", () => ({
  restore: vi.fn((data: { elements?: unknown; appState?: unknown; files?: unknown }) => ({
    elements: data.elements ?? [],
    appState: data.appState ?? {},
    files: data.files ?? {},
  })),
  serializeAsJSON: vi.fn(
    (_elements: unknown, _appState: unknown, files: unknown) =>
      JSON.stringify({ type: "excalidraw", version: 2, source: "test", elements: [], appState: {}, files }),
  ),
}));

// The module keeps an upload cache at module scope, so every test gets a
// fresh instance to stay independent.
async function freshPersistence() {
  vi.resetModules();
  return await import("../persistence");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pngDataURL(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

const meta = { id: "doc-1", name: "Test", createdAt: "", updatedAt: "", lastOpenedAt: "", formatVersion: 1 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistScene", () => {
  it("strips image dataURLs and uploads the binary once", async () => {
    const { persistScene } = await freshPersistence();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    apiMock.statAsset.mockResolvedValue({ exists: false, asset: {} });
    apiMock.putAssetChunk.mockResolvedValue({ received: bytes.length, complete: true });
    apiMock.saveScene.mockResolvedValue(meta);

    await persistScene("doc-1", [], {}, {
      img1: { id: "img1", mimeType: "image/png", created: 42, dataURL: pngDataURL(bytes) },
    } as never);

    expect(apiMock.statAsset).toHaveBeenCalledWith(sha256(bytes));
    expect(apiMock.putAssetChunk).toHaveBeenCalledOnce();
    const chunk = apiMock.putAssetChunk.mock.calls[0][0];
    expect(chunk).toMatchObject({
      documentId: "doc-1",
      hash: sha256(bytes),
      mimeType: "image/png",
      size: 5,
      offset: 0,
    });
    expect(Buffer.from(chunk.dataBase64, "base64")).toEqual(Buffer.from(bytes));

    const savedScene = apiMock.saveScene.mock.calls[0][1];
    expect(savedScene.files.img1).toMatchObject({ hash: sha256(bytes), size: 5, mimeType: "image/png" });
    expect(savedScene.files.img1.dataURL).toBeUndefined();
  });

  it("splits large images into sequential 512 KiB chunks", async () => {
    const { persistScene } = await freshPersistence();
    const bytes = new Uint8Array(1_200_000);
    bytes.fill(7);
    apiMock.statAsset.mockResolvedValue({ exists: false, asset: {} });
    apiMock.putAssetChunk.mockResolvedValue({ received: 0, complete: false });
    apiMock.saveScene.mockResolvedValue(meta);

    await persistScene("doc-1", [], {}, {
      img1: { id: "img1", mimeType: "image/png", created: 1, dataURL: pngDataURL(bytes) },
    } as never);

    const calls = apiMock.putAssetChunk.mock.calls.map((call) => call[0]);
    expect(calls.map((call) => call.offset)).toEqual([0, 524_288, 1_048_576]);
    expect(calls.map((call) => call.dataBase64.length)).toEqual([
      Math.ceil(524_288 / 3) * 4,
      Math.ceil(524_288 / 3) * 4,
      Math.ceil(151_424 / 3) * 4,
    ]);
    expect(calls.every((call) => call.size === 1_200_000 && call.hash === sha256(bytes))).toBe(true);
  });

  it("skips the upload entirely when the backend already has the hash", async () => {
    const { persistScene } = await freshPersistence();
    const bytes = new Uint8Array([9, 9, 9]);
    apiMock.statAsset.mockResolvedValue({ exists: true, asset: { hash: sha256(bytes) } });
    apiMock.saveScene.mockResolvedValue(meta);

    await persistScene("doc-1", [], {}, {
      img1: { id: "img1", mimeType: "image/png", created: 1, dataURL: pngDataURL(bytes) },
    } as never);

    expect(apiMock.putAssetChunk).not.toHaveBeenCalled();
    const savedScene = apiMock.saveScene.mock.calls[0][1];
    expect(savedScene.files.img1.hash).toBe(sha256(bytes));
  });

  it("reuses the session cache without consulting statAsset twice", async () => {
    const { persistScene } = await freshPersistence();
    const bytes = new Uint8Array([4, 2]);
    apiMock.statAsset.mockResolvedValue({ exists: false, asset: {} });
    apiMock.putAssetChunk.mockResolvedValue({ received: 2, complete: true });
    apiMock.saveScene.mockResolvedValue(meta);
    const files = {
      img1: { id: "img1", mimeType: "image/png", created: 1, dataURL: pngDataURL(bytes) },
    } as never;

    await persistScene("doc-1", [], {}, files);
    await persistScene("doc-1", [], {}, files);

    expect(apiMock.statAsset).toHaveBeenCalledOnce();
    expect(apiMock.putAssetChunk).toHaveBeenCalledOnce();
    expect(apiMock.saveScene).toHaveBeenCalledTimes(2);
  });
});

describe("loadDocument", () => {
  it("rehydrates hashed file entries into standard dataURL files", async () => {
    const { loadDocument } = await freshPersistence();
    const bytes = new Uint8Array([10, 20, 30]);
    apiMock.getDocument.mockResolvedValue({
      document: meta,
      corrupt: false,
      scene: {
        type: "excalidraw",
        version: 2,
        elements: [{ id: "e1", type: "rectangle" }],
        files: { img1: { id: "img1", mimeType: "image/png", created: 7, hash: sha256(bytes), size: 3 } },
      },
    });
    apiMock.getAssetChunk.mockResolvedValue({
      dataBase64: Buffer.from(bytes).toString("base64"),
      size: bytes.length,
      mimeType: "image/png",
    });

    const loaded = await loadDocument("doc-1");
    expect(apiMock.getAssetChunk).toHaveBeenCalledWith(sha256(bytes), 0, expect.any(Number));
    expect(loaded.files.img1).toMatchObject({ id: "img1", mimeType: "image/png", dataURL: pngDataURL(bytes) });
    expect(loaded.elements).toEqual([{ id: "e1", type: "rectangle" }]);
  });

  it("keeps inline dataURL files untouched", async () => {
    const { loadDocument } = await freshPersistence();
    apiMock.getDocument.mockResolvedValue({
      document: meta,
      corrupt: false,
      scene: {
        elements: [],
        files: { img1: { id: "img1", mimeType: "image/png", created: 1, dataURL: pngDataURL(new Uint8Array([1])) } },
      },
    });

    const loaded = await loadDocument("doc-1");
    expect(apiMock.getAssetChunk).not.toHaveBeenCalled();
    expect(loaded.files.img1.dataURL).toBe(pngDataURL(new Uint8Array([1])));
  });

  it("rejects corrupt scenes instead of restoring a blank canvas", async () => {
    const { loadDocument } = await freshPersistence();
    apiMock.getDocument.mockResolvedValue({ document: meta, corrupt: true, scene: null });
    await expect(loadDocument("doc-1")).rejects.toMatchObject({ code: "DOCUMENT_CORRUPT" });
  });
});
