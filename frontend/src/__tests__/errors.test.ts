import { describe, expect, it } from "vitest";
import { errorDetail, withCause } from "../errors";

describe("errorDetail", () => {
  it("returns an Error's message", () => {
    expect(errorDetail(new Error("Connection is not open"))).toBe("Connection is not open");
  });

  it("stringifies non-Error causes", () => {
    expect(errorDetail("host offline")).toBe("host offline");
    expect(errorDetail(42)).toBe("42");
  });

  it("omits the useless [object Object] default", () => {
    expect(errorDetail({ some: "object" })).toBe("");
  });

  it("follows a cause chain one wrapper deep", () => {
    const error = new Error("the host refused the clipboard read");
    (error as { cause?: unknown }).cause = new Error("permission denied");
    expect(errorDetail(error)).toBe("the host refused the clipboard read: permission denied");
  });

  it("caps the chain at three levels", () => {
    const fourth = new Error("m4");
    const third = new Error("m3");
    (third as { cause?: unknown }).cause = fourth;
    const second = new Error("m2");
    (second as { cause?: unknown }).cause = third;
    const first = new Error("m1");
    (first as { cause?: unknown }).cause = second;
    expect(errorDetail(first)).toBe("m1: m2: m3");
  });

  it("clips runaway details", () => {
    expect(errorDetail(new Error("x".repeat(400)))).toBe(`${"x".repeat(300)}…`);
  });
});

describe("withCause", () => {
  it("appends the cause's message to the base copy behind an em dash", () => {
    expect(withCause("计划失败", new Error("Connection is not open"))).toBe("计划失败 — Connection is not open");
  });

  it("returns the base copy unchanged when the cause carries no detail", () => {
    expect(withCause("导入失败", undefined)).toBe("导入失败");
    expect(withCause("导入失败", { no: "message" })).toBe("导入失败");
  });
});
