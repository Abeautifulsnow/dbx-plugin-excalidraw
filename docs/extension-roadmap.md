# DBX 能力拓展任务追踪（Extension Roadmap）

> 本文件是**活的**任务清单：对照 `docs/reference/dbx-plugin-capabilities.md`（同步至 dbx main@adaaec5a3，Host API 1.4.0）维护，记录已实现、待实现、观望与已否决的拓展项。
> 历史依据见 `out/capability-extension-report.md`（2026-09-21 时点合成报告，其中结论部分已被后续版本落地或证伪，以本文件为准）。
> 最后更新：0.3.1 发布前（2026-09-28）。

## 状态图例

- `[x]` 已落地（标注版本）
- `[ ]` 待办（标注前置条件与验收要点）
- `⛔` 已否决（不要重提；一句话理由）
- `👀` 观望（等宿主/生态条件成熟）

---

## 0. 已落地

### 0.2.x – 0.3.0（对应旧报告 Tier 1 + T2-1）

- [x] `0.2.x` 三个贡献点：workbench / result-view / filesystem-provider（read/write/delete/rename，刻意无 mkdir）
- [x] `0.2.x` 内容寻址资产库 + 512 KiB 分块上传（绕开 2 MiB 桥限，无 framed binary）
- [x] `0.3.0` **发布守卫**（旧 T1-1）：`check-manifest.mjs` 断言 manifest ↔ `.dbx-store.json` 权限精确相等
- [x] `0.3.0` **openFilesystem 目录深链**（旧 T1-2）：编辑器与结果视图 → `excalidraw:/documents/`、`excalidraw:/exports/`
- [x] `0.3.0` **host.saveFile 原生另存为**（旧 T1-3）：sidecar 导出保持默认与退路
- [x] `0.3.0` **locale 原样透传**（旧 T1-4）：宿主 locale 直达 Excalidraw 编辑器
- [x] `0.3.0` **sidecar prefs**（旧 T1-5）：`prefs/get`、`prefs/set`，不引入 host.storage
- [x] `0.3.0` **计划上画布**（旧 T2-1）：`host.plans:read` + `capabilities.planApi` 运行时门，PostgreSQL/MySQL JSON 与缩进文本解析，警告落便签
- [x] `0.3.0` **Ask AI**：`host.ai` + `ai.openConversation` 单向快照（首个已发布消费者）

### 0.3.1（当前版本，未打 tag）

- [x] **复制场景 JSON**：导出菜单条目；`clipboard.writeText` 优先、旧宿主降级 `host.copy`；零权限
- [x] **粘贴场景**：`clipboard.readText` → 校验（与首页导入同口径）→ `restore` → 全量 id 重映射（元素/组/fileId/containerId/箭头绑定/frameId）→ 合并进当前画布；画布非空偏移 (32,32)；粘贴走既有自动保存
- [x] **粘贴剪贴板截图**：`clipboard.readImage`（仅 PNG）→ sha256 入内容寻址资产库（新抽 `persistence.ensureAssetUploaded`，与场景持久化共用去重）→ 长边 ≤800px 等比缩放 → 落在当前内容中心
- [x] **权限三处同步**：manifest.json + `.dbx-store.json` + `check-manifest.mjs` 白名单，均加 `host.clipboard:read`
- [x] **能力门控**：粘贴菜单按 `capabilities.clipboardRead` / `clipboardImageRead` 显隐（缺键即隐藏）；复制入口全宿主可见
- [x] 单测 12 例（重映射、非法输入四类、权限拒绝、上传去重、缩放、sceneCenter）
- [x] README（特性 bullet / compat 表含白名单安装期警告 / 已知限制）

### 0.3.1 真机验证清单（dev host 不模拟剪贴板，逐条过一遍再发版）

- [ ] 复制场景 JSON → 系统任意文本处可粘贴，JSON 可被首页导入还原
- [ ] 复制 → 在另一图表标签粘贴：元素/绑定/组/图片完整，与原画布内容不重叠，自动保存成功
- [ ] 截图 → 粘贴图片：首次征求对话框出现；拒绝后 toast 文案正确；同意后图片入库且重启后仍在
- [ ] 1 秒限速触发时表现为等待而非报错
- [ ] 旧宿主 / web 宿主上粘贴菜单整体隐藏、复制条目仍可用
- [ ] 撤销数据授权路径不受影响（本版未用 `host.data:read`，仅确认安装期白名单不报错）

---

## 1. 待办（按优先级）

### P1 —— 0.4.x 候选

- [ ] **T-A 结果画布全量重查**（`queryData`，Host API 1.4）
  - 做什么：`Sketch on canvas` 在 `capabilities.dataApi` 且用户授权后，用 `host.data:read` 重查完整结果集铺画布，消除 500 行快照截断；未授权/旧宿主走现路径零破坏；进阶：数据驱动图表（柱状/趋势）。
  - 前置：新权限 `host.data:read` → 触发权限三处同步 + catalog 相等门；逐连接授权对话框（用户可见同意面）；真机 ≥0.6.26。
  - 验收要点：`PLUGIN_DATA_ACCESS_NOT_GRANTED` 的降级路径；并发 ≤4、结果 ≤8 MiB 的失败面；SQL 只读分类器拒绝时的文案。
- [ ] **T-B AI 推荐提示词**（`workbench.ai.recommendations` + `ai.setRecommendations`）
  - 做什么：声明至多 5 条带 `{{sql}}`/`{{result.*}}` 插值的推荐；结果视图打开时推荐"解读 SQL 并建议可视化"，计划上画布后动态换成计划解读，普通画布清空。
  - 前置：声明式部分零权限；运行时替换走 `host.ai`（已声明）；占位符插值失败整条丢弃的宿主行为需真机确认。

### P2 —— 需要决策或先做实验

- [ ] **T-C 表结构上画布**（context-menu `menu:"table"` + 声明式 `action.open-workbench` + `getTableMetadata`）
  - 价值：形成"数据/计划/结构"三条上画布产品线，拼 ER 草图。
  - **前置决策：PRD 修订 R12 明确把"可视化数据库 schema"列为非目标**（`docs/PRD_V1_REVISIONS.md` R12）——需显式豁免，比照旧报告 D-6 对计划树的裁定口径。
  - 前置：`host.schema:read` 权限三处同步；`contextMenu/table` 的 context 载荷形状文档未写全，动手前先读宿主源码钉死。
- [ ] **T-D filedrop 拖放导入**
  - 已证实：filedrop/dragstate 帧**无权限门**（2026-09-21 复核结案）。
  - 未证实：真实宿主上帧是否到达（dev host 不模拟 webview 级拖放）→ 先做一次性监听实验，再决定是否投入。
  - 附带：`EditorPage` 的 `dropBlocked` 提示在桌面真实拖放下是死代码，实验时一并核对。
- [ ] **T-E 图库在线加载**（`host.network:https://libraries.excalidraw.org`）
  - 点亮 Excalidraw 自带图库面板（当前 CSP `connect-src: 'none'` 是死的）。
  - **前置决策**：动摇"local-first、无云服务"核心卖点，且网络权限对用户可见——产品取舍。

### P3 —— 观望（等条件成熟再评估）

- 👀 **command/menus 贡献点 + 底部 dock**（9/24 PR-A4）：全生态零消费者；发布版 `manifest.schema.json` 尚未收录这两个变体（运行时接受、schema 只有 5 个 const 块），上架校验是否放行未验证 → 等 schema 补齐。
- 👀 **MCP 工具面**（`mcp/tools` / `mcp/call`）：旧报告 D-4"契约不可证"已过时（协议已入 `plugins/README.md`，内置 AI agent 成首个消费者），但两条消费路径都以已存连接为中心（lifecycle 由连接 config 生成、AI 路径要求连接已打开），本插件无 connection-provider → 工具不会浮出。等宿主出现无连接工具路由。
- 👀 **`media.open` 流媒体**：Excalidraw 图片元素吃 dataURL 不吃 URL，仅未来首页缩略图可能受益。

---

## 2. 已否决（⛔ 不要重提）

| 项 | 一句话理由 |
| --- | --- |
| ⛔ filesystem `mkdir` capability | 宿主文件管理器是只读浏览：四个 mutation API 的 UI 调用方为 0，价值支点不存在（比"无插件请求"更强） |
| ⛔ `host.storage` 版偏好存储 | sidecar prefs 已等效覆盖（同一 `plugin-data/<id>` 目录），新权限串反而触发 catalog 门 |
| ⛔ framed binary（`stdio-framed` + `host.binary`） | S2 分块路径无失败迹象；未知帧是终止读循环的硬错误，收益只有省 33% base64 膨胀 |
| ⛔ `host.stream.*` 大载荷流 | 同上：无 SDK 生产端（要做全球第一个），PRD §14 open decision 3 明文"仅当分块太慢时重审" |
| ⛔ `host/requestUserInput` 反向提问 | 列的三个场景在本仓库都不存在；先指认一个真正无法 UI 内确认且不可逆的后端动作 |
| ⛔ `openWorkbench` 就地跳转 | 每次调用永久多一个标签（无回收通道）= 整份 Excalidraw 重载；现有 `setView` 是一次状态切换 |
| ⛔ 统一 hostProfile 协商 | init/context/env 帧都不带版本字段，渲染层合不出来；README compat 表已覆盖该信息 |
| ⛔ 自建签名仓库分发 | 先确认存在"装不上官方 catalog"的真实分发需求（离线/内网/拒收）再说 |

---

## 3. 横切守则（每个新权限 / 新能力过一遍）

1. **权限三处同步**：`manifest.json` ↔ `.dbx-store.json` ↔ `scripts/check-manifest.mjs` 的 `PERMISSIONS` 白名单。安装器要求 catalog 与包内精确相等，缺一处 = 下一版本所有安装硬拒。
2. **`engines.host_api` 保持 `"1"` 不抬**：抬版本 = 旧宿主整插件装不上。运行时 gate 只看 init 帧 `capabilities`（现为 11 键，缺键即不支持）；`frontend/src/types.ts` 的 capabilities 类型是所有新方向的第一步。
3. **白名单安装期警告要写进 README compat 表**：声明宿主白名单尚未收录的权限串（如新出的 `host.clipboard:read`）会让"过老的宿主"报整插件不兼容——与 result-view/plan API 同款取舍，逐条记录。
4. **dev host 不模拟任何新表面**（browser-bridge 缺 queryData/getTableMetadata/clipboard 全部新方法）：本地只做降级路径单测，真机（≥0.6.26 桌面版）验证清单写在 §0。
5. **敏感权限的用户可见面**：`host.clipboard:read` 已被插件中心标为敏感徽章，`host.data:read` 有逐连接授权对话框；README 与 store releaseNotes 同步表述。
6. **事件/提示不当真相**：若未来引入 `host.events`，广播会静默丢弃且零订阅即丢——每个消费者仍必须回读权威数据源。

---

## 4. 版本线

| 版本 | 主题 | 状态 |
| --- | --- | --- |
| 0.3.0 | 计划上画布 + Ask AI + 另存为 + 深链 + prefs | 已发布 |
| 0.3.1 | 剪贴板整合（复制 JSON / 粘贴场景 / 粘贴截图） | 代码完成，待真机验证 + 打 tag |
| 0.4.x（候选） | T-A queryData 全量重查；T-B AI 推荐提示词 | 未开工 |
