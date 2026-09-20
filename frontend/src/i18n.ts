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
  dropBlocked: string;
  corruptTitle: string;
  corruptBody: string;
  openFailed: string;
  openFailedBody: string;
  backendMissing: string;
  backendMissingBody: string;
  renameFailed: string;
  deleteFailed: string;
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
  dropBlocked: "To open an .excalidraw file, use Import on the home screen.",
  corruptTitle: "This diagram could not be opened",
  corruptBody: "The stored scene is damaged and was left untouched to avoid data loss.",
  openFailed: "This diagram could not be opened.",
  openFailedBody: "The document could not be loaded. Your other diagrams are unaffected.",
  backendMissing: "Excalidraw Studio backend is unavailable.",
  backendMissingBody: "Your current unsaved canvas is still open.",
  renameFailed: "Rename failed.",
  deleteFailed: "Delete failed.",
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
  dropBlocked: "请使用首页的“导入”按钮打开 .excalidraw 文件。",
  corruptTitle: "无法打开该图表",
  corruptBody: "存储的场景数据已损坏，为避免数据丢失未做任何改动。",
  openFailed: "无法打开该图表。",
  openFailedBody: "图表内容加载失败，其他图表不受影响。",
  backendMissing: "Excalidraw Studio 后端不可用。",
  backendMissingBody: "当前未保存的画布仍保持打开。",
  renameFailed: "重命名失败。",
  deleteFailed: "删除失败。",
};

export const strings: Record<Lang, Strings> = { en, zh };

export function pickLang(locale: string | undefined): Lang {
  return (locale ?? "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function format(template: string, value: number | string): string {
  return template.replace("{n}", String(value));
}
