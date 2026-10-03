import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  statAsset: vi.fn(),
  putAssetChunk: vi.fn(),
}));

vi.mock("../api", () => ({ api: apiMock }));

vi.mock("@excalidraw/excalidraw", () => ({
  restore: vi.fn((data: { elements?: unknown; appState?: unknown; files?: unknown }) => ({
    elements: data.elements ?? [],
    appState: data.appState ?? {},
    files: data.files ?? {},
  })),
  serializeAsJSON: vi.fn(() => '{"type":"excalidraw","serialized":true}'),
  convertToExcalidrawElements: vi.fn(
    (skeletons: { x?: number; y?: number; width?: number; height?: number; fileId?: string }[]) =>
      skeletons.map((skeleton, index) => ({
        id: `converted-${index}`,
        type: "image",
        x: skeleton.x ?? 0,
        y: skeleton.y ?? 0,
        width: skeleton.width ?? 0,
        height: skeleton.height ?? 0,
        fileId: skeleton.fileId,
      })),
  ),
}));

// The persistence module keeps an upload cache at module scope and the
// clipboard module is imported through it, so every test gets fresh copies.
async function freshClipboard() {
  vi.resetModules();
  return await import("../clipboard");
}

function stubBridge(bridge: Record<string, unknown> | undefined): void {
  (globalThis as unknown as { window: unknown }).window = bridge === undefined ? {} : { dbxPlugin: bridge };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

beforeEach(() => {
  vi.clearAllMocks();
});

function baseElement(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...overrides,
  };
}

/** A small scene exercising every cross-reference the remapper must fix. */
function crossReferencedScene(): { text: string; ids: string[] } {
  const elements = [
    baseElement({ id: "frame-1", type: "frame", name: "Frame" }),
    baseElement({
      id: "rect-1",
      x: 10,
      y: 20,
      groupIds: ["g-1"],
      frameId: "frame-1",
      boundElements: [{ id: "text-1", type: "text" }],
    }),
    baseElement({ id: "text-1", type: "text", x: 12, y: 22, groupIds: ["g-1"], containerId: "rect-1" }),
    baseElement({
      id: "rect-2",
      type: "image",
      x: 200,
      y: 200,
      fileId: "file-1",
    }),
    baseElement({
      id: "arrow-1",
      type: "arrow",
      startBinding: { elementId: "rect-1", focus: 0, gap: 1 },
      endBinding: { elementId: "rect-2", focus: 0, gap: 1 },
    }),
  ];
  const files = { "file-1": { id: "file-1", mimeType: "image/png", created: 1, dataURL: "data:image/png;base64,AAA" } };
  return { text: JSON.stringify({ type: "excalidraw", elements, files }), ids: elements.map((e) => e.id as string) };
}

function loose(element: unknown): Record<string, unknown> {
  return element as Record<string, unknown>;
}

describe("copySceneToClipboard", () => {
  it("writes the serialized scene through clipboard.writeText", async () => {
    const writeText = vi.fn(async () => undefined);
    const copy = vi.fn(async () => undefined);
    stubBridge({ clipboard: { writeText }, copy });
    const { copySceneToClipboard } = await freshClipboard();

    await copySceneToClipboard([], {}, {});
    expect(writeText).toHaveBeenCalledWith('{"type":"excalidraw","serialized":true}');
    expect(copy).not.toHaveBeenCalled();
  });

  it("falls back to copy when the clipboard sub-object is absent", async () => {
    const copy = vi.fn(async () => undefined);
    stubBridge({ copy });
    const { copySceneToClipboard } = await freshClipboard();

    await copySceneToClipboard([], {}, {});
    expect(copy).toHaveBeenCalledWith('{"type":"excalidraw","serialized":true}');
  });

  it("does not fall back after a writeText rejection — it fails", async () => {
    const copy = vi.fn(async () => undefined);
    stubBridge({ clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, copy });
    const { copySceneToClipboard, ClipboardError } = await freshClipboard();

    const error = await copySceneToClipboard([], {}, {}).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ClipboardError);
    expect((error as { code: string }).code).toBe("WRITE_FAILED");
    expect(copy).not.toHaveBeenCalled();
  });

  it("fails with WRITE_FAILED when the host has no write surface at all", async () => {
    stubBridge({});
    const { copySceneToClipboard, ClipboardError } = await freshClipboard();

    const error = await copySceneToClipboard([], {}, {}).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ClipboardError);
    expect((error as { code: string }).code).toBe("WRITE_FAILED");
  });

  it("refuses a scene whose request envelope exceeds the host's 2 MiB cap without touching the bridge", async () => {
    const writeText = vi.fn(async () => undefined);
    stubBridge({ clipboard: { writeText } });
    const { copySceneToClipboard, ClipboardError } = await freshClipboard();
    const excalidraw = await import("@excalidraw/excalidraw");
    vi.mocked(excalidraw.serializeAsJSON).mockReturnValueOnce("x".repeat(3 * 1024 * 1024));

    const error = await copySceneToClipboard([], {}, {}).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ClipboardError);
    expect((error as { code: string }).code).toBe("WRITE_FAILED");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("measures the request envelope, not the raw scene string: escaping alone can cross the cap", async () => {
    const writeText = vi.fn(async () => undefined);
    stubBridge({ clipboard: { writeText } });
    const { copySceneToClipboard, ClipboardError } = await freshClipboard();
    const excalidraw = await import("@excalidraw/excalidraw");
    // ~1.1M newlines: raw bytes sit under the cap, but the JSON-encoded
    // envelope escapes each to \n and doubles past it — exactly what the
    // host's params-level byte check would reject.
    vi.mocked(excalidraw.serializeAsJSON).mockReturnValueOnce("\n".repeat(1_100_000));

    const error = await copySceneToClipboard([], {}, {}).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ClipboardError);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("readSceneFromClipboard", () => {
  it("remaps every id and cross-reference of a pasted scene", async () => {
    const { text, ids } = crossReferencedScene();
    stubBridge({ clipboard: { readText: vi.fn(async () => text) } });
    const { readSceneFromClipboard } = await freshClipboard();

    const pasted = await readSceneFromClipboard({ x: 32, y: 32 });
    expect(pasted.elements).toHaveLength(5);
    for (const element of pasted.elements) {
      expect(ids).not.toContain(loose(element).id);
    }

    const byOld = (old: string, via: (candidate: Record<string, unknown>) => boolean) => {
      const found = pasted.elements.find(via);
      expect(found).toBeDefined();
      return loose(found);
    };

    // The text's containerId points at the new rectangle; the rectangle's
    // boundElements point back at the new text.
    const newText = loose(pasted.elements.find((e) => loose(e).containerId));
    const newRect = byOld("rect-1", (candidate) => candidate.id === newText.containerId);
    expect(newRect.type).toBe("rectangle");
    expect(newRect.boundElements).toEqual([{ id: newText.id, type: "text" }]);

    // Group ids survive as a shared (but new) id on both members.
    const rectGroup = newRect.groupIds as string[];
    expect((newText.groupIds as string[])[0]).toBe(rectGroup[0]);
    expect(rectGroup[0]).not.toBe("g-1");

    // Frame, arrow bindings and image fileId all land in the new id space.
    const newFrame = byOld("frame-1", (candidate) => candidate.id === newRect.frameId);
    expect(newFrame.type).toBe("frame");

    const newArrow = loose(pasted.elements.find((e) => loose(e).startBinding));
    expect(newArrow.startBinding).toMatchObject({ elementId: newRect.id });
    expect((newArrow.endBinding as { elementId: string }).elementId).toBe(
      loose(pasted.elements.find((e) => loose(e).fileId)).id,
    );

    const newFiles = Object.keys(pasted.files);
    expect(newFiles).toHaveLength(1);
    expect(newFiles).not.toContain("file-1");
    expect(loose(pasted.elements.find((e) => loose(e).fileId)).fileId).toBe(newFiles[0]);

    // Offset applied, seed reissued.
    expect(newRect.x).toBe(42);
    expect(newRect.y).toBe(52);
    expect(newRect.seed).not.toBe(1);
  });

  it("treats an empty clipboard, non-JSON and scene-less JSON as INVALID_SCENE", async () => {
    const cases = ["", "   ", "not json", JSON.stringify({ elements: [] }), JSON.stringify({ nope: true }), JSON.stringify({ elements: [{ x: 1 }] })];
    for (const payload of cases) {
      stubBridge({ clipboard: { readText: vi.fn(async () => payload) } });
      const { readSceneFromClipboard, ClipboardError } = await freshClipboard();
      const error = await readSceneFromClipboard().then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(ClipboardError);
      expect((error as { code: string }).code).toBe("INVALID_SCENE");
    }
  });

  it("drops structural references that point outside the pasted set", async () => {
    const elements = [
      baseElement({
        id: "rect-1",
        boundElements: [
          { id: "text-1", type: "text" },
          { id: "ghost", type: "text" },
        ],
      }),
      baseElement({ id: "text-1", type: "text", containerId: "ghost-rect" }),
      baseElement({
        id: "arrow-1",
        type: "arrow",
        startBinding: { elementId: "ghost-rect", focus: 0, gap: 1 },
        endBinding: { elementId: "rect-1", focus: 0, gap: 1 },
        frameId: "ghost-frame",
      }),
    ];
    stubBridge({ clipboard: { readText: vi.fn(async () => JSON.stringify({ type: "excalidraw", elements, files: {} })) } });
    const { readSceneFromClipboard } = await freshClipboard();

    const pasted = await readSceneFromClipboard();
    const newText = loose(pasted.elements.find((e) => loose(e).type === "text"));
    expect(newText.containerId).toBeNull();

    const newRect = loose(pasted.elements.find((e) => loose(e).type === "rectangle"));
    const boundIds = (newRect.boundElements as { id: string }[]).map((bound) => bound.id);
    expect(boundIds).toHaveLength(1);
    expect(boundIds[0]).not.toBe("text-1");

    const newArrow = loose(pasted.elements.find((e) => loose(e).type === "arrow"));
    expect(newArrow.startBinding).toBeNull();
    expect(newArrow.frameId).toBeNull();
    // The end binding points at a member of the pasted set: preserved, remapped.
    const endTarget = (newArrow.endBinding as { elementId: string }).elementId;
    expect(endTarget).not.toBe("rect-1");
    expect(loose(pasted.elements.find((e) => loose(e).id === endTarget)).type).toBe("rectangle");
  });

  it("fails with READ_FAILED when the read itself is impossible", async () => {
    stubBridge({ clipboard: { readText: vi.fn(async () => { throw new Error("denied"); }) } });
    const denied = await freshClipboard();
    const error = await denied.readSceneFromClipboard().then(() => null, (e: unknown) => e);
    expect((error as { code: string }).code).toBe("READ_FAILED");

    stubBridge({});
    const noSurface = await freshClipboard();
    const error2 = await noSurface.readSceneFromClipboard().then(() => null, (e: unknown) => e);
    expect((error2 as { code: string }).code).toBe("READ_FAILED");

    delete (globalThis as unknown as { window?: unknown }).window;
    const noBridge = await freshClipboard();
    const error3 = await noBridge.readSceneFromClipboard().then(() => null, (e: unknown) => e);
    expect((error3 as { code: string }).code).toBe("READ_FAILED");
  });
});

describe("readClipboardImage", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const payload = {
    contentType: "image/png" as const,
    dataBase64: Buffer.from(bytes).toString("base64"),
    width: 640,
    height: 480,
  };

  it("decodes the PNG payload", async () => {
    stubBridge({ clipboard: { readImage: vi.fn(async () => payload) } });
    const { readClipboardImage } = await freshClipboard();

    const image = await readClipboardImage();
    expect(Array.from(image.bytes)).toEqual(Array.from(bytes));
    expect(image.width).toBe(640);
    expect(image.height).toBe(480);
  });

  it("fails with READ_FAILED on denial, wrong type, or an empty payload", async () => {
    stubBridge({ clipboard: { readImage: vi.fn(async () => { throw new Error("denied"); }) } });
    const expectCode = async (promise: Promise<unknown>): Promise<string> => {
      const error = await promise.then(() => null, (e: unknown) => e);
      expect((error as { name: string }).name).toBe("ClipboardError");
      return (error as { code: string }).code;
    };

    stubBridge({ clipboard: { readImage: vi.fn(async () => { throw new Error("denied"); }) } });
    const mod1 = await freshClipboard();
    expect(await expectCode(mod1.readClipboardImage())).toBe("READ_FAILED");

    stubBridge({ clipboard: { readImage: vi.fn(async () => ({ ...payload, contentType: "image/jpeg" })) } });
    const mod2 = await freshClipboard();
    expect(await expectCode(mod2.readClipboardImage())).toBe("READ_FAILED");

    stubBridge({ clipboard: { readImage: vi.fn(async () => ({ ...payload, dataBase64: "" })) } });
    const mod3 = await freshClipboard();
    expect(await expectCode(mod3.readClipboardImage())).toBe("READ_FAILED");
  });
});

describe("scaledImageSize", () => {
  it("caps the long side and preserves the aspect ratio", async () => {
    const { scaledImageSize } = await freshClipboard();
    expect(scaledImageSize(1600, 800)).toEqual({ width: 800, height: 400 });
    expect(scaledImageSize(800, 1600)).toEqual({ width: 400, height: 800 });
    expect(scaledImageSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(scaledImageSize(1, 1)).toEqual({ width: 1, height: 1 });
  });
});

describe("buildImageInsert", () => {
  it("uploads the bytes once and returns a matching file + element pair", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const hash = createHash("sha256").update(bytes).digest("hex");
    apiMock.statAsset.mockResolvedValue({ exists: false, asset: {} });
    apiMock.putAssetChunk.mockResolvedValue({ received: bytes.length, complete: true });
    stubBridge({});
    const { buildImageInsert } = await freshClipboard();

    const first = await buildImageInsert("doc-1", { bytes, width: 1600, height: 800 }, { x: 5, y: 6 });
    expect(apiMock.statAsset).toHaveBeenCalledWith(hash);
    const chunk = apiMock.putAssetChunk.mock.calls[0][0];
    expect(chunk).toMatchObject({ documentId: "doc-1", hash, mimeType: "image/png", size: 4, offset: 0 });
    expect(first.file.dataURL).toBe(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
    expect(first.element).toMatchObject({ x: 5, y: 6, width: 800, height: 400 });

    // A second insert of the same bytes must not re-upload (the module-level
    // known-asset cache is shared with scene persistence).
    await buildImageInsert("doc-1", { bytes, width: 1600, height: 800 }, { x: 0, y: 0 });
    expect(apiMock.putAssetChunk).toHaveBeenCalledOnce();
  });
});

describe("sceneCenter", () => {
  it("returns the bounding-box center and skips deleted elements", async () => {
    const { sceneCenter } = await freshClipboard();
    const a = baseElement({ x: 0, y: 0, width: 100, height: 40 });
    const b = baseElement({ x: 100, y: 80, width: 20, height: 20 });
    const dead = baseElement({ x: 999, y: 999, width: 1, height: 1, isDeleted: true });

    expect(sceneCenter([])).toEqual({ x: 0, y: 0 });
    expect(sceneCenter([dead as never])).toEqual({ x: 0, y: 0 });
    expect(sceneCenter([a, b, dead] as never)).toEqual({ x: 60, y: 50 });
  });
});
