# PRD：Excalidraw Studio × DBX 融合功能清单

| | |
| --- | --- |
| 文档状态 | 草案 v1（2026-09-23） |
| 适用插件 | `io.dbx.excalidraw`（当前 0.2.3） |
| 能力参考 | [dbx-plugin-capabilities](./reference/dbx-plugin-capabilities.md)（宿主仓库工作区 `7c9b37811`，DBX 0.6.20+） |
| 决策记录 | 方向性讨论见同日会话结论：MCP 工具注册路线已验证不适用（`call-plugin-tool` 绑定 connection-provider 连接生命周期，`dbx/src-tauri/src/commands/mcp_bridge.rs:1362`），本清单不包含。 |

## 1. 背景与机会

宿主在 0.6.20 前后落地了三项与画布强相关的新能力：

1. **表级右键菜单**：context-menu 贡献点新增 `menu: "table"`，点击时后端收到表身份 `{ connectionId, database?, schema?, table }`（`dbx/apps/desktop/src/lib/plugins/pluginContext.ts:14-38`）——只含对象标识，无凭据。
2. **`host.ai` 权限 + `ai.openConversation`**：插件可把一份快照连同 prompt 投进内置 AI 面板开一条「插件数据会话」（title ≤200 字符、prompt ≤32000、context ≤2 MiB、`send` 缺省 false）；**单向**——插件拿不到模型输出与模型配置。
3. **文件句柄 UUID 化**：`plugin_file_*` 句柄改为端到端 UUID 字符串，`fileTransfer` 拖放/读写管线稳定可用（分块 ≤8 MiB）。

同时本插件在 0.2.3 已打通 plan API 管线（`frontend/src/plan.ts`：解析 PG/MySQL/文本计划 → tidy 布局 → Excalidraw 场景），是 plan API 目前唯一的端到端消费者。

**硬边界（贯穿全清单）**：插件没有 SQL 执行权；结果集快照 ≤500 行 / 约 2 MiB；计划 API 仅 estimated（SQL ≤200k 字符、rawPlan ≤4 MiB、超时 60s）。所有「数据驱动」场景必须绕道结果集、计划 API 或离线解析。

## 2. 目标与非目标

**目标**

- 让画布成为 DBX 内「表 → 设计 → 建模 → 计划调优」工作流的可视化底座，而不是孤立的白板。
- 每个功能都骑在宿主已发布的能力上，按「probe-and-degrade」哲学做运行时门禁，不抬高 `engines.host_api`（保持 `"1"`）。
- 小步版本：P0 一个版本发完，真机验证通过才进商店候选。

**非目标（明确不做）**

- 不做 SQL 执行/写库；不做真实（Actual）执行计划。
- 不做 MCP 工具注册（见决策记录）。
- 不做 AI 输出回流插件（宿主能力即单向）。
- 不做云同步/协作（守住 local-first 定位）。

## 3. 能力依赖与权限变更矩阵

| 目标版本 | manifest 变更 | 运行时门禁 | 本地守卫同步 |
| --- | --- | --- | --- |
| 0.3.0 | `permissions` += `host.ai`；`contributions` += context-menu（`menu: "table"`，需 backend 入口） | `capabilities.ai` 探测降级；菜单由宿主按声明渲染 | `check-manifest.mjs` PERMISSIONS 白名单 += `host.ai`（现仍缺 `host.storage`/`host.ai`） |
| 0.4.0 | 无新权限 | 结果集列签名检测 + 拖放均离线 | — |
| backlog | `permissions` += `host.network:https://<origin>`（≤2 个固定源） | 设置开关默认关（opt-in） | 网络权限正则已支持 |

> 商店一致性：`.dbx-store.json` 的 permissions 必须与 manifest 逐字一致，否则安装报 "Marketplace package permissions … do not match catalog permissions"（`dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:839`）。

## 4. 功能清单

优先级：P0（下一版）→ P3（backlog）。工作量：S ≤3 天 / M ≤2 周 / L 更大。

---

### F-01 让 AI 解读执行计划 `P0 · v0.3.0 · S`

**用户故事**：作为开发者，我把执行计划铺上画布后，希望一键把这份计划交给 DBX 内置 AI 解读，而不是自己复制粘贴计划 JSON。

**描述**：result-view 标签在 plan 管线产物之上新增动作「让 AI 解读」（按钮紧邻「计划上画布」）。将解析后的计划摘要作为 context、按 locale 预置解读 prompt，调用 `window.dbxPlugin.ai.openConversation({ title, prompt, context, send: true })`，`send: true` 让面板立即开始分析。

**context 快照内容**：树形计划文本（节点类型/成本/行数/每节点），热点节点标记，`PlanResult.warnings`，`truncated` 标志，SQL 原文（沿用现有 200k 截断），`dbType`。

**验收标准**

1. `capabilities.ai === true` 时按钮可见；否则不渲染（与 planReady 同款门禁模式）。
2. manifest 已声明 `host.ai`；宿主无 AI 面板时（`openAiConversation` 缺失）捕获 "DBX AI conversation panel is unavailable" 并 toast 降级，不 crash。
3. `title` ≤200 字符（由 SQL 派生名截断）；`prompt` ≤32000；`context` 序列化 ≤2 MiB，超限给出明确错误文案。
4. 打开的会话携带插件身份（宿主填 `pluginId`/`pluginName`/`capturedAt`），AI 面板立即开始分析。
5. zh/en 文案齐全；`check-manifest.mjs` 通过。

**技术要点**：`plan.ts` 导出 `planSummaryText()`；`ResultViewPage.tsx` 动作区扩展；i18n ×2；manifest/`.dbx-store.json`/check-manifest 三处权限同步。

---

### F-02 计划 warnings 与截断提示上画布 `P0 · v0.3.0 · S`（随 F-01）

**用户故事**：作为开发者，我希望宿主返回的计划警告（如索引缺失建议）直接以便签形式出现在画布上。

**描述**：`PlanResult.warnings` 非空时，在计划场景右上角生成一张黄色便签（每条 warning 一行，超过 5 条折叠为「+n more」）；`truncated` 沿用现有 caption 后缀方案。

**验收标准**

1. warnings 为空时场景与 0.2.3 逐字节一致（determinism 测试守护）。
2. 便签是普通 Excalidraw 文本元素，可移动/编辑/删除。
3. `plan.test.ts` 增加 warnings 便签用例（含 5+ 条折叠）。

---

### F-03 表右键 → 一键创建骨架设计画布 `P0 · v0.3.0 · S/M`

**用户故事**：作为开发者在侧边栏看到一张表，想立刻开一块画布做它的设计草稿（加列、画依赖、写注释），不想手动新建文档再抄表名。

**描述**：manifest 声明 `context-menu`（`id: io.dbx.excalidraw.table-canvas`，`menu: "table"`，label「画布设计此表 / Design on canvas」）。后端收到 `contextMenu/<id>` 的 `params.table` 后：在文档库创建骨架文档——标题文本 = 表名，便签 = `connection/database/schema` 身份行（缺层级则省略该行）+ 空白网格区；返回 `{ message }` 让宿主 toast 确认。

**验收标准**

1. 右键表节点出现菜单项；右键连接节点不出现（connection 表面不新增条目，现有声明不受影响）。
2. 文档名约定 `<schema>.<table> 设计`（无 schema 时 `<table> 设计`），同名自动追加序号。
3. `database`/`schema` 缺省时便签省略对应行，不出现 "undefined"。
4. 连续右键多张表生成多份独立文档；sidecar 单例（多标签共享）下无状态竞争。
5. 后端测试覆盖 params 解析与文档生成。

**边界**：本功能不负责「跳转到该文档」（宿主没有插件触发的 workbench 打开通道），用户经 `excalidraw:` 文件列表进入；引导方式见开放问题 Q1，导航增强拆到 F-04。

---

### F-04 表 ↔ 画布双向导航 `P1 · v0.4.0 · M`

**用户故事**：我在画布上画了一堆表，回到侧边栏右键其中一张时，希望画布直接定位并高亮它。

**描述**：依赖 F-03 的文档命名约定。右键菜单第二项「在画布中定位此表」以 table context 打开 workbench（context 携带表身份），前端在最近文档中查找同名标题元素，命中则选中+视口居中；未命中则 toast 并提供「创建骨架」快捷动作（复用 F-03）。

**验收标准**

1. 命中时元素被选中且视口滚动到可见；未命中时 3 秒内给出引导。
2. 不修改用户场景内容（只读定位）。

---

### F-05 元数据结果集 → ER 图 `P1 · v0.4.0 · M/L`

**用户故事**：作为 DBA，我跑一条 `information_schema` 外键查询后，希望把结果集直接贴成 ER 图，而不是手动画。

**描述**：result-view 新增第二动作「ER 图上画布」。先做列签名检测，命中后**弹层确认**（绝不静默转换），确认后把结果集重排为 ER 场景：表 = 矩形（首行表名、属性行文本），FK = 带端点箭头；布局复用 `plan.ts` tidy 布局器的泛化版。

**首发支持的列签名**（按价值排序，详见开放问题 Q2）：

1. `information_schema.key_column_usage` 形（`TABLE_NAME/COLUMN_NAME/REFERENCED_TABLE_NAME/REFERENCED_COLUMN_NAME/CONSTRAINT_NAME`）。
2. `SHOW CREATE TABLE` 单列文本形（正则解析 `CONSTRAINT ... FOREIGN KEY`）。
3. 简列清单形（`TABLE_NAME/COLUMN_NAME/DATA_TYPE`）→ 只画表卡片不画线。

**验收标准**

1. 非 ER 形结果集不显示该动作（列签名不匹配即隐藏，与 planReady 同模式）。
2. 确认弹层列出识别到的表数/边数；取消无副作用。
3. 快照 500 行上限内可表达约 20–40 张表；识别到的表数超过阈值（建议 40）时提示缩小查询范围。
4. 布局确定性：同输入两次生成逐字节一致（继承 plan 场景测试模式）。

---

### F-06 拖入 DDL 文件 → ER 图 `P1 · v0.4.0 · M`

**用户故事**：作为开发者，我把建表脚本从资源管理器拖进插件页，直接得到 ER 图。

**描述**：workbench 接收 OS 拖放（宿主 `filedrop` 帧 → `PluginFileHandleMeta[]`），对 `.sql`/`.ddl` 文件经 `fileTransfer.read` 分块读取（上限 8 MiB，超出明确拒绝），离线解析 `CREATE TABLE` / `ALTER TABLE ... ADD CONSTRAINT`（MySQL/PG 方言宽容处理，剥注释/字符串字面量），生成 ER 文档。

**验收标准**

1. 拖入非 .sql/.ddl 文件忽略或提示；>8 MiB 拒绝并提示拆分。
2. 解析失败时报告首个失败行号，不产生半成品文档。
3. vitest：多表、复合主外键、反引号/双引号标识符、注释干扰、IF NOT EXISTS。
4. 全程离线，无任何网络与 SQL 依赖。

---

### F-07 执行计划对比视图 `P2 · v0.4.x · M`

**用户故事**：作为调优者，我改写 SQL 或加索引前后各取一次计划，希望两棵树并排对比成本，而不是肉眼对两份 JSON。

**描述**：result-view 新增「对比上次计划」：与上一次成功解析的计划（会话内存，不落盘）并排布局为单文档，对应节点间虚线关联，节点标注 Δ 成本/Δ 行数；总成本更低的一侧标绿。

**验收标准**

1. 无历史计划时动作隐藏；两个计划 `dbType` 不同时拒绝并提示。
2. 节点对应关系按「根→根、同位置子树」对齐，无法对齐的节点不连线。
3. 场景 determinism 与节点数上限（复用 150 上限策略）测试通过。

---

### F-08 画布 → DDL 导出 `P2 · v0.5.0 · M/L`

**用户故事**：作为建模者，我在画布上画完模型，希望直接导出可执行的建表脚本。

**描述**：按约定式建模从场景生成 DDL：矩形 = 表（首行 `表名`、后续行 `列名 类型 [约束]`），箭头 = FK（箭头方向由「多」端指向「一」端，标签 `N:1`）。导出菜单新增「导出 DDL」，方言选 MySQL/PG，产物经 `host.saveFile` 存盘并可 `host.copy` 进剪贴板。

**验收标准**

1. 不符合约定的元素在导出预览中列出并跳过，不静默丢弃。
2. 生成脚本经语法自检（内置轻量校验或往返解析）。
3. 导出报告中包含表/边计数，与场景一致。

**边界**：约定格式是产品决策（见开放问题 Q3）；本功能不做图形化约束编辑器。

---

### F-09 导入/导出流程的宿主对话框决策点 `P3 · backlog · S`

**用户故事**：批量操作与用户交互的决策点（「发现 3 个同名文档，覆盖哪个？」）直接弹宿主对话框，而不是前端轮询自造 UI。

**描述**：sidecar 在需要决策时经 `host/requestUserInput`（Host API 1.1）提问：默认超时 300s（最大 600s）、每会话 ≤4 个未决提问；错误码降级路径——`-32001` 无 UI、`-32602` 参数错、`-32601` 不支持时一律取保守默认值（取消/跳过）并继续。

**验收标准**：三个错误码各自的降级行为有单测；超时取保守默认。

---

### F-10 在线模板库 `P3 · backlog · M`

**用户故事**：新用户不想从空白画布开始，希望从精选模板（架构图、ER 模板）一键起步。

**描述**：manifest 声明 1–2 个固定 `host.network:https://<origin>` 模板源；设置页开关默认关闭（opt-in，守住 local-first）；拉取 `.excalidraw` 模板经 `host.downloadFile`（桌面）或 CSP 放行后的 fetch 导入为文档/库。

**验收标准**：开关关闭时零网络请求；源固定写死（非用户自填 URL）；导入失败有明确错误。

---

## 5. 里程碑

| 版本 | 内容 | 主题 |
| --- | --- | --- |
| 0.3.0 | F-01、F-02、F-03 | 「骑在新能力上的最小融合版」：AI + 表右键 |
| 0.4.0 | F-05、F-06、F-04 | ER 双入口（结果集 + DDL 拖入）与导航 |
| 0.4.x | F-07 | 计划对比 |
| 0.5.0 | F-08 | 画布 → DDL，形成建模闭环 |
| backlog | F-09、F-10 | 体验补齐 |

每个版本的固定动作：manifest/`.dbx-store.json`/`check-manifest.mjs` 三处同步 → `sync-version.mjs` → typecheck + vitest + build → 真机验证（见 §6）→ 打 tag 走 `scripts/release.mjs` → 商店候选。

## 6. 验收与测试策略

1. **单测**（vitest）：所有解析器/布局器/签名检测走表驱动用例；场景 determinism 不变量（同输入逐字节一致、热点唯一、箭头端点合法）沿用 0.2.3 的测试模式。
2. **上限边界单测**：200/32000/2 MiB（F-01）、8 MiB（F-06）、500 行/40 表（F-05）、150 节点（F-07 继承）。
3. **真机验证清单**（dev host 做不了的事）：`dbx-plugin dev` 注入的 mock bridge **缺** `getPlanCapabilities`/`explainPlan`/`ai.openConversation`/`downloadFile`/`fileTransfer`，因此 F-01/04/05/06/10 的端到端必须在真实 DBX（≥ 含 table 右键与 host.ai 的构建）里验证；`context-menu` 与 `host.ai` 目前都没有已发布先例（审计结论「已实现但未经现场验证」），v0.3.0 发布前必须完成实机走查并截图留档。
4. **i18n**：每个功能 zh/en 双语条目齐全，`check-manifest.mjs` 的本地化 key 校验通过。

## 7. 风险与开放问题

**风险**

- R1 `host.ai` / table 右键均为宿主新能力，行为细节（如 AI 会话 UI、菜单渲染时机）以实机为准 → P0 不抢发，实机走查前置。
- R2 F-05 列签名启发式误判（普通结果撞签名）→ 强制确认弹层，永不静默转换。
- R3 权限镜像不一致会导致已发布包安装失败（installer.rs:839）→ 三处同步进发版固定动作。
- R4 快照上限（500 行/2 MiB）限制 ER 规模 → 超限引导用户缩小范围，不做静默截断图。

**开放问题**

- Q1（F-03）：创建骨架文档后如何引导用户到达？候选：toast 文案指路文件列表 + 新文档置顶；或探索 `dbx-open-plugin-install-links` 类宿主事件是否有可复用通道（低概率）。
- Q2（F-05）：首发列签名清单是否收敛为 key_column_usage + SHOW CREATE TABLE 两种？建议是，简列清单形放第二批。
- Q3（F-08）：约定文本格式细节（首行表名的解析规则、列类型词表、复合 FK 的箭头表达）需要一份独立 mini-spec 再动工。

## 附：关键能力锚点

| 能力 | 锚点 |
| --- | --- |
| table 右键载荷 | `dbx/apps/desktop/src/lib/plugins/pluginContext.ts:14-38`；manifest 校验 `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:1133-1138` |
| ai.openConversation | 分派与门禁 `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:337-343`；校验 `dbx/apps/desktop/src/lib/ai/aiPluginConversation.ts:19-31` |
| 权限枚举（含 host.ai） | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:24-25`；schema `dbx/plugins/manifest.schema.json:33` |
| fileTransfer 拖放/句柄 | `dbx/apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:88-95`；句柄 UUID 化 `dbx/src-tauri/src/commands/plugin_file.rs:55-61` |
| 计划上限 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:946` 起（estimated 唯一 mode、200k/4 MiB/60s） |
| requestUserInput | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:701`；README「Estimated execution plans / Host API 1.1」节 |
| 权限镜像校验 | `dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:839` |
