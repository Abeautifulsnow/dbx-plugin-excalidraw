// Turns the host's plan API payload into an Excalidraw scene: the estimated
// execution plan laid out as a top-down tree of cost-labelled nodes the user
// can then rearrange and annotate — the thing a read-only plan viewer cannot
// offer. Parsing is deliberately narrow: PostgreSQL and MySQL JSON plans and
// indented text plans are recognised, everything else refuses loudly rather
// than drawing a tree that would look plausible and be wrong.
//
// Nothing here imports Excalidraw, so parsing, layout and the generated scene
// are all unit-testable and stay a plain JSON document.

import {
  baseElement,
  estimateTextWidth,
  makeSequence,
  rectElement,
  textElement,
  type ExcalidrawScene,
  type SceneElement,
} from "./resultScene";

export interface PlanNode {
  title: string;
  /** One bounded line of numbers/conditions; empty when nothing survived. */
  metrics: string;
  /** Total cost as reported by the engine, used for the hotspot highlight. */
  cost: number | null;
  children: PlanNode[];
}

export interface ParsedPlan {
  root: PlanNode;
  totalNodes: number;
  includedNodes: number;
  /** True when the node cap cut branches off the plan. */
  truncated: boolean;
}

// A plan past this size would be unreadable on a canvas long before it
// threatened the save budget — a single node is a box, two text lines and one
// arrow, so 150 nodes land around a hundred kilobytes of scene JSON.
export const MAX_PLAN_NODES = 150;
const MAX_TITLE_CHARS = 64;
const MAX_METRICS_CHARS = 80;

interface BuildState {
  total: number;
  included: number;
  truncated: boolean;
}

function newState(): BuildState {
  return { total: 0, included: 0, truncated: false };
}

function finish(root: PlanNode | null, state: BuildState): ParsedPlan | null {
  if (!root || state.included === 0) {
    return null;
  }
  return { root, totalNodes: state.total, includedNodes: state.included, truncated: state.truncated };
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Numbers in plan JSON arrive as both real numbers and strings ("2"). */
function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compact(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

/**
 * Recognises the plan shape and dispatches. `format` is the host's verdict
 * ("json" | "xml" | "text"); XML has no recognisable tree in one string and
 * gets refused rather than mangled into one node.
 */
export function parsePlan(format: string, rawPlan: unknown): ParsedPlan | null {
  if (format === "xml") {
    return null;
  }
  if (typeof rawPlan === "string") {
    return fromText(rawPlan);
  }
  let raw = rawPlan;
  if (Array.isArray(raw)) {
    raw = raw[0];
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const state = newState();
  if (record.Plan !== undefined) {
    const root = pgNode(record.Plan, state);
    return finish(root, state);
  }
  if (record.query_block !== undefined) {
    const children = mysqlChildren(record.query_block, state);
    return finish(singleOrSynthetic(children, "SELECT"), state);
  }
  return null;
}

function singleOrSynthetic(children: PlanNode[], label: string): PlanNode | null {
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { title: label, metrics: "", cost: null, children };
}

// --- PostgreSQL: { Plan: { "Node Type", "Relation Name", "Total Cost", Plans[] } }

const PG_DETAIL_KEYS = ["Filter", "Index Cond", "Join Filter", "Hash Cond", "Merge Cond", "Sort Key", "Group Key"];

function pgNode(value: unknown, state: BuildState): PlanNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  state.total += 1;
  if (state.included >= MAX_PLAN_NODES) {
    state.truncated = true;
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = str(record["Node Type"]) || "Node";
  const index = str(record["Index Name"]);
  const relation = str(record["Relation Name"]);
  let title = type;
  if (index) {
    title += ` using ${index}`;
  }
  if (relation) {
    title += ` on ${relation}`;
  }
  // One condition rides along on the node — the first is the one readers look
  // for (the filter or the index condition); the rest stay in the raw plan.
  let detail = "";
  for (const key of PG_DETAIL_KEYS) {
    if (record[key] !== undefined) {
      const detailValue = record[key];
      detail = `${key}: ${typeof detailValue === "string" ? detailValue : JSON.stringify(detailValue)}`;
      break;
    }
  }
  const cost = num(record["Total Cost"]);
  const rows = num(record["Plan Rows"]);
  const parts: string[] = [];
  if (cost !== null) {
    parts.push(`cost=${compact(cost)}`);
  }
  if (rows !== null) {
    parts.push(`rows=${compact(rows)}`);
  }
  if (detail) {
    parts.push(clip(detail, 44));
  }
  state.included += 1;
  const node: PlanNode = {
    title: clip(title, MAX_TITLE_CHARS),
    metrics: clip(parts.join(" · "), MAX_METRICS_CHARS),
    cost,
    children: [],
  };
  const plans = record["Plans"];
  if (Array.isArray(plans)) {
    for (const child of plans) {
      const converted = pgNode(child, state);
      if (converted) {
        node.children.push(converted);
      }
    }
  }
  return node;
}

// --- MySQL EXPLAIN FORMAT=JSON: query_block → ordering/grouping/window/
// nested_loop containers wrapping `table` leaves. Numbers arrive as strings.

const MYSQL_CONTAINERS: Record<string, string> = {
  query_block: "Query block",
  ordering_operation: "Sort",
  grouping_operation: "Group",
  windowing_operation: "Window",
  nested_loop: "Nested loop",
  materialized_from_subquery: "Materialize",
};

function mysqlCost(record: Record<string, unknown>): number | null {
  const info = record.cost_info;
  if (!info || typeof info !== "object") {
    return null;
  }
  return num((info as Record<string, unknown>).query_cost);
}

function mysqlTable(value: unknown, state: BuildState): PlanNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  state.total += 1;
  if (state.included >= MAX_PLAN_NODES) {
    state.truncated = true;
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = str(record.table_name) || "table";
  const access = str(record.access_type);
  const label =
    access === "ALL" ? "Table scan" : access === "index" ? "Index scan" : access ? `Access ${access}` : "Table";
  const key = str(record.key);
  const title = key ? `${label} on ${name} via ${key}` : `${label} on ${name}`;
  const cost = mysqlCost(record);
  const rows = num(record.rows);
  const extra = str(record.Extra);
  const parts: string[] = [];
  if (cost !== null) {
    parts.push(`cost=${compact(cost)}`);
  }
  if (rows !== null) {
    parts.push(`rows=${compact(rows)}`);
  }
  if (extra) {
    parts.push(clip(extra, 44));
  }
  state.included += 1;
  return {
    title: clip(title, MAX_TITLE_CHARS),
    metrics: clip(parts.join(" · "), MAX_METRICS_CHARS),
    cost,
    children: [],
  };
}

/** Expands one object-or-array entry into its list of sibling nodes. */
function mysqlChildren(value: unknown, state: BuildState): PlanNode[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => mysqlChildren(entry, state));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const nodes: PlanNode[] = [];
  const table = record.table;
  if (table !== undefined) {
    const leaf = mysqlTable(table, state);
    if (leaf) {
      nodes.push(leaf);
    }
  }
  for (const [key, entry] of Object.entries(record)) {
    const label = MYSQL_CONTAINERS[key];
    if (label === undefined) {
      continue;
    }
    const inner = mysqlChildren(entry, state);
    if (inner.length === 0) {
      continue;
    }
    state.total += 1;
    if (state.included >= MAX_PLAN_NODES) {
      state.truncated = true;
      nodes.push(...inner);
      continue;
    }
    state.included += 1;
    const entryRecord =
      entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
    const cost = mysqlCost(entryRecord);
    nodes.push({
      title: label,
      metrics: cost !== null ? `cost=${compact(cost)}` : "",
      cost,
      children: inner,
    });
  }
  return nodes;
}

// --- Text plans (PostgreSQL plain EXPLAIN, MySQL FORMAT=TREE): a line's
// indentation is its depth; `-> ` markers are decoration.

const TEXT_COST = /cost=(\d+(?:\.\d+)?)(?:\.\.(\d+(?:\.\d+)?))?/;
const TEXT_ROWS = /rows=(\d+)/;

function fromText(text: string): ParsedPlan | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return null;
  }
  const state = newState();
  const stack: { depth: number; node: PlanNode }[] = [];
  const roots: PlanNode[] = [];
  for (const line of lines) {
    const trimmed = line.trim().replace(/^->\s*/, "");
    state.total += 1;
    if (state.included >= MAX_PLAN_NODES) {
      state.truncated = true;
      break;
    }
    // Plain EXPLAIN shows cost as start..total; the total is what pg plans call
    // "Total Cost", so the group after `..` wins when both are there. match()
    // on a non-global regex is group-compatible with exec and side-effect free.
    const costMatch = line.match(TEXT_COST);
    // Two bounds mean start..total; the total is the one pg plans carry.
    const cost = costMatch ? Number(costMatch[2] ?? costMatch[1]) : null;
    const rowsMatch = line.match(TEXT_ROWS);
    const parts: string[] = [];
    if (cost !== null) {
      parts.push(`cost=${compact(cost)}`);
    }
    if (rowsMatch) {
      parts.push(`rows=${compact(Number(rowsMatch[1]))}`);
    }
    const node: PlanNode = {
      title: clip(trimmed, MAX_TITLE_CHARS),
      metrics: clip(parts.join(" · "), MAX_METRICS_CHARS),
      cost,
      children: [],
    };
    state.included += 1;
    const depth = Math.floor((line.length - line.trimStart().length) / 2);
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ depth, node });
  }
  if (roots.length === 1) {
    return finish(roots[0], state);
  }
  return finish(singleOrSynthetic(roots, "Plan"), state);
}

// --- Scene: a tidy top-down tree. Every node is a box with a title line and a
// metrics line; the highest-cost node gets the red border so the eye lands on
// the plan's dominant operator first — one deterministic signal, no scoring.

const SCENE_MARGIN = 40;
const TITLE_FONT_SIZE = 20;
const CAPTION_FONT_SIZE = 12;
const NODE_TITLE_FONT = 13;
const NODE_METRIC_FONT = 11;
const LINE_HEIGHT = 1.25;
const NODE_PADDING_X = 10;
const NODE_PADDING_Y = 8;
const GAP_X = 28;
const GAP_Y = 54;

const STROKE = "#1e1e1e";
const MUTED = "#868e96";
const HOT = "#e03131";
const FILL = "#f1f3f5";

export interface PlanSceneOptions {
  title?: string;
  caption?: string;
}

export interface PlanSceneResult {
  scene: ExcalidrawScene;
  totalNodes: number;
  includedNodes: number;
  bytes: number;
  /** True when the highest-cost node was found and outlined. */
  highlighted: boolean;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  node: PlanNode;
  hot: boolean;
}

function boxOf(node: PlanNode): { width: number; height: number } {
  const titleWidth = estimateTextWidth(node.title, NODE_TITLE_FONT);
  const metricsWidth = node.metrics ? estimateTextWidth(node.metrics, NODE_METRIC_FONT) : 0;
  const width = Math.ceil(Math.max(titleWidth, metricsWidth)) + NODE_PADDING_X * 2;
  const textHeight =
    NODE_TITLE_FONT * LINE_HEIGHT + (node.metrics ? NODE_METRIC_FONT * LINE_HEIGHT : 0);
  return { width, height: Math.ceil(textHeight + NODE_PADDING_Y * 2) };
}

function hottest(node: PlanNode): PlanNode | null {
  let best: PlanNode | null = null;
  let bestCost = 0;
  const walk = (current: PlanNode): void => {
    if (current.cost !== null && Number.isFinite(current.cost) && current.cost > bestCost) {
      best = current;
      bestCost = current.cost;
    }
    for (const child of current.children) {
      walk(child);
    }
  };
  walk(node);
  return best;
}

function subtreeWidth(node: PlanNode): number {
  const own = boxOf(node).width;
  if (node.children.length === 0) {
    return own;
  }
  const children =
    node.children.reduce((sum, child) => sum + subtreeWidth(child), 0) + GAP_X * (node.children.length - 1);
  return Math.max(own, children);
}

function place(node: PlanNode, left: number, top: number, hot: PlanNode | null, boxes: Box[]): void {
  const { width, height } = boxOf(node);
  boxes.push({ x: left, y: top, width, height, node, hot: node === hot });
  if (node.children.length === 0) {
    return;
  }
  const block =
    node.children.reduce((sum, child) => sum + subtreeWidth(child), 0) + GAP_X * (node.children.length - 1);
  const childTop = top + height + GAP_Y;
  let cursor = left + width / 2 - block / 2;
  for (const child of node.children) {
    const childWidth = subtreeWidth(child);
    place(child, cursor, childTop, hot, boxes);
    cursor += childWidth + GAP_X;
  }
}

/**
 * Lays the parsed plan out under an optional heading and reports the scene's
 * byte size. The node cap lives in the parser, so the scene stays far below
 * the save budget; the size is still reported so the caller can be honest if a
 * future engine change breaks that assumption.
 */
export function buildPlanScene(plan: ParsedPlan, options: PlanSceneOptions = {}): PlanSceneResult {
  const sequence = makeSequence();
  const hot = hottest(plan.root);

  const elements: SceneElement[] = [];
  let top = SCENE_MARGIN;
  if (options.title) {
    elements.push(
      textElement(
        "title",
        options.title,
        {
          x: SCENE_MARGIN,
          y: top,
          width: estimateTextWidth(options.title, TITLE_FONT_SIZE),
          height: TITLE_FONT_SIZE * LINE_HEIGHT,
          fontSize: TITLE_FONT_SIZE,
          fontFamily: 2,
        },
        sequence,
      ),
    );
  }
  top += TITLE_FONT_SIZE * LINE_HEIGHT + 12;
  if (options.caption) {
    const caption = options.caption.length > 60 ? `${options.caption.slice(0, 59)}…` : options.caption;
    elements.push(
      textElement(
        "caption",
        caption,
        {
          x: SCENE_MARGIN,
          y: top,
          width: estimateTextWidth(caption, CAPTION_FONT_SIZE),
          height: CAPTION_FONT_SIZE * LINE_HEIGHT,
          fontSize: CAPTION_FONT_SIZE,
          strokeColor: MUTED,
        },
        sequence,
      ),
    );
  }
  top += CAPTION_FONT_SIZE * LINE_HEIGHT + 24;

  const boxes: Box[] = [];
  place(plan.root, SCENE_MARGIN, top, hot, boxes);

  for (const box of boxes) {
    elements.push(
      rectElement(
        `plan-box-${elements.length}`,
        {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          backgroundColor: FILL,
          strokeColor: box.hot ? HOT : STROKE,
          strokeWidth: box.hot ? 2 : 1,
        },
        sequence,
      ),
    );
    elements.push(
      textElement(
        `plan-title-${elements.length}`,
        box.node.title,
        {
          x: box.x + NODE_PADDING_X,
          y: box.y + NODE_PADDING_Y,
          width: box.width - NODE_PADDING_X * 2,
          height: NODE_TITLE_FONT * LINE_HEIGHT,
          fontSize: NODE_TITLE_FONT,
          strokeColor: box.hot ? HOT : STROKE,
        },
        sequence,
      ),
    );
    if (box.node.metrics) {
      elements.push(
        textElement(
          `plan-metrics-${elements.length}`,
          box.node.metrics,
          {
            x: box.x + NODE_PADDING_X,
            y: box.y + NODE_PADDING_Y + NODE_TITLE_FONT * LINE_HEIGHT,
            width: box.width - NODE_PADDING_X * 2,
            height: NODE_METRIC_FONT * LINE_HEIGHT,
            fontSize: NODE_METRIC_FONT,
            strokeColor: MUTED,
          },
          sequence,
        ),
      );
    }
  }

  // Arrows after the boxes so nothing hides: Excalidraw renders in element
  // order, and an arrow drawn first would sit under the row of boxes.
  const byNode = new Map<PlanNode, Box>(boxes.map((box) => [box.node, box]));
  for (const box of boxes) {
    for (const child of box.node.children) {
      const childBox = byNode.get(child);
      if (!childBox) {
        continue;
      }
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height;
      const endX = childBox.x + childBox.width / 2;
      const endY = childBox.y;
      elements.push({
        ...baseElement(`plan-arrow-${elements.length}`, sequence(), sequence()),
        type: "arrow",
        x: startX,
        y: startY,
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY),
        strokeColor: STROKE,
        strokeWidth: 1,
        points: [
          [0, 0],
          [endX - startX, endY - startY],
        ],
        startBinding: null,
        endBinding: null,
        lastCommittedPoint: null,
        startArrowhead: null,
        endArrowhead: "arrow",
        elbowed: false,
      });
    }
  }

  const scene: ExcalidrawScene = {
    type: "excalidraw",
    version: 2,
    source: "dbx.excalidraw.studio",
    elements,
    appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
    files: {},
  };
  return {
    scene,
    totalNodes: plan.totalNodes,
    includedNodes: plan.includedNodes,
    bytes: JSON.stringify(scene).length,
    highlighted: hot !== null,
  };
}
