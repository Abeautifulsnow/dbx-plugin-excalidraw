// Turns a query result into an Excalidraw scene: a titled, readable table that
// the user then annotates. This is deliberately not a data-grid replacement —
// the point is to get the numbers onto a canvas where they can be circled,
// grouped, and connected to the surrounding diagram.
//
// Nothing here imports Excalidraw, so the layout is unit-testable and the
// generated scene stays a plain JSON document.

export interface ResultGrid {
  columns: string[];
  rows: string[][];
}

export interface GridSceneOptions {
  title?: string;
  caption?: string;
  maxRows?: number;
  maxColumns?: number;
  /** Serialized-size ceiling; rows are dropped until the scene fits. */
  maxBytes?: number;
  /**
   * Where the grid lands and which id namespace it uses. Default: the
   * historical origin and bare ids, so standalone canvases look exactly as
   * they always have. Appends must bring a fresh prefix — Excalidraw keys
   * elements by id, and the builder's ids are fixed literals, so a second
   * grid in one scene without a prefix would silently shadow the first.
   */
  placement?: GridPlacement;
}

/** Where an appended grid lands: origin in scene coordinates plus an id namespace. */
export interface GridPlacement {
  idPrefix: string;
  x: number;
  y: number;
}

/** Axis-aligned box over a set of elements, in scene coordinates. */
export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridSceneResult {
  scene: ExcalidrawScene;
  /** Absolute bounds of the built elements; what an append measures against. */
  bounds: SceneBounds;
  includedRows: number;
  includedColumns: number;
  totalRows: number;
  totalColumns: number;
  droppedRows: boolean;
  droppedColumns: boolean;
  bytes: number;
}

export interface ExcalidrawScene {
  type: "excalidraw";
  version: number;
  source: string;
  elements: SceneElement[];
  appState: Record<string, unknown>;
  files: Record<string, never>;
}

export type SceneElement = Record<string, unknown>;

// Cell text is single-line and bounded: a runaway value would otherwise set the
// column width and blow the scene past the save budget on its own.
const MAX_CELL_CHARS = 60;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 320;
const CELL_PADDING_X = 10;
const ROW_HEIGHT = 26;
const FONT_SIZE = 13;
const HEADER_FONT_SIZE = 13;
const TITLE_FONT_SIZE = 20;
const CAPTION_FONT_SIZE = 12;
const LINE_HEIGHT = 1.25;
// Approximate advance width per Latin character, in em, for the monospace
// family used in cells.
const LATIN_CHAR_RATIO = 0.62;

const HEADER_FILL = "#f1f3f5";
const BORDER_STROKE = "#adb5bd";
const TEXT_STROKE = "#1e1e1e";
const CAPTION_STROKE = "#868e96";

const SCENE_MARGIN = 40;
// Exposed so the UI can offer only row counts the layout can actually honour.
export const MAX_ROWS = 200;
const MAX_COLUMNS = 24;
const DEFAULT_MAX_BYTES = 1_500_000;

/** Gap between existing canvas content and an appended grid. */
export const APPEND_GAP = 80;
/**
 * The backend's saveScene ceiling (documents.go maxSceneBytes). The builder's
 * own budget is deliberately smaller; appends shrink theirs by what the
 * target scene already weighs, which is why the limit lives here too.
 */
export const SCENE_BYTE_LIMIT = 2_000_000;

/** Row counts the UI offers, before the available row count is folded in. */
export const ROW_CHOICES = [10, 25, 50, 100, MAX_ROWS];

/**
 * The row counts to offer for a result with `availableRows` rows. Never more
 * than MAX_ROWS, because offering a count the layout will refuse to lay out is
 * how the canvas silently ended up smaller than the UI claimed.
 */
export function rowChoices(availableRows: number): number[] {
  const ceiling = Math.min(availableRows, MAX_ROWS);
  const choices = ROW_CHOICES.filter((choice) => choice <= ceiling);
  if (availableRows > 0 && !choices.includes(ceiling)) {
    choices.push(ceiling);
  }
  if (choices.length === 0) {
    choices.push(Math.min(ROW_CHOICES[0], MAX_ROWS));
  }
  return choices;
}

/**
 * The row count the control starts on. Always one of `rowChoices(available)`,
 * so the select is never rendered with a value it does not offer — a result
 * with columns but no rows has no small count to default to, and 0 is not a
 * choice.
 */
export function initialRowLimit(availableRows: number): number {
  const choices = rowChoices(availableRows);
  const preferred = Math.min(25, availableRows);
  return choices.includes(preferred) ? preferred : choices[0];
}

/**
 * The row count the control should show: an explicit choice on this result
 * wins, then the remembered preference, then the computed default — every
 * candidate filtered through the choices this result actually offers.
 *
 * Derived rather than seeded into state, because the remembered value is read
 * after the first paint — a boot-time read must never gate rendering, so it can
 * arrive later and has to be picked up on a subsequent render.
 *
 * The filter matters for both candidates, not just the remembered one: the host
 * can push a different result into an already-mounted page, which makes an
 * earlier choice (and a remembered count) stale in the same way. Returning a
 * value the select does not list would leave it displaying one count while the
 * layout is built with another.
 */
export function resolveRowLimit(
  availableRows: number,
  remembered: number | undefined,
  chosen: number | null,
): number {
  const choices = rowChoices(availableRows);
  if (chosen !== null && choices.includes(chosen)) {
    return chosen;
  }
  if (remembered !== undefined && choices.includes(remembered)) {
    return remembered;
  }
  return initialRowLimit(availableRows);
}

/**
 * Names a canvas after the table the query reads from, when the SQL makes that
 * obvious. An empty result means "no better name than the default".
 */
export function deriveName(sql: string): string {
  // Quoted and bracketed identifiers are matched whole, so a table name
  // containing spaces survives instead of being cut at the first one.
  const match = /\bfrom\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([\w.$-]+))/i.exec(sql);
  if (!match) {
    return "";
  }
  const identifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
  const table = identifier.split(".").filter(Boolean).pop();
  return table ? `Query: ${table}` : "";
}

/** Deterministic seed/nonce source: the same result always yields the same scene. */
export function makeSequence(): () => number {
  let state = 0x9e3779b9;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };
}

// East Asian wide/fullwidth code points. Excalidraw's Cascadia face has no CJK
// glyphs and its fallback chain has no CJK font either, so these render from a
// system font at roughly one em — about 60% wider than the Latin estimate.
// Getting this wrong is not cosmetic: the scene is loaded via restore(), which
// does not re-measure text, and the export bounds come from the stored width,
// so an under-estimate both overlaps the next column and clips in exports.
function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

export function estimateTextWidth(text: string, fontSize: number): number {
  let latin = 0;
  let wide = 0;
  for (const char of text) {
    if (isWideCodePoint(char.codePointAt(0) ?? 0)) {
      wide += 1;
    } else {
      latin += 1;
    }
  }
  return (latin * LATIN_CHAR_RATIO + wide) * fontSize;
}

/** Trims text to a character cap and then to a pixel cap, marking either cut. */
function fitCellText(text: string, maxWidth: number, fontSize: number): string {
  let fitted = text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS - 1)}…` : text;
  if (estimateTextWidth(fitted, fontSize) <= maxWidth) {
    return fitted;
  }
  const characters = [...fitted];
  while (characters.length > 1) {
    characters.pop();
    fitted = `${characters.join("")}…`;
    if (estimateTextWidth(fitted, fontSize) <= maxWidth) {
      return fitted;
    }
  }
  return "…";
}

const WIDEST_CELL_WIDTH = MAX_COLUMN_WIDTH - CELL_PADDING_X * 2;

export function cellText(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) {
    text = "";
  } else if (typeof value === "string") {
    text = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else if (typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    // DBX wraps some cells (large values, geometry) in an envelope.
    const inner = (value as Record<string, unknown>).value;
    return inner === null || inner === undefined ? "" : cellText(inner);
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  // A text element with embedded newlines would need per-row height maths;
  // flattening keeps every row exactly ROW_HEIGHT tall.
  text = text.replace(/\s*\r?\n\s*/g, " ⏎ ").replace(/\t/g, " ");
  return fitCellText(text, WIDEST_CELL_WIDTH, FONT_SIZE);
}

export function baseElement(id: string, seed: number, nonce: number): SceneElement {
  return {
    id,
    x: 0,
    y: 0,
    strokeColor: TEXT_STROKE,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roundness: null,
    roughness: 0,
    opacity: 100,
    width: 0,
    height: 0,
    angle: 0,
    seed,
    version: 1,
    versionNonce: nonce,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
}

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextOptions extends Geometry {
  fontSize?: number;
  strokeColor?: string;
  fontFamily?: number;
  textAlign?: "left" | "center" | "right";
}

interface RectOptions extends Geometry {
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fillStyle?: string;
}

export function textElement(id: string, text: string, options: TextOptions, sequence: () => number): SceneElement {
  const fontSize = options.fontSize ?? FONT_SIZE;
  return {
    ...baseElement(id, sequence(), sequence()),
    type: "text",
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    strokeColor: options.strokeColor ?? TEXT_STROKE,
    text,
    originalText: text,
    fontSize,
    fontFamily: options.fontFamily ?? 3,
    textAlign: options.textAlign ?? "left",
    verticalAlign: "middle",
    containerId: null,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
  };
}

export function rectElement(id: string, options: RectOptions, sequence: () => number): SceneElement {
  return {
    ...baseElement(id, sequence(), sequence()),
    type: "rectangle",
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    backgroundColor: options.backgroundColor ?? "transparent",
    strokeColor: options.strokeColor ?? BORDER_STROKE,
    strokeWidth: options.strokeWidth ?? 1,
    fillStyle: options.fillStyle ?? "solid",
  };
}

// A single line of text at the given size, sized by the same width estimate the
// columns use. Restore() does not re-measure text, so this box is final: an
// under-estimate overlaps the next element and clips in exports.
function singleLineElement(
  id: string,
  text: string,
  options: { x: number; y: number; fontSize: number } & Omit<TextOptions, "x" | "y" | "width" | "height" | "fontSize">,
  sequence: () => number,
): SceneElement {
  return textElement(
    id,
    text,
    {
      ...options,
      width: estimateTextWidth(text, options.fontSize),
      height: options.fontSize * LINE_HEIGHT,
    },
    sequence,
  );
}

function columnWidths(columns: string[], rows: string[][]): number[] {
  return columns.map((column, index) => {
    let longest = estimateTextWidth(cellText(column), HEADER_FONT_SIZE);
    for (const row of rows) {
      const width = estimateTextWidth(row[index] ?? "", FONT_SIZE);
      if (width > longest) {
        longest = width;
      }
    }
    return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest + CELL_PADDING_X * 2)));
  });
}

/** Emits the title and caption; returns the y coordinate the table starts at. */
function pushHeading(
  elements: SceneElement[],
  options: GridSceneOptions,
  placement: GridPlacement,
  sequence: () => number,
): number {
  let cursorY = placement.y;
  if (options.title) {
    elements.push(
      singleLineElement(
        `${placement.idPrefix}title`,
        options.title,
        { x: placement.x, y: cursorY, fontSize: TITLE_FONT_SIZE, fontFamily: 2 },
        sequence,
      ),
    );
  }
  cursorY += TITLE_FONT_SIZE * LINE_HEIGHT + 12;
  if (options.caption) {
    const caption =
      options.caption.length > MAX_CELL_CHARS ? `${options.caption.slice(0, MAX_CELL_CHARS - 1)}…` : options.caption;
    elements.push(
      singleLineElement(
        `${placement.idPrefix}caption`,
        caption,
        { x: placement.x, y: cursorY, fontSize: CAPTION_FONT_SIZE, strokeColor: CAPTION_STROKE },
        sequence,
      ),
    );
    cursorY += CAPTION_FONT_SIZE * LINE_HEIGHT + 16;
  }
  return cursorY;
}

interface TableLayout {
  columns: string[];
  rows: string[][];
  widths: number[];
  tableWidth: number;
  tableTop: number;
  placement: GridPlacement;
}

/** Emits the row bands, border, header and cells, in back-to-front order. */
function pushTable(elements: SceneElement[], layout: TableLayout, sequence: () => number): void {
  const { columns, rows, widths, tableWidth, tableTop, placement } = layout;
  const { idPrefix, x: originX } = placement;
  const tableHeight = ROW_HEIGHT * (rows.length + 1);

  // Alternating row bands first, so they sit behind the text and the header.
  rows.forEach((_, rowIndex) => {
    if (rowIndex % 2 === 1) {
      elements.push(
        rectElement(
          `${idPrefix}row-${rowIndex}`,
          {
            x: originX,
            y: tableTop + ROW_HEIGHT * (rowIndex + 1),
            width: tableWidth,
            height: ROW_HEIGHT,
            backgroundColor: "#f8f9fa",
            strokeColor: "transparent",
          },
          sequence,
        ),
      );
    }
  });
  elements.push(rectElement(`${idPrefix}table`, { x: originX, y: tableTop, width: tableWidth, height: tableHeight }, sequence));

  let cursorX = originX;
  columns.forEach((column, index) => {
    const width = widths[index];
    elements.push(
      rectElement(
        `${idPrefix}head-${index}`,
        { x: cursorX, y: tableTop, width, height: ROW_HEIGHT, backgroundColor: HEADER_FILL },
        sequence,
      ),
    );
    elements.push(
      textElement(
        `${idPrefix}head-text-${index}`,
        cellText(column),
        { x: cursorX + CELL_PADDING_X, y: tableTop, width: width - CELL_PADDING_X * 2, height: ROW_HEIGHT, fontSize: HEADER_FONT_SIZE },
        sequence,
      ),
    );
    cursorX += width;
  });

  rows.forEach((row, rowIndex) => {
    let cellX = originX;
    row.forEach((value, columnIndex) => {
      const width = widths[columnIndex];
      elements.push(
        textElement(
          `${idPrefix}c-${rowIndex}-${columnIndex}`,
          value,
          {
            x: cellX + CELL_PADDING_X,
            y: tableTop + ROW_HEIGHT * (rowIndex + 1),
            width: width - CELL_PADDING_X * 2,
            height: ROW_HEIGHT,
          },
          sequence,
        ),
      );
      cellX += width;
    });
  });
}

function buildOnce(grid: ResultGrid, options: GridSceneOptions, rowCount: number): ExcalidrawScene {
  const sequence = makeSequence();
  const placement = options.placement ?? { idPrefix: "", x: SCENE_MARGIN, y: SCENE_MARGIN };
  const columns = grid.columns;
  const rows = grid.rows.slice(0, rowCount).map((row) => columns.map((_, index) => cellText(row[index])));
  const widths = columnWidths(columns, rows);
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);

  const elements: SceneElement[] = [];
  const tableTop = pushHeading(elements, options, placement, sequence);
  pushTable(elements, { columns, rows, widths, tableWidth, tableTop, placement }, sequence);

  return {
    type: "excalidraw",
    version: 2,
    source: "dbx.excalidraw.studio",
    elements,
    appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
    files: {},
  };
}

/**
 * Builds a scene that fits `maxBytes`, trading rows away (never columns) to get
 * there, and reports exactly what was left out. Callers are expected to surface
 * the counts — silently shipping a partial table while the UI claims otherwise
 * is the failure mode this return shape exists to prevent.
 */
export function buildGridScene(grid: ResultGrid, options: GridSceneOptions = {}): GridSceneResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const columnLimit = Math.max(1, Math.min(options.maxColumns ?? MAX_COLUMNS, MAX_COLUMNS));
  const rowLimit = Math.max(0, Math.min(options.maxRows ?? MAX_ROWS, MAX_ROWS));

  const totalColumns = grid.columns.length;
  const totalRows = grid.rows.length;
  const columns = grid.columns.slice(0, columnLimit);
  const droppedColumns = totalColumns > columnLimit;
  const requestedRows = Math.min(totalRows, rowLimit);
  const narrowed: ResultGrid = { columns, rows: grid.rows };

  const measure = (count: number) => {
    const scene = buildOnce(narrowed, options, count);
    return { scene, bytes: JSON.stringify(scene).length };
  };

  // Binary search for the largest row count that fits, rather than halving.
  // Halving overshot badly — a request for 200 rows that needed 190 would land
  // on 100 — and every dropped row is information the user asked to see.
  let best = measure(0);
  let bestRows = 0;
  let low = 1;
  let high = requestedRows;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = measure(middle);
    if (candidate.bytes <= maxBytes) {
      best = candidate;
      bestRows = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return {
    scene: best.scene,
    bounds: sceneBounds(best.scene.elements) ?? { x: 0, y: 0, width: 0, height: 0 },
    includedRows: bestRows,
    includedColumns: columns.length,
    totalRows,
    totalColumns,
    droppedRows: bestRows < totalRows,
    droppedColumns,
    bytes: best.bytes,
  };
}

/**
 * Bounding box over the live elements of a scene, read defensively: callers
 * hand it freshly built scenes and stored JSON of unknown age alike. Deleted
 * elements are tombstones and do not extend the box; a scene with nothing
 * measurable has no bounds, which appendPlacement turns into the default
 * origin.
 */
export function sceneBounds(elements: readonly unknown[]): SceneBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    if (!element || typeof element !== "object") {
      continue;
    }
    const candidate = element as Record<string, unknown>;
    if (candidate.isDeleted === true || typeof candidate.x !== "number" || typeof candidate.y !== "number") {
      continue;
    }
    const width = typeof candidate.width === "number" ? candidate.width : 0;
    const height = typeof candidate.height === "number" ? candidate.height : 0;
    minX = Math.min(minX, candidate.x);
    minY = Math.min(minY, candidate.y);
    maxX = Math.max(maxX, candidate.x + width);
    maxY = Math.max(maxY, candidate.y + height);
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Where an appended grid lands: right of everything already on the canvas and
 * top-aligned with it, so two result sets of similar shape read as side-by-side
 * columns. Nothing on the canvas yet means the default margin origin.
 */
export function appendPlacement(bounds: SceneBounds | null, idPrefix: string): GridPlacement {
  if (!bounds) {
    return { idPrefix, x: SCENE_MARGIN, y: SCENE_MARGIN };
  }
  return { idPrefix, x: Math.round(bounds.x + bounds.width + APPEND_GAP), y: Math.round(bounds.y) };
}

/**
 * Per-merge id namespace. The builder emits fixed literal ids, and Excalidraw
 * keys elements by id — a repeat id silently shadows its twin — so every merge
 * into an existing scene must bring a prefix that scene has never seen.
 */
export function makeIdPrefix(): string {
  return `g${Date.now().toString(36)}-${Math.floor(Math.random() * 4294967296).toString(36)}-`;
}

/**
 * Titles every appended table so same-table queries stay tellable apart on a
 * shared canvas: if the target already carries this exact title, the newcomer
 * is numbered ("Query: t (2)"). Only title-size text elements hold the
 * namespace — cell text at its smaller font cannot squat it.
 */
export function uniqueGridTitle(existingElements: readonly unknown[], base: string): string {
  const taken = new Set<string>();
  for (const element of existingElements) {
    if (!element || typeof element !== "object") {
      continue;
    }
    const candidate = element as Record<string, unknown>;
    if (candidate.isDeleted === true || candidate.type !== "text" || candidate.fontSize !== TITLE_FONT_SIZE) {
      continue;
    }
    if (typeof candidate.text === "string") {
      taken.add(candidate.text);
    }
  }
  if (!taken.has(base)) {
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base} (${index})`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * The stored-scene subset the merge reads or preserves. Unknown extra fields
 * ride along through the spread, so nothing a future scene format adds is
 * dropped on append.
 */
export interface StoredSceneLike {
  type?: unknown;
  version?: unknown;
  source?: unknown;
  elements?: unknown;
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

export type MergeOutcome =
  | { ok: true; scene: ExcalidrawScene; layout: GridSceneResult }
  | { ok: false; reason: "scene-full" };

/** Below this even a 0-row grid has no room; report the scene as full instead. */
const MIN_GRID_BUDGET = 2_000;
/** Headroom for drift between the estimate here and the backend's byte count. */
const MERGE_SLACK = 4_000;
/** Budget retried with before giving up; each retry drops rows, never columns. */
const MERGE_ATTEMPTS = 4;

function utf8Length(json: string): number {
  return new TextEncoder().encode(json).byteLength;
}

/**
 * Builds the grid for an append and merges it into a stored scene under the
 * backend's scene-size ceiling, reporting exactly what was left out through
 * the returned layout. The grid's budget starts at whatever the target scene
 * has not used up and shrinks on measured overshoot: the builder measures in
 * UTF-16 units while the ceiling counts UTF-8 bytes, so CJK-heavy cells can
 * push a "fitting" grid over the limit — each retry then trades rows until the
 * merged bytes verifiably fit. `scene-full` means even an empty grid would not
 * fit any more: the caller should say the target canvas is full rather than
 * silently shipping less than the preview promised.
 *
 * The appended elements are namespaced by `placement.idPrefix`; without a
 * fresh prefix the builder's fixed ids would shadow the grid appended before
 * them (restore() keys elements by id, and the shadowed twin disappears).
 */
export function mergeGridIntoScene(
  existing: StoredSceneLike | null,
  params: {
    grid: ResultGrid;
    title: string;
    caption?: string;
    maxRows?: number;
    maxColumns?: number;
    placement: GridPlacement;
  },
): MergeOutcome {
  const existingElements = Array.isArray(existing?.elements) ? (existing!.elements as unknown[]) : [];
  const existingBytes = existing ? utf8Length(JSON.stringify(existing)) : 0;
  let budget = Math.min(DEFAULT_MAX_BYTES, SCENE_BYTE_LIMIT - existingBytes - MERGE_SLACK);

  for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt += 1) {
    if (budget < MIN_GRID_BUDGET) {
      return { ok: false, reason: "scene-full" };
    }
    const layout = buildGridScene(params.grid, {
      title: params.title,
      caption: params.caption,
      maxRows: params.maxRows,
      maxColumns: params.maxColumns,
      placement: params.placement,
      maxBytes: budget,
    });
    // Defaults first so a stored scene without appState (the empty scene the
    // backend mints on create) still opens; the stored values win over them.
    const scene = (
      existing
        ? {
            type: "excalidraw" as const,
            version: 2,
            source: "dbx.excalidraw.studio",
            appState: {},
            files: {},
            ...existing,
            elements: [...existingElements, ...layout.scene.elements],
          }
        : layout.scene
    ) as ExcalidrawScene;
    const bytes = utf8Length(JSON.stringify(scene));
    if (bytes <= SCENE_BYTE_LIMIT) {
      return { ok: true, scene, layout };
    }
    const gridBytes = Math.max(1, bytes - existingBytes);
    budget -= Math.ceil(((bytes - SCENE_BYTE_LIMIT) * budget) / gridBytes);
  }
  return { ok: false, reason: "scene-full" };
}
