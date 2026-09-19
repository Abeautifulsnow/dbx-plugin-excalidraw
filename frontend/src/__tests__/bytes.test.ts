import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { base64ToBytes, bytesToBase64, bytesToDataURL, concatBytes, parseDataURL, sha256Hex } from "../bytes";

describe("sha256Hex", () => {
  it("matches known vectors via WebCrypto", async () => {
    const encoder = new TextEncoder();
    expect(await sha256Hex(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches node crypto on large random input", async () => {
    const bytes = new Uint8Array(1_000_000);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(await sha256Hex(bytes)).toBe(expected);
  });

  it("pure-JS fallback agrees with node crypto (no WebCrypto available)", async () => {
    vi.stubGlobal("crypto", {});
    const bytes = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(await sha256Hex(bytes)).toBe(expected);
    vi.unstubAllGlobals();
  });
});

describe("base64 helpers", () => {
  it("round-trips random bytes", () => {
    const bytes = new Uint8Array(700_000);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (index * 7) % 256;
    }
    const decoded = base64ToBytes(bytesToBase64(bytes));
    expect(decoded).toEqual(bytes);
  });

  it("encodes a known vector", () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2]))).toBe("AAEC");
    expect([...base64ToBytes("AAEC")]).toEqual([0, 1, 2]);
  });
});

describe("data URLs", () => {
  it("parses mime type and payload", () => {
    const { mimeType, bytes } = parseDataURL("data:image/png;base64,AAEC");
    expect(mimeType).toBe("image/png");
    expect([...bytes]).toEqual([0, 1, 2]);
  });

  it("round-trips through bytesToDataURL", () => {
    const original = "data:image/jpeg;base64,/9j/4AAQ";
    const { mimeType, bytes } = parseDataURL(original);
    expect(bytesToDataURL(bytes, mimeType)).toBe(original);
  });

  it("rejects non-data URLs", () => {
    expect(() => parseDataURL("https://example.com/image.png")).toThrow();
  });
});

describe("concatBytes", () => {
  it("joins chunks in order", () => {
    expect([...concatBytes([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])])]).toEqual([1, 2, 3]);
  });
});
