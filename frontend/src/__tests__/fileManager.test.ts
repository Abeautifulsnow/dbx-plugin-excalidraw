import { afterEach, describe, expect, it, vi } from "vitest";
import { DIRECTORY_URIS, revealInFileManager } from "../fileManager";
import { FILESYSTEM_PROVIDER_ID } from "../types";

function stubBridge(bridge: Record<string, unknown> | undefined): void {
  (globalThis as unknown as { window: unknown }).window = bridge === undefined ? {} : { dbxPlugin: bridge };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("revealInFileManager", () => {
  it("opens our provider at the requested directory", async () => {
    const openFilesystem = vi.fn(async () => undefined);
    stubBridge({ openFilesystem });
    await revealInFileManager("exports");
    expect(openFilesystem).toHaveBeenCalledWith(FILESYSTEM_PROVIDER_ID, { uri: "excalidraw:/exports/" });
  });

  it("only ever passes URIs the provider reports as its own root entries", () => {
    // These strings are what FSList returns for the two root directories; the
    // host turns them straight into the file manager's initial folder.
    expect(DIRECTORY_URIS).toEqual({
      documents: "excalidraw:/documents/",
      exports: "excalidraw:/exports/",
    });
  });

  it("rejects rather than silently doing nothing when the host omits the method", async () => {
    stubBridge({});
    await expect(revealInFileManager("documents")).rejects.toThrow(/unavailable/);
  });

  it("rejects when there is no bridge at all", async () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    await expect(revealInFileManager("documents")).rejects.toThrow(/unavailable/);
  });

  it("propagates a host permission failure to the caller", async () => {
    const openFilesystem = vi.fn(async () => {
      throw new Error("Plugin has not declared permission 'host.filesystem'");
    });
    stubBridge({ openFilesystem });
    await expect(revealInFileManager("documents")).rejects.toThrow(/host\.filesystem/);
  });
});
