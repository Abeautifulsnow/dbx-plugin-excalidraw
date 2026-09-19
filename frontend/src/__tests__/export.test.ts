import { beforeEach, describe, expect, it, vi } from "vitest";

const excalidrawMock = vi.hoisted(() => ({
  exportToBlob: vi.fn(async () => new Blob(["png-bytes"], { type: "image/png" })),
  exportToSvg: vi.fn(async () => ({ outerHTML: "<svg></svg>" })),
  serializeAsJSON: vi.fn(() => '{"type":"excalidraw"}'),
  MIME_TYPES: { excalidraw: "application/vnd.excalidraw+json" },
}));

vi.mock("@excalidraw/excalidraw", () => excalidrawMock);

interface CapturedAnchor {
  href: string;
  download: string;
  clicks: number;
}

let captured: CapturedAnchor;

beforeEach(() => {
  captured = { href: "", download: "", clicks: 0 };
  vi.stubGlobal("document", {
    createElement: () => ({
      set href(value: string) {
        captured.href = value;
      },
      set download(value: string) {
        captured.download = value;
      },
      click() {
        captured.clicks += 1;
      },
      remove: () => {},
    }),
    body: { appendChild: () => {} },
  });
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:mock",
    revokeObjectURL: () => {},
  });
});

describe("exportScene", () => {
  it("exports .excalidraw with a sanitized file name", async () => {
    const { exportScene } = await import("../export");
    await exportScene("excalidraw", 'My: Diagram "v2"?', [], {}, {});
    expect(captured.download).toBe("My_ Diagram _v2_.excalidraw");
    expect(excalidrawMock.serializeAsJSON).toHaveBeenCalled();
  });

  it("renders PNG through the official exporter", async () => {
    const { exportScene } = await import("../export");
    await exportScene("png", "Diagram", [], {}, {});
    expect(excalidrawMock.exportToBlob).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png" }),
    );
    expect(captured.download).toBe("Diagram.png");
  });

  it("renders SVG through the official exporter", async () => {
    const { exportScene } = await import("../export");
    await exportScene("svg", "Diagram", [], {}, {});
    expect(excalidrawMock.exportToSvg).toHaveBeenCalled();
    expect(captured.download).toBe("Diagram.svg");
  });

  it("keeps a usable name for blank input", async () => {
    const { exportScene } = await import("../export");
    await exportScene("excalidraw", "   ", [], {}, {});
    expect(captured.download).toBe("diagram.excalidraw");
  });
});
