import { describe, expect, it } from "vitest";
import { readResultSet } from "../host";

// host.ts registers its listeners from `installHostListeners` rather than at
// module scope precisely so this file can be imported under the node test
// environment; importing it used to throw `document is not defined`.
describe("readResultSet", () => {
  it("reads the payload the host attaches to a result-view tab", () => {
    const context = readResultSet({
      connectionId: "conn-1",
      database: "analytics",
      sql: "select * from orders",
      result: { columns: ["id", "total"], rows: [[1, "9.99"]], truncated: true },
    });
    expect(context).toEqual({
      connectionId: "conn-1",
      database: "analytics",
      sql: "select * from orders",
      result: { columns: ["id", "total"], rows: [[1, "9.99"]], truncated: true },
    });
  });

  it("degrades to empty values when the payload is missing or reshaped", () => {
    // The shape is host-owned, not a contract this plugin controls, so a
    // missing field must not throw inside render.
    expect(readResultSet({})).toEqual({
      connectionId: "",
      database: "",
      sql: "",
      result: { columns: [], rows: [], truncated: false },
    });
    expect(readResultSet({ result: null }).result.rows).toEqual([]);
    expect(readResultSet({ result: { columns: "id", rows: "not-rows" } }).result.columns).toEqual([]);
    expect(readResultSet({ sql: 42 }).sql).toBe("");
    // `truncated` is only true when the host said so explicitly.
    expect(readResultSet({ result: { truncated: "yes" } }).result.truncated).toBe(false);
  });

  it("wraps a row that arrived as a bare value rather than an array", () => {
    const context = readResultSet({ result: { columns: ["a"], rows: ["lonely"] } });
    expect(context.result.rows).toEqual([["lonely"]]);
  });

  it("stringifies columns so a non-string column name cannot break rendering", () => {
    const context = readResultSet({ result: { columns: [1, null, "id"] } });
    expect(context.result.columns).toEqual(["1", "null", "id"]);
  });
});
