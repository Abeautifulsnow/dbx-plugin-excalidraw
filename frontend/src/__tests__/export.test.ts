import { beforeEach, describe, expect, it, vi } from "vitest";

const excalidrawMock = vi.hoisted(() => ({
  exportToBlob: vi.fn(async () => new Blob(["png-bytes"], { type: "image/png" })),
  exportToSvg: vi.fn(async () => ({
    outerHTML:
      "<svg><style>@font-face{font-family:'Excalifont';src:url(https://esm.sh/excalidraw@0.18.1/dist/prod/fonts/Excalifont.woff2)}" +
      "@font-face{font-family:'Spaced';src:url( 'https://cdn.example.com/f.woff2' )}" +
      "@font-face{font-family:'Local';src:url(data:font/woff2;base64,AA==)}" +
      "text{font-family:'Excalifont'}</style></svg>",
  })),
  serializeAsJSON: vi.fn(() => '{"type":"excalidraw"}'),
  MIME_TYPES: { excalidraw: "application/vnd.excalidraw+json" },
}));

const apiMock = vi.hoisted(() => ({
  writeExportChunk: vi.fn(async (_params: unknown) => ({ received: 9, complete: true, path: "C:\\data\\exports\\x.png" })),
}));

vi.mock("@excalidraw/excalidraw", () => excalidrawMock);
vi.mock("../api", () => ({ api: apiMock }));

function decode(callIndex: number): string {
  const params = apiMock.writeExportChunk.mock.calls[callIndex][0] as { dataBase64: string };
  return Buffer.from(params.dataBase64, "base64").toString("utf-8");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exportScene", () => {
  it("writes the export through the backend and returns its path", async () => {
    const { exportScene } = await import("../export");
    const path = await exportScene("png", "Diagram", [], {}, {});
    expect(apiMock.writeExportChunk).toHaveBeenCalledOnce();
    expect(apiMock.writeExportChunk.mock.calls[0][0]).toMatchObject({
      name: "Diagram.png",
      size: 9,
      offset: 0,
    });
    expect(decode(0)).toBe("png-bytes");
    expect(path).toBe("C:\\data\\exports\\x.png");
  });

  it("keeps a usable name for blank or hostile input", async () => {
    const { exportScene } = await import("../export");
    await exportScene("excalidraw", 'My: Diagram "v2"?', [], {}, {});
    expect(apiMock.writeExportChunk.mock.calls[0][0]).toMatchObject({ name: 'My_ Diagram _v2_.excalidraw' });
    await exportScene("svg", "   ", [], {}, {});
    expect(apiMock.writeExportChunk.mock.calls[1][0]).toMatchObject({ name: "diagram.svg" });
  });

  it("truncates over-long names to the backend's 160-rune cap", async () => {
    const { exportScene } = await import("../export");
    await exportScene("excalidraw", "长".repeat(300), [], {}, {});
    const name = (apiMock.writeExportChunk.mock.calls[0][0] as { name: string }).name;
    expect(Array.from(name)).toHaveLength(160);
    expect(name.endsWith(".excalidraw")).toBe(true);
  });

  it("chunks large exports under one job id", async () => {
    const { exportScene } = await import("../export");
    const big = new Uint8Array(600_000).fill(7);
    excalidrawMock.exportToBlob.mockResolvedValueOnce(new Blob([big], { type: "image/png" }));
    await exportScene("png", "Big", [], {}, {});
    const calls = apiMock.writeExportChunk.mock.calls.map((call) => call[0] as { offset: number; jobId: string });
    expect(calls.map((call) => call.offset)).toEqual([0, 524_288]);
    expect(new Set(calls.map((call) => call.jobId)).size).toBe(1);
  });

  it("strips remote and blob font sources from SVG exports, keeps inline data:", async () => {
    const { exportScene } = await import("../export");
    await exportScene("svg", "Diagram", [], {}, {});
    const svg = decode(0);
    expect(svg).not.toContain("esm.sh");
    expect(svg).not.toContain("cdn.example.com");
    expect(svg).toContain("url(data:font/woff2;base64,AA==)");
    expect(svg).toContain("font-family:'Excalifont'");
  });

  it("serializes .excalidraw exports through the official serializer", async () => {
    const { exportScene } = await import("../export");
    await exportScene("excalidraw", "Diagram", [], {}, {});
    expect(excalidrawMock.serializeAsJSON).toHaveBeenCalled();
    expect(decode(0)).toBe('{"type":"excalidraw"}');
  });
});
