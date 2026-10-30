import { describe, expect, it } from "vitest";
import { buildResultAiSnapshot } from "../resultAi";

const base = {
  connectionId: "conn-1",
  database: "db",
  sql: "SELECT * FROM t",
};

function grid(rows: number, columns: number) {
  return {
    columns: Array.from({ length: columns }, (_, index) => `col_${index}`),
    rows: Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => `r${row}c${column}`)),
    truncated: false,
  };
}

function contextOf(snapshot: ReturnType<typeof buildResultAiSnapshot>) {
  return snapshot.context as {
    type: string;
    sql: string;
    result: { columns: string[]; rows: string[][]; truncated: boolean };
  };
}

describe("buildResultAiSnapshot", () => {
  it("carries sql, columns and every row when the payload fits", () => {
    const snapshot = buildResultAiSnapshot({ ...base, result: grid(3, 2) });
    const context = contextOf(snapshot);
    expect(context.type).toBe("dbx-result-set");
    expect(context.sql).toBe("SELECT * FROM t");
    expect(context.result.columns).toEqual(["col_0", "col_1"]);
    expect(context.result.rows).toHaveLength(3);
    expect(snapshot.rowCount).toBe(3);
    expect(snapshot.truncated).toBe(false);
  });

  it("flattens cells through the same text path the canvas uses", () => {
    const snapshot = buildResultAiSnapshot({
      ...base,
      result: { columns: ["c"], rows: [[{ value: "inner" }], [null]], truncated: false },
    });
    expect(contextOf(snapshot).result.rows).toEqual([["inner"], [""]]);
  });

  it("samples rows down to the byte budget and says so", () => {
    const data = { ...base, result: grid(200, 8) };
    const full = buildResultAiSnapshot(data);
    expect(full.truncated).toBe(false);

    const budget = new TextEncoder().encode(JSON.stringify(full.context)).byteLength;
    const squeezed = buildResultAiSnapshot(data, Math.floor(budget / 2));
    expect(squeezed.rowCount).toBeLessThan(200);
    expect(squeezed.truncated).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(squeezed.context)).byteLength,
    ).toBeLessThanOrEqual(Math.floor(budget / 2));
  });

  it("keeps at least one row even under an absurd budget", () => {
    const squeezed = buildResultAiSnapshot({ ...base, result: grid(10, 4) }, 128);
    expect(squeezed.rowCount).toBe(1);
    expect(squeezed.truncated).toBe(true);
  });

  it("reports an empty result set without claiming truncation", () => {
    const snapshot = buildResultAiSnapshot({ ...base, result: { columns: ["c"], rows: [], truncated: false } });
    expect(snapshot.rowCount).toBe(0);
    expect(snapshot.truncated).toBe(false);
    expect(contextOf(snapshot).result.rows).toEqual([]);
  });
});
