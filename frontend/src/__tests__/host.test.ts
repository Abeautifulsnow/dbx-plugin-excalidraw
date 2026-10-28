import { afterEach, describe, expect, it, vi } from "vitest";
import { readResultSet } from "../host";

// host.ts registers its listeners from `installHostListeners` rather than at
// module scope precisely so this file can be imported under the node test
// environment; importing it used to throw `document is not defined`.
describe("readResultSet", () => {
  it("reads the payload the host attaches to a result-view tab", () => {
    const context = readResultSet({
      connectionId: "conn-1",
      database: "analytics",
      schema: "app",
      sql: "select * from orders",
      result: { columns: ["id", "total"], rows: [[1, "9.99"]], truncated: true },
    });
    expect(context).toEqual({
      connectionId: "conn-1",
      database: "analytics",
      schema: "app",
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
      schema: "",
      sql: "",
      result: { columns: [], rows: [], truncated: false },
    });
    expect(readResultSet({ result: null }).result.rows).toEqual([]);
    expect(readResultSet({ result: { columns: "id", rows: "not-rows" } }).result.columns).toEqual([]);
    expect(readResultSet({ sql: 42 }).sql).toBe("");
    // Older hosts never send a schema; absence degrades to "" like the rest.
    expect(readResultSet({ connectionId: "conn-1" }).schema).toBe("");
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

// primeLaunchFromBridge is stateful (the launch is a module singleton), so each
// case re-imports the module to start from an empty launch — and every call goes
// through that fresh instance, never through a top-level binding, which would be
// a different module instance after vi.resetModules. The bridge itself is
// stubbed on globalThis, mirroring how api.ts reads it.
describe("primeLaunchFromBridge", () => {
  const globalScope = globalThis as { window?: unknown };

  afterEach(() => {
    delete globalScope.window;
  });

  async function freshHost() {
    vi.resetModules();
    return import("../host");
  }

  it("prefers the bridge contributionId over payload-shape inference", async () => {
    const host = await freshHost();
    globalScope.window = {
      dbxPlugin: {
        context: { connectionId: "conn-1", result: { columns: ["id"], rows: [] } },
        contributionId: "io.dbx.excalidraw.result-view",
      },
    };
    expect(host.primeLaunchFromBridge()).toBe(true);
    expect(host.getLaunch()).toMatchObject({
      surface: "result-view",
      contributionId: "io.dbx.excalidraw.result-view",
    });
    // The launch is a singleton: a second prime is a no-op.
    expect(host.primeLaunchFromBridge()).toBe(false);
  });

  it("infers the surface from the payload when the bridge has no contributionId", async () => {
    const host = await freshHost();
    globalScope.window = { dbxPlugin: { context: { connectionId: "conn-1" } } };
    expect(host.primeLaunchFromBridge()).toBe(true);
    expect(host.getLaunch()).toMatchObject({ surface: "workbench", contributionId: null });

    // Re-import so the singleton is empty, then take the result-view branch.
    const fresh = await freshHost();
    globalScope.window = { dbxPlugin: { context: { connectionId: "conn-1", result: { columns: ["id"], rows: [] } } } };
    expect(fresh.primeLaunchFromBridge()).toBe(true);
    expect(fresh.getLaunch()).toMatchObject({ surface: "result-view", contributionId: null });
  });

  it("stays false when the bridge carries no context", async () => {
    const host = await freshHost();
    globalScope.window = { dbxPlugin: {} };
    expect(host.primeLaunchFromBridge()).toBe(false);
    expect(host.getLaunch()).toBeNull();
  });
});
