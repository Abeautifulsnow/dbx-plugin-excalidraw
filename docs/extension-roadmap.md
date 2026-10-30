# DBX 能力拓展任务追踪（Extension Roadmap）

> 本文件是**活的**任务清单：对照 `docs/reference/dbx-plugin-capabilities.md`（同步至 dbx main@adaaec5a3，Host API 1.4.0）维护，记录已实现、待实现、观望与已否决的拓展项。
> 历史依据见 `out/capability-extension-report.md`（2026-09-21 时点合成报告，其中结论部分已被后续版本落地或证伪，以本文件为准）。
> 最后更新：0.4.0 资产因空白回归作废（React #310，见 §0 修复记录），修复与「追加到已有画布」随 **0.4.1** 发布（待打 tag）；capabilities 类型已对齐 2026-10-23 宿主帧（dbx main@590a311b5）。

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

### 0.3.1 真机验证清单（dev host 不模拟剪贴板；v0.3.1 已发布——装上正式包逐条过）

- [ ] 复制场景 JSON → 系统任意文本处可粘贴，JSON 可被首页导入还原
- [ ] 复制 → 在另一图表标签粘贴：元素/绑定/组/图片完整，与原画布内容不重叠，自动保存成功
- [ ] 截图 → 粘贴图片：首次征求对话框出现；拒绝后 toast 文案正确；同意后图片入库且重启后仍在
- [ ] 1 秒限速触发时表现为等待而非报错
- [ ] 旧宿主 / web 宿主上粘贴菜单整体隐藏、复制条目仍可用
- [ ] 撤销数据授权路径不受影响（本版未用 `host.data:read`，仅确认安装期白名单不报错）

---

### 0.4.0（已发布，tag v0.4.0）

- [x] **标签页标题跟随**（`setTitle`/`getTitle`，2026-10-23 起 init 帧 `capabilities.workbenchTitle`）
  - 编辑器标签 = 文档名，未保存时前缀 `• `（跟随已提交名，不跟随重命名草稿）；首页 = 产品名；结果视图标签 = `deriveName(sql)` 派生名，多个查询开出的标签可区分
  - 门控 `capabilities.workbenchTitle`（缺键即无行为）；复用已声明 `host.workbench`，**零新权限**，无三处同步与白名单安装期问题
  - `applyTabTitle` 去重（同串不发宿主）+ 120 字符截断 + 调用被拒后弃记忆重试（仅当无更新标题接管时复位）；App/EditorPage 标题接线收敛为 `useTabTitle` hook
  - 横切守则第一步同步落地：`types.ts` capabilities 补齐宿主 17 键 + `fileTransfer` 子对象，声明 `contributionId` getter 与 `setTitle`/`getTitle`
  - 附带：`primeLaunchFromBridge` 错过 init 帧时优先读桥上的 `contributionId`，只有旧宿主才退回载荷形状推断（`dbx-plugin-init` 恢复日志随之改口径）
  - dev-host 已模拟 `host.setTitle`/`getTitle`（`server.mjs`），本项可本地端到端验证，不依赖真机
- [x] **AI 推荐提示词**（T-B，纯运行时 `ai.setRecommendations`/`clearRecommendations`）
  - ⛔ 声明式半边（`workbench.ai.recommendations`）实现后**撤回，不要重提**：`PluginWorkbenchContribution` 带 `#[serde(deny_unknown_fields)]`（宿主 manifest.rs），且该字段 2026-09-27（e6edd02bb）才加入——之前的宿主对携带 `ai` 的整份 manifest 解析失败，engines 区间 0.5.68~0.6.26 **装不上**；比 result-view 的"标签加载失败"更重（安装期硬拒 vs 运行时降级）。恢复条件：`engines.dbx` 下限抬过字段引入版本时重新评估（与 ⛔ 表 mcp 行同类裁定）
  - 运行时：`aiRecommendations.ts` + `useAiRecommendations` hook（门控 `capabilities.aiRecommendations` + `host.ai` 已声明，**零新权限、零 manifest 变更**）；载荷为宿主信封 `{ context, items≤5 }`（对照宿主源码 `requirePluginAiRecommendationUpdate` 钉死——裸数组被拒，context 传本标签上下文供占位符插值）；同串去重 + 拒绝弃记忆重试；首次 clear 也发（新开普通画布要能清掉其他标签的 chips）；宿主标签切换为 v-show 保活不卸载（App.vue），hook 在每次 visibilitychange（iframe 隐藏/恢复）时 **force 重申**本视图语义——"当前可见视图决定面板内容"，force 绕过两级去重备忘
  - 视图接线：结果视图挂载设结果解读/可视化/SQL 审查 3 条（zh/en 双语），计划解析成功（上画布与 Ask AI 两路径）换计划解读/优化建议 2 条；EditorPage 对计划文档（命名约定 `<query> - plan` 或本地化标题）设计划推荐、其他文档清空；HomePage 挂载清空
  - dev-host 已完整模拟 `host.ai.*` 三方法（参数校验与生产桥同构），本地可验证；宿主源码已本地核对（dbx 仓 pluginHostBridge.ts / manifest.rs）
  - 真机待验：① 推荐条点击后 AI 会话的上下文来源（宿主侧行为）；② 多标签覆盖次序已按 visibility 重播种实现，真机确认 iframe display:none 翻转是否如预期触发 visibilitychange（宿主 App.vue 为 v-show 保活，理论成立）
- [x] **修复 0.4.0 空白回归**（2026-10-30，随 0.4.1 发布）
  - 根因：`useTabTitle` 位于 App 的 boot/nohost 提前返回之后——首帧（boot）不执行该 hook，ready 后 hook 数量变化，React 抛 #310 并卸载整树，**所有标签页空白**；宿主能力键缺失时 hook 所在路径不渲染反而稳态隐藏了问题（单测只测纯函数，不可见；dev-host 打开一次即可复现）
  - 修复：hook 移到提前返回之前，boot/nohost 传 null 不动作；dev-host + 无头浏览器端到端验证渲染恢复（注入 DOM 错误陷阱抓到 #310 可读堆栈后定位）
  - 防再发待办：引入 eslint-plugin-react-hooks 进 CI（见 P2）；发版前在 dev-host 至少打开一次工作台确认渲染
- [x] **追加到已有画布**（2026-10-30，随 0.4.1 发布）
  - 结果视图第二动作：多个结果集累加进同一张画布并排比对。宿主每次只递一份结果快照（`openPluginResultView` 单 `result` 契约，且 `openPluginWorkbench` 重开不更新 context），故为逐份追加而非一次全贴；第一份仍走「创建画布」
  - `resultScene` 参数化：`placement`（id 前缀 + 绝对原点）——构建器发的是固定字面量 id，Excalidraw 按 id 去重遮蔽同 id 元素，每次合并必须带目标场景未见过的前缀（`makeIdPrefix`）；`sceneBounds`/`appendPlacement` 把新表格放到现有内容右侧、顶部对齐（`APPEND_GAP`=80）
  - `mergeGridIntoScene`：网格预算从目标场景剩余空间起算（后端 `saveScene` 2MB 上限即 `SCENE_BYTE_LIMIT`）；构建器按 UTF-16 单位估、宿主按 UTF-8 字节拒，CJK 膨胀由「实测合并字节超限 → 按网格占比缩预算重试（≤4 次，只裁行不裁列）」兜底；0 行都放不下时明确报「画布已满」而不是静默少贴
  - 标题去重 `uniqueGridTitle`：两条 SQL 同读一表时派生名相同，追加标题自动加序号（`Query: t (2)`），只认标题字号（20）的文本元素，单元格文本不占命名空间
  - 对话框复用 modal 样式：`document/list` 按后端序（lastOpened 倒序）默认选中最近一张；选中即 `document/get` 载入原始存储场景（顺带 bump lastOpened，与打开行为一致）；摘要行如实展示合并结果（行数 × 列数 + 超限省略警告），损坏文档禁用
  - 持久化复用 `persistImportedScene`（hash 引用的图片资产原样带过，不触发重上传）；零新权限、零 manifest 变更；单测 +11（placement/bounds/合并保序与信封/预算收缩/scene-full/标题去重）

---

### 0.4.0 真机验证清单（装上正式包逐条过）

- [ ] 标签标题：编辑器显示文档名，输入内容后出现「•」，保存后消失；Esc 撤销重命名草稿不污染标签
- [ ] 结果视图标签显示 SQL 派生名，不同查询开出的两个标签可区分
- [ ] 结果视图打开 → AI 面板出现 3 条结果推荐（zh/en 随宿主语言）；「计划上画布」/「Ask AI」成功后换成 2 条计划推荐
- [ ] 首页/普通文档面板无插件推荐；从首页直接打开计划文档 → 面板为 2 条计划推荐
- [ ] 多标签切换：回到结果标签时推荐自动恢复（visibilitychange 重播种）
- [ ] 旧宿主（无两项能力键）全部回退：标题静态贡献名、面板无插件推荐
- [ ] 推荐条点击后 AI 会话的上下文来源符合预期（宿主侧行为）

---

### 0.4.1 真机验证清单（装上正式包逐条过）

- [ ] 空白回归修复：结果视图/首页/编辑器各打开一次，全部正常渲染
- [ ] 追加主链路：结果集 1「创建画布」→ 结果集 2「贴到画布」选「追加到已有画布」→ 默认选中刚才那张 → 确认 → 编辑器打开，两表并排、标题带序号、互不遮挡
- [ ] 追加后自动保存正常；在追加结果上手工圈画 → 关闭重开内容完整
- [ ] 画布上有手绘内容时，追加表格落在所有内容右侧、顶部对齐，不重叠
- [ ] 三份以上结果集连续追加同一张画布，每次落在上一份右侧
- [ ] 边界面：空库（无图表）提示先创建；损坏文档禁选；接近 2MB 的目标画布如实展示「画布已满」或省略行数

---

## 1. 待办（按优先级）

### P1 —— 0.4.x 候选

- [ ] **T-A 结果画布全量重查**（`queryData`，Host API 1.4）
  - 做什么：`Sketch on canvas` 在 `capabilities.dataApi` 且用户授权后，用 `host.data:read` 重查完整结果集铺画布，消除 500 行快照截断；未授权/旧宿主走现路径零破坏；进阶：数据驱动图表（柱状/趋势）。
  - 前置：新权限 `host.data:read` → 触发权限三处同步 + catalog 相等门；逐连接授权对话框（用户可见同意面）；真机 ≥0.6.26。
  - 验收要点：`PLUGIN_DATA_ACCESS_NOT_GRANTED` 的降级路径；并发 ≤4、结果 ≤8 MiB 的失败面；SQL 只读分类器拒绝时的文案。

### P2 —— 需要决策或先做实验

- [ ] **引入 eslint-plugin-react-hooks**（hooks 顺序/依赖静态检查，防 Rules of Hooks 回归——0.4.0 空白回归即此类错误，单测无法捕获；CI 加一条 lint job 即可）

- [ ] **T-C 表结构上画布**（context-menu `menu:"table"` + 声明式 `action.open-workbench` + `getTableMetadata`）
  - 价值：形成"数据/计划/结构"三条上画布产品线，拼 ER 草图。
  - ~~前置决策：PRD 修订 R12 明确把"可视化数据库 schema"列为非目标~~ → **2026-10-03 重裁：有条件豁免**（裁定与条件见 `docs/PRD_V1_REVISIONS.md` §15）；剩余前置是权限三处同步 + 读宿主源码钉死 `contextMenu/table` 的 context 载荷形状（文档未写全）。
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
7. **桥限计量一律按 UTF-8 字节**（2026-10-03 审计结论）：宿主对每个 bridge request 的 **params 对象**做 `TextEncoder().encode(JSON.stringify(params)).byteLength ≤ 2 MiB` 校验（`pluginHostBridge.ts:582→1688`），按 UTF-16 `length` 计量对 CJK 内容会漏判（0.3.2 已修 AI context 一处）；`host.copy` 另有 2M 字符检查，但字节检查是更紧的约束（UTF-8 字节数恒 ≥ UTF-16 code unit 数）。现状：复制场景 JSON 按 request 信封**精确**预检——`host.copy` 的 params 恰为 `{ text }`，插件对 `JSON.stringify({ text: json })` 做 encode 即逐字节复刻宿主计量，仅留 4 KiB 常量余量；`saveScene` 不做插件侧预检——sidecar 本身按 2,000,000 字节拒收（`DOCUMENT_TOO_LARGE`），错误经 withCause 透传；512 KiB 分块与二进制转移路径（saveFile ≤512 MiB、fileTransfer ≤8 MiB）都是字节切片，天然安全。宿主附带发现：readImage 错误文案写 "18 MiB" 而常量是 24 MiB（`pluginHostBridge.ts:861`），下次触宿主时可顺手上报。
8. **错误透传守则**（2026-10-03 推广）：每个喂给 toast / notice / 状态条的 catch 必须走 `frontend/src/errors.ts` 的 `withCause`（`errorDetail` 用于无基语的地方；分隔符 " — "，双语排版中性）；包装错误把底层宿主错误挂 `cause`（如 `ClipboardError`）。错误 toast 停留 7s（`ERROR_TOAST_MS`，HomePage/EditorPage），info 保持 4s；结果视图的失败提示不自动消失。刻意静默的路径维持原样并注明理由：prefs 读写（写入失败不值得打断）、逐资产下载降级（占位图兜底）、SVG 字体离线注册（有隐藏 live region 上报）。

---

## 4. 版本线

| 版本 | 主题 | 状态 |
| --- | --- | --- |
| 0.3.0 | 计划上画布 + Ask AI + 另存为 + 深链 + prefs | 已发布 |
| 0.3.1 | 剪贴板整合（复制 JSON / 粘贴场景 / 粘贴截图） | 已发布（v0.3.1）；真机清单待过 |
| 0.3.2 | 结果视图 schema 透传（惰性，待宿主）+ 错误透传推广（withCause）+ 复制预检信封计量 | 已发布（v0.3.2，2026-10-03） |
| 0.4.0 | 标签页标题跟随 + AI 推荐提示词（T-B） | v0.4.0 资产因空白回归作废；**0.4.1（修复 + 追加到已有画布）待发布**；真机清单待过 |
| 0.4.x+（候选） | T-A queryData 全量重查 | 未开工 |
