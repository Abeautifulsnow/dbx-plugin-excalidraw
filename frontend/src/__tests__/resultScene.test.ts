import { describe, expect, it } from "vitest";
import { buildGridScene, cellText, deriveName, initialRowLimit, MAX_ROWS, ROW_CHOICES, rowChoices, type ResultGrid } from "../resultScene";

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
