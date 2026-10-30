import { describe, expect, it } from "vitest";
import {
  APPEND_GAP,
  appendPlacement,
  buildGridScene,
  cellText,
  deriveName,
  initialRowLimit,
  makeIdPrefix,
  MAX_ROWS,
  mergeGridIntoScene,
  resolveRowLimit,
  ROW_CHOICES,
  rowChoices,
  SCENE_BYTE_LIMIT,
  sceneBounds,
  uniqueGridTitle,
  type ResultGrid,
} from "../resultScene";

const TITLE_FONT_SIZE = 20;
const CAPTION_FONT_SIZE = 12;

function grid(rows: number, columns: number): ResultGrid {
  return {
    columns: Array.from({ length: columns }, (_, index) => `col_${index}`),
    rows: Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, (_, column) => `r${row}c${column}`),
    ),
  };
}

function elementsOf(scene: ReturnType<typeof buildGridScene>["scene"]) {
  return scene.elements as Array<Record<string, unknown>>;
}

describe("cellText", () => {
  it("renders null and undefined as empty strings", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
  });

  it("flattens newlines so every row keeps a fixed height", () => {
    expect(cellText("a\nb")).toBe("a ⏎ b");
    expect(cellText("a\r\nb")).toBe("a ⏎ b");
    expect(cellText("a\tb")).toBe("a b");
  });

  it("bounds long values by width as well as character count", () => {
    const long = cellText("x".repeat(500));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
    // The widest column the layout allows must be able to hold it.
    const built = buildGridScene({ columns: ["c"], rows: [["x".repeat(500)]] }, { maxColumns: 1 });
    const header = elementsOf(built.scene).find((element) => element.id === "head-0");
    const text = elementsOf(built.scene).find((element) => element.id === "c-0-0");
    expect(header!.width as number).toBeLessThanOrEqual(320);
    expect(text!.text).toBe(long);
  });

  it("budgets full-width characters at roughly twice the Latin advance", () => {
    // Under-estimating CJK is not cosmetic: the scene is loaded through
    // restore(), which does not re-measure text, and export bounds come from
    // the stored width — so an under-estimate overlaps the next column and
    // clips in exports.
    const wide = "中".repeat(20);
    const narrow = "x".repeat(20);
    const wideScene = buildGridScene({ columns: ["名称"], rows: [[wide]] }, { maxColumns: 1 });
    const narrowScene = buildGridScene({ columns: ["name"], rows: [[narrow]] }, { maxColumns: 1 });
    const widthOf = (built: ReturnType<typeof buildGridScene>) =>
      (elementsOf(built.scene).find((element) => element.id === "head-0")?.width as number) ?? 0;
    expect(widthOf(wideScene)).toBeGreaterThan(widthOf(narrowScene));
    // 20 wide glyphs at ~1em each still fit the cap, so they survive intact...
    const fitted = elementsOf(wideScene.scene).find((element) => element.id === "c-0-0");
    expect(fitted!.text).toBe(wide);
    expect(widthOf(wideScene)).toBeLessThanOrEqual(320);

    // ...while a value too wide for even the widest column is clamped, so it
    // cannot overlap its neighbour.
    const overflowing = buildGridScene({ columns: ["名称"], rows: [["中".repeat(60)]] }, { maxColumns: 1 });
    const clamped = elementsOf(overflowing.scene).find((element) => element.id === "c-0-0");
    expect(String(clamped!.text).endsWith("…")).toBe(true);
    expect(String(clamped!.text).length).toBeLessThan(60);
  });

  it("unwraps DBX cell envelopes", () => {
    expect(cellText({ value: "inner" })).toBe("inner");
    expect(cellText({ value: null })).toBe("");
  });

  it("stringifies objects and primitives", () => {
    expect(cellText(42)).toBe("42");
    expect(cellText(false)).toBe("false");
    expect(cellText({ a: 1 })).toBe('{"a":1}');
  });
});

describe("buildGridScene", () => {
  it("emits a valid, plain-JSON excalidraw scene", () => {
    const { scene } = buildGridScene(grid(3, 2), { title: "T" });
    expect(scene.type).toBe("excalidraw");
    expect(scene.version).toBe(2);
    expect(scene.files).toEqual({});
    // Must survive the round trip the backend performs.
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
    for (const element of elementsOf(scene)) {
      expect(typeof element.id).toBe("string");
      expect(element.isDeleted).toBe(false);
      expect(Array.isArray(element.groupIds)).toBe(true);
      expect(typeof element.seed).toBe("number");
      expect(typeof element.versionNonce).toBe("number");
    }
  });

  it("is deterministic, so the same result set always yields the same scene", () => {
    const first = buildGridScene(grid(4, 3), { title: "T", caption: "select 1" });
    const second = buildGridScene(grid(4, 3), { title: "T", caption: "select 1" });
    expect(JSON.stringify(first.scene)).toBe(JSON.stringify(second.scene));
  });

  it("lays out one text element per cell plus the header", () => {
    const { scene, includedRows, includedColumns } = buildGridScene(grid(3, 2), {});
    expect(includedRows).toBe(3);
    expect(includedColumns).toBe(2);
    const cells = elementsOf(scene).filter((element) => /^c-\d+-\d+$/.test(String(element.id)));
    const headers = elementsOf(scene).filter((element) => /^head-text-/.test(String(element.id)));
    expect(cells).toHaveLength(6);
    expect(headers).toHaveLength(2);
  });

  it("keeps every table element inside the table band", () => {
    const { scene } = buildGridScene(grid(5, 2), { title: "T", caption: "select 1" });
    const table = elementsOf(scene).find((element) => element.id === "table");
    expect(table).toBeDefined();
    const left = table!.x as number;
    const top = table!.y as number;
    const right = left + (table!.width as number);
    const bottom = top + (table!.height as number);
    // Title and caption deliberately sit above the band; everything the table
    // owns (header, bands, cells) must stay within it.
    const inTable = elementsOf(scene).filter((element) =>
      /^(head-|head-text-|row-|c-|table$)/.test(String(element.id)),
    );
    expect(inTable.length).toBeGreaterThan(0);
    for (const element of inTable) {
      const x = element.x as number;
      const y = element.y as number;
      expect(x).toBeGreaterThanOrEqual(left - 1);
      expect(x + (element.width as number)).toBeLessThanOrEqual(right + 1);
      expect(y).toBeGreaterThanOrEqual(top - 1);
      expect(y + (element.height as number)).toBeLessThanOrEqual(bottom + 1);
    }
  });

  it("honours the row limit and reports what was dropped", () => {
    const built = buildGridScene(grid(20, 2), { maxRows: 5 });
    expect(built.includedRows).toBe(5);
    expect(built.totalRows).toBe(20);
    expect(built.droppedRows).toBe(true);
    expect(built.droppedColumns).toBe(false);
  });

  it("drops columns beyond the cap and says so", () => {
    const built = buildGridScene(grid(2, 40), { maxColumns: 6 });
    expect(built.includedColumns).toBe(6);
    expect(built.totalColumns).toBe(40);
    expect(built.droppedColumns).toBe(true);
  });

  it("trades rows away to stay under the byte budget", () => {
    const built = buildGridScene(grid(200, 8), { maxBytes: 60_000 });
    expect(built.bytes).toBeLessThanOrEqual(60_000);
    expect(built.includedRows).toBeLessThan(200);
    expect(built.droppedRows).toBe(true);
    expect(built.includedColumns).toBe(8);
  });

  // Halving overshot badly: a request for 200 rows that needed 190 landed on
  // 100, and every dropped row is information the user asked to see.
  it("keeps the largest row count that fits rather than halving", () => {
    const full = buildGridScene(grid(200, 8), { maxBytes: 10_000_000 });
    expect(full.includedRows).toBe(200);
    const perRow = full.bytes / 200;
    const budget = Math.floor(perRow * 190);
    const trimmed = buildGridScene(grid(200, 8), { maxBytes: budget });
    expect(trimmed.includedRows).toBeGreaterThan(150);
    expect(trimmed.includedRows).toBeLessThan(200);
    expect(trimmed.bytes).toBeLessThanOrEqual(budget);
  });

  it("terminates and reports zero rows when nothing fits", () => {
    const built = buildGridScene(grid(50, 4), { maxBytes: 1 });
    expect(built.includedRows).toBe(0);
    expect(built.droppedRows).toBe(true);
    expect(elementsOf(built.scene).some((element) => element.id === "table")).toBe(true);
  });

  it("still produces a scene when there are no rows", () => {
    const built = buildGridScene({ columns: ["a", "b"], rows: [] }, {});
    expect(built.includedRows).toBe(0);
    expect(elementsOf(built.scene).some((element) => element.id === "table")).toBe(true);
  });

  it("widens a column to fit its longest value, within limits", () => {
    const built = buildGridScene(
      { columns: ["short"], rows: [["x".repeat(400)], ["y"]] },
      { maxColumns: 1 },
    );
    const header = elementsOf(built.scene).find((element) => element.id === "head-0");
    expect(header!.width as number).toBeLessThanOrEqual(320);
    expect(header!.width as number).toBeGreaterThan(72);
  });
});

describe("deriveName", () => {
  it("names the canvas after the table the query reads from", () => {
    expect(deriveName("select * from orders")).toBe("Query: orders");
    expect(deriveName("SELECT * FROM public.orders WHERE id = 1")).toBe("Query: orders");
    expect(deriveName('select * from "order items"')).toBe("Query: order items");
    expect(deriveName("select * from `orders`")).toBe("Query: orders");
  });

  it("falls back to the default name when there is no table", () => {
    expect(deriveName("select 1")).toBe("");
    expect(deriveName("")).toBe("");
    // A column called "fromage" must not be mistaken for a FROM clause.
    expect(deriveName("select fromage from t")).toBe("Query: t");
  });
});

describe("rowChoices", () => {
  it("offers only counts the layout can honour", () => {
    const choices = rowChoices(500);
    expect(Math.max(...choices)).toBeLessThanOrEqual(MAX_ROWS);
  });

  it("always includes the exact row count so everything stays reachable", () => {
    expect(rowChoices(37)).toContain(37);
    expect(rowChoices(200)).toContain(200);
    // ...without repeating a choice that is already offered.
    expect(rowChoices(50).filter((choice) => choice === 50)).toHaveLength(1);
  });

  it("still yields a usable list when the result is empty or tiny", () => {
    for (const available of [0, 1, 3]) {
      const choices = rowChoices(available);
      expect(choices.length).toBeGreaterThan(0);
      expect(choices.every((choice) => choice > 0)).toBe(true);
    }
    expect(rowChoices(0)).not.toContain(0);
  });
});

// The title and caption previously used a hardcoded 0.6em per character, which
// bypassed this file's own full-width estimate and left a CJK title 40% too
// narrow — the box is final, so the glyphs overflowed it and exports clipped.
describe("title and caption sizing", () => {
  const widthOf = (built: ReturnType<typeof buildGridScene>, id: string) =>
    (elementsOf(built.scene).find((element) => element.id === id)?.width as number) ?? 0;

  it("sizes a CJK title by its real advance, not by character count", () => {
    const title = "把这份结果贴到画布";
    const built = buildGridScene({ columns: ["c"], rows: [["v"]] }, { title });
    // Nine full-width glyphs at one em each.
    expect(widthOf(built, "title")).toBeGreaterThanOrEqual(title.length * TITLE_FONT_SIZE);
    // The old Latin-only estimate would have produced ~108px for the same text.
    expect(widthOf(built, "title")).toBeGreaterThan(title.length * TITLE_FONT_SIZE * 0.6);
  });

  it("sizes a CJK caption by its real advance too", () => {
    const caption = "where name = '张三'";
    const built = buildGridScene({ columns: ["c"], rows: [["v"]] }, { caption });
    const element = elementsOf(built.scene).find((entry) => entry.id === "caption");
    expect(element).toBeDefined();
    // Four full-width glyphs where the old estimate assumed 0.6em each.
    expect(element!.width as number).toBeGreaterThan(caption.length * CAPTION_FONT_SIZE * 0.62);
  });
});

// Excalidraw draws in array order, so the sequence is part of the contract:
// row bands sit behind the border, the border behind the header, and the header
// behind the cells.
describe("element order", () => {
  it("emits heading, then bands, border, header and cells in that order", () => {
    const { scene } = buildGridScene(grid(3, 2), { title: "T", caption: "select 1" });
    const ids = elementsOf(scene).map((element) => String(element.id));

    expect(ids[0]).toBe("title");
    expect(ids[1]).toBe("caption");
    expect(ids.indexOf("table")).toBeGreaterThan(ids.indexOf("row-1"));
    expect(ids.indexOf("head-0")).toBeGreaterThan(ids.indexOf("table"));
    expect(ids.indexOf("head-text-0")).toBe(ids.indexOf("head-0") + 1);
    expect(ids.indexOf("c-0-0")).toBeGreaterThan(ids.indexOf("head-1"));
    // Every cell of row 0 precedes every cell of row 1.
    const lastOfRow0 = Math.max(...ids.filter((id) => /^c-0-/.test(id)).map((id) => ids.indexOf(id)));
    const firstOfRow1 = Math.min(...ids.filter((id) => /^c-1-/.test(id)).map((id) => ids.indexOf(id)));
    expect(firstOfRow1).toBeGreaterThan(lastOfRow0);
  });

  it("keeps the ids unique, so a redraw cannot collapse two elements", () => {
    const { scene } = buildGridScene(grid(5, 4), { title: "T", caption: "c" });
    const ids = elementsOf(scene).map((element) => String(element.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// The select is controlled, so the value it starts on must be one of the
// options it offers. A result with columns but no rows was the case that broke:
// it defaulted to 0, which is never a choice.
describe("initialRowLimit", () => {
  it("always starts on a value the control actually offers", () => {
    for (let availableRows = 0; availableRows <= 260; availableRows += 1) {
      const initial = initialRowLimit(availableRows);
      expect(rowChoices(availableRows)).toContain(initial);
      expect(initial).toBeGreaterThan(0);
      expect(initial).toBeLessThanOrEqual(MAX_ROWS);
    }
  });

  it("defaults to a modest count and never exceeds what the host sent", () => {
    expect(initialRowLimit(0)).toBe(ROW_CHOICES[0]);
    expect(initialRowLimit(3)).toBe(3);
    expect(initialRowLimit(50)).toBe(25);
    expect(initialRowLimit(500)).toBe(25);
  });
});

// The remembered count is read after the first paint, so it can be absent on the
// render that matters and arrive later. Both cases have to leave the control on
// a value it offers.
describe("resolveRowLimit", () => {
  it("uses the remembered count when this result can offer it", () => {
    expect(resolveRowLimit(500, 100, null)).toBe(100);
  });

  it("still resolves when the preference has not arrived yet", () => {
    // This is the case the boot sequence depends on: the page renders before
    // `prefs/get` lands, and must not be blocked on it.
    expect(resolveRowLimit(500, undefined, null)).toBe(initialRowLimit(500));
    expect(rowChoices(500)).toContain(resolveRowLimit(500, undefined, null));
  });

  it("ignores a remembered count this result cannot offer", () => {
    // A stale preference from a larger result must not leave the select holding
    // a value that is not among its options.
    expect(resolveRowLimit(12, 500, null)).toBe(initialRowLimit(12));
    expect(rowChoices(12)).toContain(resolveRowLimit(12, 500, null));
  });

  it("lets an explicit choice on this result win over the remembered one", () => {
    expect(resolveRowLimit(500, 100, 25)).toBe(25);
  });

  it("always returns one of the offered choices", () => {
    for (const availableRows of [0, 1, 12, 25, 499, 500, 5000]) {
      for (const remembered of [undefined, 1, 25, 100, 500, 99999]) {
        for (const chosen of [null, 1, 50]) {
          const resolved = resolveRowLimit(availableRows, remembered, chosen);
          expect(rowChoices(availableRows), `rows=${availableRows} remembered=${remembered} chosen=${chosen}`).toContain(
            resolved,
          );
        }
      }
    }
  });
});

describe("grid placement", () => {
  it("defaults keep the historical ids and origin", () => {
    const built = buildGridScene(grid(2, 2), { title: "T" });
    const elements = elementsOf(built.scene);
    const title = elements.find((element) => element.id === "title");
    expect(title!.x).toBe(40);
    expect(title!.y).toBe(40);
    expect(elements.some((element) => element.id === "head-0")).toBe(true);
  });

  it("namespaces ids and shifts geometry by the placement", () => {
    const base = buildGridScene(grid(2, 2), { title: "T" });
    const placed = buildGridScene(grid(2, 2), { title: "T", placement: { idPrefix: "g1-", x: 500, y: 300 } });
    const baseElements = elementsOf(base.scene);
    const placedElements = elementsOf(placed.scene);
    expect(placedElements.map((element) => element.id)).toEqual(baseElements.map((element) => `g1-${element.id}`));
    // Placement is an absolute origin: everything shifts by (origin - default margin).
    const deltaX = 500 - 40;
    const deltaY = 300 - 40;
    for (let index = 0; index < baseElements.length; index += 1) {
      expect(placedElements[index].x).toBe((baseElements[index].x as number) + deltaX);
      expect(placedElements[index].y).toBe((baseElements[index].y as number) + deltaY);
    }
  });

  it("reports the absolute bounds of what it built", () => {
    const placed = buildGridScene(grid(3, 2), { title: "T", placement: { idPrefix: "p-", x: 100, y: 60 } });
    const elements = elementsOf(placed.scene);
    const minX = Math.min(...elements.map((element) => element.x as number));
    const minY = Math.min(...elements.map((element) => element.y as number));
    const maxX = Math.max(...elements.map((element) => (element.x as number) + (element.width as number)));
    const maxY = Math.max(...elements.map((element) => (element.y as number) + (element.height as number)));
    expect(placed.bounds).toEqual({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  });
});

describe("sceneBounds", () => {
  it("measures the live elements and skips tombstones", () => {
    const bounds = sceneBounds([
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 100, y: 5, width: 10, height: 10, isDeleted: true },
      { x: -5, y: 50, width: 15, height: 25 },
    ]);
    expect(bounds).toEqual({ x: -5, y: 20, width: 45, height: 55 });
  });

  it("yields no bounds for empty or unreadable input", () => {
    expect(sceneBounds([])).toBeNull();
    expect(sceneBounds([{ isDeleted: true }])).toBeNull();
    expect(sceneBounds([null, "text"])).toBeNull();
  });
});

describe("appendPlacement", () => {
  it("starts at the default margin on an empty canvas", () => {
    expect(appendPlacement(null, "g-")).toEqual({ idPrefix: "g-", x: 40, y: 40 });
  });

  it("sits right of the existing content, top-aligned with it", () => {
    expect(appendPlacement({ x: 40, y: 40, width: 300, height: 200 }, "g-")).toEqual({
      idPrefix: "g-",
      x: 40 + 300 + APPEND_GAP,
      y: 40,
    });
  });
});

describe("makeIdPrefix", () => {
  it("issues distinct prefixes shaped for namespacing", () => {
    const first = makeIdPrefix();
    const second = makeIdPrefix();
    expect(first).toMatch(/^g[0-9a-z]+-[0-9a-z]+-$/);
    expect(second).not.toBe(first);
  });
});

describe("uniqueGridTitle", () => {
  const titleElement = (text: string, fontSize = 20) => ({ type: "text", text, fontSize });

  it("passes an unused title through untouched", () => {
    expect(uniqueGridTitle([titleElement("Other")], "Query: t")).toBe("Query: t");
  });

  it("numbers a title the target already shows", () => {
    expect(uniqueGridTitle([titleElement("Query: t")], "Query: t")).toBe("Query: t (2)");
    expect(uniqueGridTitle([titleElement("Query: t"), titleElement("Query: t (2)")], "Query: t")).toBe("Query: t (3)");
  });

  it("ignores deleted titles and cell-size text", () => {
    const elements = [
      { type: "text", text: "Query: t", fontSize: 20, isDeleted: true },
      { type: "text", text: "Query: t", fontSize: 13 },
      { type: "rectangle", text: "Query: t", fontSize: 20 },
    ];
    expect(uniqueGridTitle(elements, "Query: t")).toBe("Query: t");
  });
});

describe("mergeGridIntoScene", () => {
  const emptyStored = () => ({
    type: "excalidraw",
    version: 2,
    source: "dbx.excalidraw.studio",
    elements: [] as unknown[],
    appState: {},
    files: {},
  });

  it("appends prefixed elements after the existing ones and preserves the envelope", () => {
    const existing = emptyStored();
    existing.elements = [{ id: "drawn", type: "rectangle", x: 0, y: 0, width: 50, height: 50 }];
    existing.appState = { viewBackgroundColor: "#ffffff" };
    const outcome = mergeGridIntoScene(existing, {
      grid: grid(2, 2),
      title: "T",
      caption: "SELECT 1",
      maxRows: 2,
      placement: appendPlacement(sceneBounds(existing.elements), "g1-"),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const scene = outcome.scene as unknown as Record<string, unknown>;
    const elements = scene.elements as Record<string, unknown>[];
    expect(elements[0]).toBe(existing.elements[0]);
    expect(scene.appState).toEqual({ viewBackgroundColor: "#ffffff" });
    // The appended grid clears the existing content with the standard gap.
    expect(elements[1].id).toBe("g1-title");
    expect(elements[1].x).toBe(50 + APPEND_GAP);
    const ids = elements.map((element) => element.id as string);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns the built scene unchanged when the target is null", () => {
    const outcome = mergeGridIntoScene(null, {
      grid: grid(1, 1),
      title: "T",
      placement: { idPrefix: "g-", x: 40, y: 40 },
    });
    const direct = buildGridScene(grid(1, 1), { title: "T", placement: { idPrefix: "g-", x: 40, y: 40 } });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.scene).toEqual(direct.scene);
  });

  it("drops rows until the merged scene fits the backend ceiling", () => {
    const existing = emptyStored();
    existing.elements = [
      { id: "blob", type: "text", x: 0, y: 0, width: 100, height: 20, text: "x".repeat(1_950_000) },
    ];
    const outcome = mergeGridIntoScene(existing, {
      grid: grid(MAX_ROWS, 8),
      title: "T",
      maxRows: MAX_ROWS,
      placement: { idPrefix: "g-", x: 40, y: 40 },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.layout.includedRows).toBeLessThan(MAX_ROWS);
    expect(new TextEncoder().encode(JSON.stringify(outcome.scene)).byteLength).toBeLessThanOrEqual(SCENE_BYTE_LIMIT);
  });

  it("reports a full scene when even an empty grid cannot fit", () => {
    const existing = emptyStored();
    existing.elements = [
      { id: "blob", type: "text", x: 0, y: 0, width: 100, height: 20, text: "x".repeat(SCENE_BYTE_LIMIT + 10_000) },
    ];
    const outcome = mergeGridIntoScene(existing, {
      grid: grid(2, 2),
      title: "T",
      placement: { idPrefix: "g-", x: 40, y: 40 },
    });
    expect(outcome).toEqual({ ok: false, reason: "scene-full" });
  });

  it("shrinks the grid budget again when CJK cells inflate past the ceiling", () => {
    // The builder measures in UTF-16 units while the ceiling counts UTF-8
    // bytes; a CJK-heavy grid must push past the limit on the first attempt
    // so only the budget-retry loop can land the merge under it.
    const existing = emptyStored();
    existing.elements = [
      { id: "blob", type: "text", x: 0, y: 0, width: 100, height: 20, text: "x".repeat(1_900_000) },
    ];
    const cjkGrid: ResultGrid = {
      columns: ["编号", "名称", "状态", "时间", "来源", "备注", "版本", "路径"],
      rows: Array.from({ length: MAX_ROWS }, () => Array.from({ length: 8 }, () => "中".repeat(60))),
    };
    const outcome = mergeGridIntoScene(existing, {
      grid: cjkGrid,
      title: "T",
      maxRows: MAX_ROWS,
      placement: { idPrefix: "g-", x: 40, y: 40 },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.layout.includedRows).toBeLessThan(MAX_ROWS);
    expect(new TextEncoder().encode(JSON.stringify(outcome.scene)).byteLength).toBeLessThanOrEqual(SCENE_BYTE_LIMIT);
  });

  it("keeps unreadable stored elements and skips them when placing", () => {
    const existing = emptyStored();
    existing.elements = [
      "garbage",
      42,
      { id: "kept", type: "rectangle", x: 0, y: 0, width: 50, height: 50 },
    ];
    const outcome = mergeGridIntoScene(existing, {
      grid: grid(1, 1),
      title: "T",
      placement: appendPlacement(sceneBounds(existing.elements), "g1-"),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const elements = (outcome.scene as unknown as Record<string, unknown>).elements as unknown[];
    // Unreadable entries ride along untouched; restore() is the authority on
    // what they mean, and dropping them here would be a silent data change.
    expect(elements.slice(0, 3)).toEqual(existing.elements);
    // Placement measured only the measurable element, so the grid clears it.
    expect((elements[3] as Record<string, unknown>).x).toBe(50 + APPEND_GAP);
  });

  it("numbers the appended title against the titles the target already shows", () => {
    const existing = emptyStored();
    existing.elements = [
      { id: "t", type: "text", x: 0, y: 0, width: 100, height: 25, text: "Query: t", fontSize: 20 },
    ];
    const outcome = mergeGridIntoScene(existing, {
      grid: grid(1, 1),
      title: uniqueGridTitle(existing.elements, "Query: t"),
      placement: appendPlacement(sceneBounds(existing.elements), "g1-"),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const elements = (outcome.scene as unknown as Record<string, unknown>).elements as Record<string, unknown>[];
    expect(elements.some((element) => element.id === "g1-title" && element.text === "Query: t (2)")).toBe(true);
  });
});
