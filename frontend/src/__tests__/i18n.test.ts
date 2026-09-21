import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXCALIDRAW_LANGS, excalidrawLangCode, format, pickLang, strings } from "../i18n";

describe("pickLang", () => {
  it("maps DBX locales to supported languages", () => {
    expect(pickLang("zh-CN")).toBe("zh");
    expect(pickLang("zh")).toBe("zh");
    expect(pickLang("en-US")).toBe("en");
    expect(pickLang("fr")).toBe("en");
    expect(pickLang(undefined)).toBe("en");
  });
});

describe("excalidrawLangCode", () => {
  it("resolves every locale the DBX host can report to a real translation", () => {
    // The host's locale options are a closed set. Five of them use a bare
    // primary tag the editor does not key on, so a straight passthrough would
    // drop those users back to English without saying so — this is the test
    // that would catch a regression to `langCode={locale}`.
    const hostLocales = ["en", "az", "es", "it", "ja", "ko", "pt-BR", "tr", "zh-CN", "zh-TW"];
    expect(hostLocales.map(excalidrawLangCode)).toEqual([
      "en",
      "az-AZ",
      "es-ES",
      "it-IT",
      "ja-JP",
      "ko-KR",
      "pt-BR",
      "tr-TR",
      "zh-CN",
      "zh-TW",
    ]);
  });

  it("keeps a code the editor already knows", () => {
    expect(excalidrawLangCode("zh-CN")).toBe("zh-CN");
    expect(excalidrawLangCode("pt-BR")).toBe("pt-BR");
    expect(excalidrawLangCode("en")).toBe("en");
  });

  it("widens a region the editor does not ship to the one it does", () => {
    expect(excalidrawLangCode("en-US")).toBe("en");
    expect(excalidrawLangCode("de-AT")).toBe("de-DE");
    expect(excalidrawLangCode("zh-Hans")).toBe("zh-CN");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(excalidrawLangCode("JA")).toBe("ja-JP");
    expect(excalidrawLangCode(" zh-TW ")).toBe("zh-TW");
  });

  it("falls back to English for a language the editor does not ship", () => {
    expect(excalidrawLangCode("xx")).toBe("en");
    expect(excalidrawLangCode("")).toBe("en");
    expect(excalidrawLangCode(undefined)).toBe("en");
  });

  it("matches the locales the installed Excalidraw package actually ships", () => {
    // The table is hand-copied from the package, so it is the one thing that
    // drifts silently on an upgrade: a renamed or dropped locale would send
    // those users back to English with nothing to notice it. Locale chunks are
    // named `<code>-<contenthash>.js`; `percentages-*.js` is not a locale, which
    // the language-tag filter drops.
    const localesDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../node_modules/@excalidraw/excalidraw/dist/prod/locales",
    );
    const shipped = readdirSync(localesDir)
      .map((file) => file.replace(/\.js$/, "").replace(/-[A-Z0-9]{8}$/, ""))
      .filter((code) => /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(code))
      .sort();
    expect(shipped.length).toBeGreaterThan(0);
    expect([...EXCALIDRAW_LANGS].sort()).toEqual(shipped);
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
