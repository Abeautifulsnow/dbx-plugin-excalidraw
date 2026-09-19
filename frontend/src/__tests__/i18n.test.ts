import { describe, expect, it } from "vitest";
import { format, pickLang, strings } from "../i18n";

describe("pickLang", () => {
  it("maps DBX locales to supported languages", () => {
    expect(pickLang("zh-CN")).toBe("zh");
    expect(pickLang("zh")).toBe("zh");
    expect(pickLang("en-US")).toBe("en");
    expect(pickLang("fr")).toBe("en");
    expect(pickLang(undefined)).toBe("en");
  });
});

describe("string tables", () => {
  it("keeps en and zh key sets identical", () => {
    expect(Object.keys(strings.en).sort()).toEqual(Object.keys(strings.zh).sort());
  });

  it("keeps every string non-empty", () => {
    for (const [lang, table] of Object.entries(strings)) {
      for (const [key, value] of Object.entries(table)) {
        expect(value.trim(), `${lang}.${key}`).not.toBe("");
      }
    }
  });
});

describe("format", () => {
  it("substitutes placeholders", () => {
    expect(format(strings.en.minutesAgo, 5)).toBe("5 min ago");
    expect(format(strings.zh.minutesAgo, 5)).toBe("5 分钟前");
  });
});
