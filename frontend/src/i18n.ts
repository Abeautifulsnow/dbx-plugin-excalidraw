export type Lang = "en" | "zh";

export interface Strings {
  productName: string;
  newDiagram: string;
  import: string;
  searchPlaceholder: string;
  recent: string;
  emptyTitle: string;
  emptyBody: string;
  rename: string;
  delete: string;
  renameTitle: string;
  deleteTitle: string;
  deleteBody: string;
  cancel: string;
  confirm: string;
  dismiss: string;
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
  loadFailed: string;
  retry: string;
  importInvalid: string;
  importFailed: string;
  createFailed: string;
  back: string;
  saved: string;
  saving: string;
  unsaved: string;
  saveFailed: string;
  export: string;
  exportExcalidraw: string;
  exportPng: string;
  exportSvg: string;
  exportSavedPath: string;
  exportFailed: string;
  exportSaveDialogFallback: string;
  saveAsExcalidraw: string;
  saveAsPng: string;
  saveAsSvg: string;
  openExportsFolder: string;
  revealInFileManager: string;
  revealFailed: string;
  dropBlocked: string;
  corruptTitle: string;
  corruptBody: string;
  openFailed: string;
  openFailedBody: string;
  backendMissing: string;
  backendMissingBody: string;
  renameFailed: string;
  deleteFailed: string;
  resultViewTitle: string;
  resultViewSubtitle: string;
  resultViewNoRows: string;
  resultViewNoContext: string;
  resultViewNoContextBody: string;
  resultViewRows: string;
  resultViewRowLimit: string;
  resultViewCreate: string;
  resultViewCreating: string;
  resultViewFailed: string;
  resultViewHostTruncated: string;
  resultViewPreviewNote: string;
  resultViewIncluded: string;
  resultViewOmitted: string;
  resultViewOmittedColumns: string;
  resultViewSql: string;
  resultViewOpenExisting: string;
  resultViewAppend: string;
  resultViewAppendBody: string;
  resultViewAppendPick: string;
  resultViewAppendSummary: string;
  resultViewAppendBusy: string;
  resultViewAppendConfirm: string;
  resultViewAppendEmptyList: string;
  resultViewAppendCorrupt: string;
  resultViewAppendSceneFull: string;
  resultViewAppendFailed: string;
  planCreate: string;
  planCreating: string;
  planSceneTitle: string;
  planUnsupported: string;
  planUnreadable: string;
  planFailed: string;
  planTruncated: string;
  planAi: string;
  planAiFailed: string;
  planAiTooLarge: string;
  planAiPrompt: string;
  planWarningsHeading: string;
  planWarningsMore: string;
  copySceneJson: string;
  copySceneDone: string;
  copySceneFailed: string;
  paste: string;
  pasteScene: string;
  pasteImage: string;
  pasteSceneDone: string;
  pasteImageDone: string;
  pasteSceneInvalid: string;
  pasteFailed: string;
  recInterpretResultLabel: string;
  recInterpretResultPrompt: string;
  recVisualizeLabel: string;
  recVisualizePrompt: string;
  recOptimizeSqlLabel: string;
  recOptimizeSqlPrompt: string;
  recInterpretPlanLabel: string;
  recInterpretPlanPrompt: string;
  recPlanSuggestionsLabel: string;
  recPlanSuggestionsPrompt: string;
}

const en: Strings = {
  productName: "Excalidraw Studio",
  newDiagram: "New",
  import: "Import",
  searchPlaceholder: "Search diagrams...",
  recent: "Recent diagrams",
  emptyTitle: "Create your first diagram",
  emptyBody: "Sketch ideas, flows, architecture, and more with Excalidraw.",
  rename: "Rename",
  delete: "Delete",
  renameTitle: "Rename diagram",
  deleteTitle: "Delete diagram",
  deleteBody: "This diagram will be removed from Excalidraw Studio.",
  cancel: "Cancel",
  confirm: "Delete",
  dismiss: "Dismiss",
  justNow: "just now",
  minutesAgo: "{n} min ago",
  hoursAgo: "{n} h ago",
  daysAgo: "{n} d ago",
  loadFailed: "Could not load diagrams",
  retry: "Retry",
  importInvalid: "Unable to import this file. The file is not a valid Excalidraw document.",
  importFailed: "Import failed.",
  createFailed: "Could not create the diagram.",
  back: "Back",
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved",
  saveFailed: "Save failed",
  export: "Export",
  exportExcalidraw: "Excalidraw (.excalidraw)",
  exportPng: "PNG image",
  exportSvg: "SVG vector",
  exportSavedPath: "Exported to {n}",
  exportFailed: "Export failed.",
  exportSaveDialogFallback: "Could not save through the system dialog; exported to {n}",
  saveAsExcalidraw: "Save as .excalidraw…",
  saveAsPng: "Save as PNG…",
  saveAsSvg: "Save as SVG…",
  openExportsFolder: "Open the exports folder",
  revealInFileManager: "Show in file manager",
  revealFailed: "Could not open the DBX file manager.",
  dropBlocked: "To open an .excalidraw file, use Import on the home screen.",
  corruptTitle: "This diagram could not be opened",
  corruptBody: "The stored scene is damaged and was left untouched to avoid data loss.",
  openFailed: "This diagram could not be opened.",
  openFailedBody: "The document could not be loaded. Your other diagrams are unaffected.",
  backendMissing: "Excalidraw Studio backend is unavailable.",
  backendMissingBody: "Your current unsaved canvas is still open.",
  renameFailed: "Rename failed.",
  deleteFailed: "Delete failed.",
  resultViewTitle: "Sketch this result",
  resultViewSubtitle: "Put the result set on a canvas, then draw on it.",
  resultViewNoRows: "This result has no rows to lay out.",
  resultViewNoContext: "No result set was passed to this tab.",
  resultViewNoContextBody: "Open it from the results toolbar of a query tab.",
  resultViewRows: "Rows on canvas",
  resultViewRowLimit: "Up to {n}",
  resultViewCreate: "Create canvas",
  resultViewCreating: "Creating…",
  resultViewFailed: "Could not create the canvas.",
  resultViewHostTruncated: "DBX passed the first {n} rows only.",
  resultViewPreviewNote: "Showing the first {n} rows of {total}.",
  resultViewIncluded: "{n} rows × {m} columns on the canvas",
  resultViewOmitted: "{n} rows left off to keep the canvas a workable size",
  resultViewOmittedColumns: "{n} columns left off",
  resultViewSql: "SQL",
  resultViewOpenExisting: "Open a diagram",
  resultViewAppend: "Add to a canvas",
  resultViewAppendBody:
    "Pick a canvas; the result lands as a new table to the right of its content, ready for side-by-side comparison.",
  resultViewAppendPick: "Pick a canvas",
  resultViewAppendSummary: "Adds {n} rows × {m} columns",
  resultViewAppendBusy: "Adding…",
  resultViewAppendConfirm: "Add",
  resultViewAppendEmptyList: "No canvases yet — create one first with Create canvas.",
  resultViewAppendCorrupt: "That diagram is damaged and cannot take an append.",
  resultViewAppendSceneFull: "That canvas has reached the 2 MB scene limit; nothing more fits.",
  resultViewAppendFailed: "Could not add to the canvas.",
  planCreate: "Plan on canvas",
  planCreating: "Planning…",
  planSceneTitle: "Execution plan",
  planUnsupported: "This connection does not support estimated plans.",
  planUnreadable: "The host returned a plan this canvas cannot lay out yet.",
  planFailed: "Could not fetch or draw the execution plan.",
  planTruncated: "plan truncated to {n} nodes",
  planAi: "Ask AI",
  planAiFailed: "Could not open the DBX AI panel.",
  planAiTooLarge: "The plan snapshot exceeds the AI panel's size limit.",
  planAiPrompt: "Here is a query's estimated execution plan captured by DBX (EXPLAIN only, never executed). Explain the plan: what the query does step by step, where the cost concentrates (the highest-cost node is marked '<-- highest cost'), whether row estimates look suspicious, and which concrete changes (indexes, query rewrites, settings) would help. Reference node names. Answer in the user's language.",
  planWarningsHeading: "Plan warnings",
  planWarningsMore: "+{n} more",
  copySceneJson: "Copy scene JSON",
  copySceneDone: "Scene JSON copied to the clipboard.",
  copySceneFailed: "Could not write to the clipboard.",
  paste: "Paste",
  pasteScene: "Scene from clipboard",
  pasteImage: "Image from clipboard",
  pasteSceneDone: "Pasted {n} elements onto the canvas.",
  pasteImageDone: "Image added to the canvas.",
  pasteSceneInvalid: "The clipboard does not hold a valid Excalidraw scene.",
  pasteFailed: "Could not read the clipboard.",
  recInterpretResultLabel: "Interpret this result set",
  recInterpretResultPrompt:
    "Interpret the result set on this canvas: what the data shows, notable outliers or trends, and which rows matter most. Reference actual values where useful.",
  recVisualizeLabel: "Suggest a visualization",
  recVisualizePrompt:
    "Based on this result set's columns and value shapes, recommend the best chart type for the data and explain why, so it can be sketched on the canvas.",
  recOptimizeSqlLabel: "Review the SQL",
  recOptimizeSqlPrompt:
    "Review the SQL behind this result set for correctness and performance pitfalls, and suggest concrete improvements such as indexes or rewrites.",
  recInterpretPlanLabel: "Interpret this execution plan",
  recInterpretPlanPrompt:
    "Interpret the execution plan on this canvas: what each operator does, where the cost concentrates, and whether row estimates look suspicious. Reference node names.",
  recPlanSuggestionsLabel: "Plan improvement suggestions",
  recPlanSuggestionsPrompt:
    "Based on this execution plan, suggest concrete changes (indexes, query rewrites, settings) and name the node each change addresses.",
};

const zh: Strings = {
  productName: "Excalidraw Studio",
  newDiagram: "新建",
  import: "导入",
  searchPlaceholder: "搜索图表...",
  recent: "最近使用",
  emptyTitle: "创建你的第一个图表",
  emptyBody: "使用 Excalidraw 绘制灵感、流程图、架构图等。",
  rename: "重命名",
  delete: "删除",
  renameTitle: "重命名图表",
  deleteTitle: "删除图表",
  deleteBody: "该图表将从 Excalidraw Studio 中移除。",
  cancel: "取消",
  confirm: "删除",
  dismiss: "关闭",
  justNow: "刚刚",
  minutesAgo: "{n} 分钟前",
  hoursAgo: "{n} 小时前",
  daysAgo: "{n} 天前",
  loadFailed: "无法加载图表列表",
  retry: "重试",
  importInvalid: "无法导入该文件：不是有效的 Excalidraw 文档。",
  importFailed: "导入失败。",
  createFailed: "无法创建图表。",
  back: "返回",
  saved: "已保存",
  saving: "保存中…",
  unsaved: "未保存",
  saveFailed: "保存失败",
  export: "导出",
  exportExcalidraw: "Excalidraw (.excalidraw)",
  exportPng: "PNG 图片",
  exportSvg: "SVG 矢量图",
  exportSavedPath: "已导出到 {n}",
  exportFailed: "导出失败。",
  exportSaveDialogFallback: "未能通过系统对话框保存，已导出到 {n}",
  saveAsExcalidraw: "另存为 .excalidraw…",
  saveAsPng: "另存为 PNG…",
  saveAsSvg: "另存为 SVG…",
  openExportsFolder: "打开导出文件夹",
  revealInFileManager: "在文件管理器中显示",
  revealFailed: "无法打开 DBX 文件管理器。",
  dropBlocked: "请使用首页的“导入”按钮打开 .excalidraw 文件。",
  corruptTitle: "无法打开该图表",
  corruptBody: "存储的场景数据已损坏，为避免数据丢失未做任何改动。",
  openFailed: "无法打开该图表。",
  openFailedBody: "图表内容加载失败，其他图表不受影响。",
  backendMissing: "Excalidraw Studio 后端不可用。",
  backendMissingBody: "当前未保存的画布仍保持打开。",
  renameFailed: "重命名失败。",
  deleteFailed: "删除失败。",
  resultViewTitle: "把这份结果贴到画布",
  resultViewSubtitle: "结果集铺到画布上，就可以随手圈画批注了。",
  resultViewNoRows: "这份结果没有数据行可铺。",
  resultViewNoContext: "这个标签页没有拿到结果集。",
  resultViewNoContextBody: "请从查询结果工具栏打开它。",
  resultViewRows: "铺到画布的行数",
  resultViewRowLimit: "最多 {n} 行",
  resultViewCreate: "创建画布",
  resultViewCreating: "创建中…",
  resultViewFailed: "无法创建画布。",
  resultViewHostTruncated: "DBX 只传递了前 {n} 行。",
  resultViewPreviewNote: "预览 {total} 行中的前 {n} 行。",
  resultViewIncluded: "画布上共 {n} 行 × {m} 列",
  resultViewOmitted: "为保证画布可用，省略了 {n} 行",
  resultViewOmittedColumns: "省略了 {n} 列",
  resultViewSql: "SQL",
  resultViewOpenExisting: "打开已有图表",
  resultViewAppend: "追加到已有画布",
  resultViewAppendBody: "选择一张已有图表，这份结果会作为新表格放在它现有内容的右侧，方便并排比对。",
  resultViewAppendPick: "选择目标图表",
  resultViewAppendSummary: "将追加 {n} 行 × {m} 列",
  resultViewAppendBusy: "追加中…",
  resultViewAppendConfirm: "追加",
  resultViewAppendEmptyList: "还没有可追加的图表——先用“创建画布”生成一张。",
  resultViewAppendCorrupt: "这张图表已损坏，无法追加。",
  resultViewAppendSceneFull: "这张画布已达到 2 MB 场景上限，放不下更多内容。",
  resultViewAppendFailed: "追加失败。",
  planCreate: "计划上画布",
  planCreating: "生成计划…",
  planSceneTitle: "执行计划",
  planUnsupported: "当前连接不支持预估执行计划。",
  planUnreadable: "宿主返回的计划格式暂时无法铺到画布。",
  planFailed: "获取或绘制执行计划失败。",
  planTruncated: "计划已截断为 {n} 个节点",
  planAi: "让 AI 解读",
  planAiFailed: "未能打开 DBX AI 面板。",
  planAiTooLarge: "计划快照超出 AI 面板的大小限制。",
  planAiPrompt: "以下是 DBX 取到的查询预估执行计划（仅 EXPLAIN，未真正执行）。请解读该计划：逐步说明查询实际在做什么、成本集中在哪里（最高成本节点已标注 '<-- highest cost'）、行数估算是否可疑，并给出具体可落地的优化建议（索引、改写、参数）。请引用节点名，并用用户的语言回答。",
  planWarningsHeading: "计划警告",
  planWarningsMore: "另有 {n} 条",
  copySceneJson: "复制场景 JSON",
  copySceneDone: "场景 JSON 已复制到剪贴板。",
  copySceneFailed: "无法写入剪贴板。",
  paste: "粘贴",
  pasteScene: "剪贴板中的场景",
  pasteImage: "剪贴板中的图片",
  pasteSceneDone: "已粘贴 {n} 个元素到画布。",
  pasteImageDone: "图片已添加到画布。",
  pasteSceneInvalid: "剪贴板里没有有效的 Excalidraw 场景。",
  pasteFailed: "无法读取剪贴板。",
  recInterpretResultLabel: "解读这份结果集",
  recInterpretResultPrompt:
    "请解读画布上的这份结果集：数据说明了什么、有哪些明显的异常值或趋势、哪些行最值得关注。请尽量引用真实数值。",
  recVisualizeLabel: "推荐可视化方式",
  recVisualizePrompt:
    "请根据这份结果集的列与取值形态，推荐最适合的图表类型并说明理由，方便我在画布上把它画出来。",
  recOptimizeSqlLabel: "审查这段 SQL",
  recOptimizeSqlPrompt:
    "请审查这份结果集背后的 SQL，指出正确性与性能隐患，并给出具体改进建议（索引、改写、参数等）。",
  recInterpretPlanLabel: "解读这份执行计划",
  recInterpretPlanPrompt:
    "请解读这张画布上的执行计划：每个算子在做什么、成本集中在哪里、行数估算是否可疑。请引用节点名。",
  recPlanSuggestionsLabel: "计划优化建议",
  recPlanSuggestionsPrompt:
    "请基于这份执行计划给出具体可落地的改动建议（索引、改写、参数），并说明每条建议对应哪个节点。",
};

export const strings: Record<Lang, Strings> = { en, zh };

export function pickLang(locale: string | undefined): Lang {
  return (locale ?? "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

/**
 * The languages the Excalidraw editor actually ships, copied from
 * `@excalidraw/excalidraw/dist/prod/locales`. Excalidraw's own codes are not the
 * codes DBX hands us: the host reports `es`, `it`, `ja`, `ko`, `tr` and `az`
 * where the editor only knows `es-ES`, `it-IT`, `ja-JP`, `ko-KR`, `tr-TR` and
 * `az-AZ`. Handing the host value straight to the editor would drop six of the
 * ten host locales back to English, which is why it is resolved against this
 * list instead.
 *
 * Re-check this list when the pinned Excalidraw version is upgraded. It is
 * exported so `__tests__/i18n.test.ts` can diff it against the locales the
 * installed package actually ships, which turns a silent locale regression into
 * a failing test on the upgrade commit.
 */
export const EXCALIDRAW_LANGS = [
  "ar-SA", "az-AZ", "bg-BG", "bn-BD", "ca-ES", "cs-CZ", "da-DK", "de-DE", "el-GR",
  "en", "es-ES", "eu-ES", "fa-IR", "fi-FI", "fr-FR", "gl-ES", "he-IL", "hi-IN",
  "hu-HU", "id-ID", "it-IT", "ja-JP", "kaa", "kab-KAB", "kk-KZ", "km-KH", "ko-KR",
  "ku-TR", "lt-LT", "lv-LV", "mr-IN", "my-MM", "nb-NO", "nl-NL", "nn-NO", "oc-FR",
  "pa-IN", "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU", "si-LK", "sk-SK", "sl-SI",
  "sv-SE", "ta-IN", "th-TH", "tr-TR", "uk-UA", "vi-VN", "zh-CN", "zh-HK", "zh-TW",
];

const EXCALIDRAW_BY_CODE = new Map(EXCALIDRAW_LANGS.map((code) => [code.toLowerCase(), code]));
const EXCALIDRAW_BY_PRIMARY = new Map<string, string>();
for (const code of EXCALIDRAW_LANGS) {
  const primary = code.split("-")[0].toLowerCase();
  // First match wins, so a shared primary tag (pt, zh) resolves deterministically.
  if (!EXCALIDRAW_BY_PRIMARY.has(primary)) {
    EXCALIDRAW_BY_PRIMARY.set(primary, code);
  }
}

/**
 * Narrows a host locale to the closest language the editor can render, so a
 * host set to `ja` gets `ja-JP` rather than an unmatched code. Anything the
 * editor has no translation for resolves to English — the same outcome the
 * editor would reach on its own, but reached deliberately.
 */
export function excalidrawLangCode(locale: string | undefined): string {
  const normalized = (locale ?? "").trim().toLowerCase();
  if (!normalized) {
    return "en";
  }
  return (
    EXCALIDRAW_BY_CODE.get(normalized) ?? EXCALIDRAW_BY_PRIMARY.get(normalized.split("-")[0]) ?? "en"
  );
}

export function format(template: string, value: number | string): string {
  return template.replace("{n}", String(value));
}

/** Fills every `{key}` placeholder; used where a string carries more than one. */
export function formatAll(template: string, values: Record<string, number | string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Relative timestamp for document listings. Lives here rather than in a page
 * component so every surface that lists documents (the home grid, the append
 * picker) renders identical times from one implementation.
 */
export function relativeTime(iso: string, lang: Lang, t: Strings): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) {
    return t.justNow;
  }
  if (minutes < 60) {
    return format(t.minutesAgo, minutes);
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return format(t.hoursAgo, hours);
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return format(t.daysAgo, days);
  }
  return new Date(timestamp).toLocaleDateString(lang === "zh" ? "zh-CN" : "en");
}
