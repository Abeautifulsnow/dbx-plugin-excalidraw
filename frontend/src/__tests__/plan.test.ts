import { describe, expect, it } from "vitest";
import {
  buildPlanAiContext,
  buildPlanScene,
  MAX_PLAN_NODES,
  parsePlan,
  type PlanNode,
} from "../plan";

function nodes(node: PlanNode): number {
  return 1 + node.children.reduce((sum, child) => sum + nodes(child), 0);
}

function elementList(scene: ReturnType<typeof buildPlanScene>["scene"]) {
  return scene.elements as Array<Record<string, unknown>>;
}

describe("parsePlan — PostgreSQL JSON", () => {
  const pg = {
    Plan: {
      "Node Type": "Sort",
      "Sort Key": ["id"],
      "Total Cost": 12.5,
      "Plan Rows": 100,
      Plans: [
        {
          "Node Type": "Seq Scan",
          "Relation Name": "hub_publisher",
          Filter: "(id > 10)",
          "Total Cost": 5.5,
          "Plan Rows": 88,
        },
      ],
    },
  };

  it("builds the tree with relation, metrics and conditions", () => {
    const parsed = parsePlan("json", pg);
    expect(parsed).not.toBeNull();
    expect(parsed!.includedNodes).toBe(2);
    expect(parsed!.root.title).toBe("Sort");
    expect(parsed!.root.metrics).toContain("cost=12.5");
    expect(parsed!.root.metrics).toContain("rows=100");
    expect(parsed!.root.children[0].title).toBe("Seq Scan on hub_publisher");
    expect(parsed!.root.children[0].metrics).toContain("Filter: (id > 10)");
  });

  it("unwraps a single-element statement array", () => {
    const parsed = parsePlan("json", [pg]);
    expect(parsed).not.toBeNull();
    expect(parsed!.root.title).toBe("Sort");
  });

  it("keeps the index name when the scan uses one", () => {
    const parsed = parsePlan("json", {
      Plan: { "Node Type": "Index Scan", "Index Name": "pub_pkey", "Relation Name": "hub_publisher" },
    });
    expect(parsed!.root.title).toBe("Index Scan using pub_pkey on hub_publisher");
  });
});

describe("parsePlan — MySQL JSON", () => {
  const mysql = {
    query_block: {
      select_id: 1,
      cost_info: { query_cost: "1.20" },
      nested_loop: [
        {
          table: {
            table_name: "t1",
            access_type: "ALL",
            rows: "2",
            cost_info: { query_cost: "0.70" },
          },
        },
        {
          table: {
            table_name: "t2",
            access_type: "ref",
            key: "idx_a",
            rows: "1",
            cost_info: { query_cost: "0.50" },
          },
        },
      ],
    },
  };

  it("turns the join into a nested-loop node with two scan leaves", () => {
    const parsed = parsePlan("json", mysql);
    expect(parsed).not.toBeNull();
    expect(parsed!.includedNodes).toBe(3);
    expect(parsed!.root.title).toBe("Nested loop");
    expect(parsed!.root.children[0].title).toBe("Table scan on t1");
    expect(parsed!.root.children[1].title).toBe("Access ref on t2 via idx_a");
    // MySQL reports rows and costs as strings; both must land on the node.
    expect(parsed!.root.children[0].metrics).toContain("rows=2");
    expect(parsed!.root.children[1].metrics).toContain("cost=0.5");
  });

  it("labels ordering and grouping containers as Sort and Group", () => {
    const parsed = parsePlan("json", {
      query_block: {
        ordering_operation: {
          using_filesort: true,
          table: { table_name: "t", access_type: "index", rows: "7" },
        },
      },
    });
    expect(parsed!.root.title).toBe("Sort");
    expect(parsed!.root.children[0].title).toBe("Index scan on t");
  });
});

describe("parsePlan — text plans", () => {
  it("parses indentation into a tree and strips arrow markers", () => {
    const text = [
      "Sort  (cost=10.20..12.30 rows=100)",
      "  -> Seq Scan on t  (cost=0.00..10.20 rows=100)",
    ].join("\n");
    const parsed = parsePlan("text", text);
    expect(parsed).not.toBeNull();
    expect(parsed!.root.title).toBe("Sort  (cost=10.20..12.30 rows=100)");
    // Plain EXPLAIN lists cost as start..total; the total bound is kept.
    expect(parsed!.root.metrics).toContain("cost=12.3");
    expect(parsed!.root.children[0].title).toBe("Seq Scan on t  (cost=0.00..10.20 rows=100)");
  });

  it("wraps several roots under a synthetic node", () => {
    const parsed = parsePlan("text", "A\n  A1\nB\n  B1");
    expect(parsed).not.toBeNull();
    expect(parsed!.root.title).toBe("Plan");
    expect(parsed!.root.children.map((child) => child.title)).toEqual(["A", "B"]);
  });
});

describe("parsePlan — refusals", () => {
  it("refuses XML instead of mangling it into one node", () => {
    expect(parsePlan("xml", "<plan/>")).toBeNull();
  });

  it("refuses JSON objects it does not recognise", () => {
    expect(parsePlan("json", { something: "else" })).toBeNull();
    expect(parsePlan("json", null)).toBeNull();
    expect(parsePlan("json", 42)).toBeNull();
  });
});

describe("parsePlan — node cap", () => {
  it("stops at the cap and reports what was left off", () => {
    // A wide PG plan: 1 root + 400 children.
    const plan = {
      Plan: {
        "Node Type": "Result",
        Plans: Array.from({ length: 400 }, (_, index) => ({ "Node Type": `Seq Scan ${index}` })),
      },
    };
    const parsed = parsePlan("json", plan)!;
    expect(parsed).not.toBeNull();
    expect(parsed.truncated).toBe(true);
    expect(parsed.includedNodes).toBe(MAX_PLAN_NODES);
    expect(parsed.totalNodes).toBe(401);
    expect(nodes(parsed.root)).toBe(MAX_PLAN_NODES);
  });
});

describe("buildPlanScene", () => {
  const parsed = parsePlan("json", {
    Plan: {
      "Node Type": "Sort",
      "Total Cost": 99,
      Plans: [
        { "Node Type": "Hash Join", "Hash Cond": "(a = b)", "Total Cost": 50 },
        { "Node Type": "Seq Scan", "Relation Name": "small", "Total Cost": 10 },
      ],
    },
  })!;

  it("emits box + text per node and one arrow per edge", () => {
    const result = buildPlanScene(parsed, { title: "Execution plan", caption: "SELECT 1" });
    const elements = elementList(result.scene);
    const arrows = elements.filter((element) => element.type === "arrow");
    const rects = elements.filter((element) => element.type === "rectangle");
    // 3 nodes: 3 boxes + title/caption + metrics for nodes that have them.
    expect(rects.length).toBe(3);
    expect(arrows.length).toBe(2);
    expect(result.includedNodes).toBe(3);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.scene.type).toBe("excalidraw");
  });

  it("outlines exactly the highest-cost node", () => {
    const result = buildPlanScene(parsed, {});
    const rects = elementList(result.scene).filter(
      (element) => element.type === "rectangle",
    );
    const hot = rects.filter((rect) => rect.strokeColor === "#e03131");
    expect(result.highlighted).toBe(true);
    expect(hot.length).toBe(1);
    // The root (cost=99) is the dominant operator, not the seq scan (cost=10).
    const hotText = elementList(result.scene).find(
      (element) => element.type === "text" && element.strokeColor === "#e03131",
    );
    expect(String(hotText!.text)).toContain("Sort");
  });

  it("is deterministic: the same plan yields the same scene", () => {
    const first = buildPlanScene(parsed, { title: "x" });
    const second = buildPlanScene(parsed, { title: "x" });
    expect(JSON.stringify(first.scene)).toBe(JSON.stringify(second.scene));
  });

  it("places children below their parents", () => {
    const result = buildPlanScene(parsed, {});
    const boxes = elementList(result.scene).filter((element) => element.type === "rectangle");
    const byText = (title: string) => {
      const text = elementList(result.scene).find(
        (element) => element.type === "text" && String(element.text) === title,
      )!;
      return boxes.find(
        (box) =>
          (box.x as number) <= (text.x as number) &&
          (text.x as number) <= (box.x as number) + (box.width as number),
      )!;
    };
    const root = byText("Sort");
    const child = byText("Seq Scan on small");
    expect((child.y as number)).toBeGreaterThan((root.y as number) + (root.height as number));
  });
});

describe("buildPlanScene — warnings sticky note", () => {
  const pg = {
    Plan: {
      "Node Type": "Sort",
      "Total Cost": 99,
      "Plan Rows": 10,
      Plans: [{ "Node Type": "Seq Scan", "Relation Name": "small", "Total Cost": 10, "Plan Rows": 1 }],
    },
  };
  const parsed = parsePlan("json", pg)!;

  it("keeps the scene byte-identical when there is nothing to warn about", () => {
    const base = buildPlanScene(parsed, { title: "x" });
    const empty = buildPlanScene(parsed, { title: "x", warnings: { heading: "Plan warnings", items: [] } });
    expect(JSON.stringify(empty.scene)).toBe(JSON.stringify(base.scene));
  });

  it("draws a yellow note to the right of everything else", () => {
    const result = buildPlanScene(parsed, {
      title: "x",
      warnings: { heading: "Plan warnings", items: ["w1", "w2"], moreTemplate: "+{n} more" },
    });
    const elements = elementList(result.scene);
    const noteRect = elements.find(
      (element) => element.type === "rectangle" && element.backgroundColor === "#ffec99",
    );
    expect(noteRect).toBeDefined();
    expect(noteRect!.strokeColor).toBe("#f08c00");
    const otherMaxX = Math.max(
      ...elements
        .filter((element) => element !== noteRect && (element.x as number) < (noteRect!.x as number))
        .map((element) => (element.x as number) + (element.width as number)),
    );
    expect(noteRect!.x).toBeGreaterThan(otherMaxX);
    const heading = elements.find((element) => element.type === "text" && element.text === "Plan warnings");
    expect(heading!.strokeColor).toBe("#f08c00");
    const body = elements.find((element) => element.type === "text" && element.text === "w1\nw2");
    expect(body).toBeDefined();
  });

  it("folds the sixth and later warnings into a +n more line", () => {
    const result = buildPlanScene(parsed, {
      title: "x",
      warnings: { heading: "W", items: ["a", "b", "c", "d", "e", "f", "g"], moreTemplate: "+{n} more" },
    });
    const body = elementList(result.scene).find(
      (element) => element.type === "text" && String(element.text).startsWith("a\n"),
    )!;
    const text = String(body.text);
    expect(text.split("\n")).toHaveLength(6);
    expect(text).toContain("+2 more");
    expect(text).not.toContain("f\n");
  });
});

describe("buildPlanAiContext", () => {
  const pg = {
    Plan: {
      "Node Type": "Sort",
      "Total Cost": 99,
      "Plan Rows": 10,
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "small", Filter: "(id > 10)", "Total Cost": 10, "Plan Rows": 1 },
      ],
    },
  };

  it("renders the tree and marks the hottest node", () => {
    const context = buildPlanAiContext(parsePlan("json", pg)!, { dbType: "postgresql", sql: "SELECT 1", warnings: [] });
    const tree = String(context.planTree).split("\n");
    expect(tree[0]).toContain("- Sort");
    expect(tree[0]).toContain("cost=99");
    expect(tree[0]).toContain("<-- highest cost");
    expect(tree[1]).toContain("Seq Scan on small");
    expect(context.dbType).toBe("postgresql");
    expect(context.truncated).toBe(false);
    expect(context.warnings).toEqual([]);
  });

  it("carries the inputs through and stays far below the bridge budget", () => {
    const plan = parsePlan("json", pg)!;
    const context = buildPlanAiContext(plan, { dbType: "postgresql", sql: "x".repeat(5000), warnings: ["w"] });
    expect(context.warnings).toEqual(["w"]);
    expect(JSON.stringify(context).length).toBeLessThan(64 * 1024);
  });
});
