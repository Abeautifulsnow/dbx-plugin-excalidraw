# DBX 插件系统能力与事件全谱

> 自动化审计产出：8 个维度并行勘察 → 每维度一个对抗式校验 agent 回到 `file:line` 逐条证伪 → 分章节撰写。共核验 609 条条目，0 条因无法证实被剔除，记录跨维度矛盾 54 处。锚点为相对宿主仓库根（`dbx`）的路径。
>
> 审计基准：DBX 宿主仓库工作区快照；`host_api` `1.2.0`，`protocol_version` `1`，`manifest_version` `1`。
>
> **2026-09-23 增量更新**：对照宿主仓库最新工作区（feature 分支 `7c9b37811`，含 `main`@`be741259a`，DBX 0.6.20 之后）复核并重映射了全部 `file:line` 锚点（基线 `e74257b6e`，2026-09-21 快照 → 最新，共重映射 650+ 处）。自基线以来的宿主侧语义变化有三处，已并入正文：① 新增 `host.ai` 权限与 `ai.openConversation` 桥接（内置 AI 面板的插件数据会话）；② `context-menu` 贡献点新增 `table` 菜单表面与表上下文载荷；③ 原生文件句柄 id 从 `u64` 改为 UUID 字符串。另有本插件仓库 0.2.3 的 plan-on-canvas 功能，使 plan API 有了首个端到端消费者。


## 1. 总览

DBX 插件系统是一套三层结构：**manifest 声明层**（`manifest.json`，v1 固定 `manifest_version: 1`）负责向宿主声明身份、`engines` 版本门槛、`permissions` 权限清单、`entrypoints` 入口与 `contributions` 贡献点；**前端 UI 层**由宿主把插件的 `ui/index.html` 连同资产内联后注入一个 `sandbox="allow-scripts"` 的 srcdoc iframe，并通过冻结的全局对象 `window.dbxPlugin` 暴露 Host API（`dbx/apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:621`、`dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:790`）；**后端 sidecar 层**是插件自带的原生进程，宿主与它之间走一行/一帧一条 JSON-RPC 2.0 消息的双向 stdio 协议，传输分 `stdio-jsonl` 与 `stdio-framed` 两种（`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:159`）。三层各自独立演进：贡献点是纯声明，UI 层只认 `workbench` 与 `result-view`，只有 `connection-provider`、`filesystem-provider`、`context-menu` 会把宿主请求真正送到 sidecar 上。

**锚点约定**：下文全部锚点为相对路径，基准是三个并列仓库的父目录 —— `dbx/…` 是宿主仓库（DBX 本体），`dbx-plugin-excalidraw/…` 是本插件仓库，`dbx-store/…` 是插件商店仓库。

| 东西 | 数量 | 明细 / 锚点 |
| --- | --- | --- |
| 本次审计已核验条目 | 609 | 8 个维度；跨维度矛盾 54 条，对抗式校验更正 4 条，被剔除 0 条 |
| 贡献点类型 | 5 | `connection-provider` / `workbench` / `filesystem-provider` / `context-menu` / `result-view`（`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:229`） |
| Host API 成员（`window.dbxPlugin`） | 30 | 5 个属性/getter（`ready`、`context`、`locale`、`theme`、`capabilities`）+ 16 个顶层方法 + 3 个子对象（`storage`、`fileTransfer`、`ai`）+ 4 个监听器（`onEvent`、`onBinary`、`onInit`、`onContext`）+ 2 个编解码助手（`encodeBase64`/`decodeBase64`）；展开子对象后共 34 个可调用端点（`dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:790-814`） |
| 宿主→插件 RPC 方法（manifest v1 路径） | 17 | `plugin/initialize`、`connection/test｜connect｜disconnect｜action`、`filesystem/list｜read｜write｜createDirectory｜delete｜rename`、`filesystem/download/open｜read｜close`、`contextMenu/<contributionId>`、`mcp/tools`、`mcp/call` |
| 宿主→插件 RPC 方法（legacy manifest v0 driver 家族） | 17 | `connect`、`testConnection`、`executeQuery`、`executeQueryPage`、`fetchQueryPage`、`closeQuerySession`、`getExplainInfo`、`getObjectSource`、`getColumns`、`listDatabases`、`listSchemas`、`listTables`、`connectionInfo`、`beginManualTransaction`、`executeInManualTransaction`、`commitManualTransaction`、`rollbackManualTransaction`；**v1 manifest 声明 `drivers` 会被直接拒绝**，因此当前 schema 下任何插件都用不了这一族（`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:802`） |
| 插件→宿主 RPC 方法（sidecar 侧） | 1 | `host/requestUserInput`（`dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:701`）；保留命名空间前缀 `host/`（`runtime.rs:29`） |
| 插件 UI→宿主 bridge 方法 | 24 | `backend.invoke｜notify｜sendBinary`、`ui.readAsset`、`host.getContext｜openWorkbench｜openFilesystem｜reopenConnection｜getPlanCapabilities｜explainPlan｜saveFile｜copy｜pickFiles｜readFileChunk｜beginFileSave｜writeFileChunk｜finishFileSave｜closeFileHandle｜storageGet｜storageSet｜storageDelete｜downloadFile｜cancelDownload｜ai.openConversation` |
| 事件（具名） | 17 个传输事件 + 6 个 `PluginEvent.method` 取值 | 插件相关 Tauri 事件 4 个（`dbx-plugin-event`、`dbx-plugin-binary`、`plugin-runtime-replaced`、`plugin-url-download-progress`）+ 相邻 Tauri 事件 6 个（`dbx-open-plugin-install-links`、`agent-install-progress`、`mcp-open-connection-workbench`、`ssh-prompt`、`ssh-prompt-dismiss`、`ssh-host-key-notice`）+ iframe 内 document CustomEvent 7 个（`dbx-plugin-init`、`-context`、`-env`、`-event`、`-binary`、`-filedrop`、`-dragstate`）；`PluginEvent.method` 取值 5 个已上线 + 1 个仅测试用。事件维度共 59 条已核验条目，其余条目描述背压/校验/状态机语义，不是独立事件 |
| 权限 | 8 种形态 | 7 个固定串 `host.events`、`host.binary`、`host.workbench`、`host.filesystem`、`host.plans:read`、`host.storage`、`host.ai`（`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:24-25`）+ 参数化 `host.network:https://<host>[:port]`；`host.network` 条目上限 8（`manifest.rs:29`） |
| Tauri 命令（插件相关） | 53 | `plugins.rs` 42（含 11 个 JDBC 家族命令）+ `plugin_file.rs` 4 + `plugin_storage.rs` 3 + `plugin_download.rs` 2 + `query.rs` 的 plan 命令 2 |
| CLI 子命令 | 5 | `create` / `package` / `dev` / `keygen` / `version`（`dbx/plugins/sdk/cli/src/lib.rs:327`） |
| 打包器模式 | 2 | `dbx-plugin-packager` 的打包与 `sign`（`dbx/plugins/sdk/packager/src/main.rs:74`） |
| SDK 公开面 | Rust 11 个公开类型 + 3 个自由函数；Go 4 类导出 | Rust：`PluginTransport`、`PluginMetadata`、`RequestContext`、`PluginError`、`PluginHandler`、`PluginEmitter`、`UserInputPrompt`、`UserInputOption`、`UserInputAnswer`、`HostClient`、`PluginServer`（`dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:25-471`）；Go：`Server`、`Handler`/`BinaryHandler`/`HandlerFunc`、`Emitter`、`DataDir` 系列（`dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go`） |
| 仓库内参考插件 | 2 | `io.dbx.excalidraw`（本仓库）与 `dbx.example.hello.connection` / `hello-workbench`（`dbx/plugins/examples/hello-workbench`） |
| 商店目录现状 | 17 个目录条目、16 条 publisher 记录 | 0 个 `verified: true`（`dbx-store/scripts/finalize-candidates.mjs:67`） |

数据密度上，8 个维度没有明显稀薄项（最少的 `permissions` 也有 56 条），但**读者对象不同会显著改变可验证性**：schema/协议/权限这三块源码锚点密实，而"某个能力有没有真实使用者"这一层，多处只能靠全仓 grep 的"零命中"来反证 —— 见第 11 节。

## 2. 清单文件与贡献点（Contribution Points）

本章的所有形状都来自 `plugins/manifest.schema.json`（声明侧权威）与 `crates/dbx-plugin-runtime/src/plugins/manifest.rs`（运行时镜像，含 schema 未表达的额外校验）。凡是「schema 允许但运行时拒绝」或「运行时允许但 schema 拒绝」的地方，都在各表下方单独标出；文末第 2.13 节汇总文档与代码不一致之处。

### 2.1 manifest 顶层字段与根级约束

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 根 `additionalProperties` | `false` | v1 拒绝未声明的顶层字段。Rust 解析器把未知字段收集进 `unknown_fields`，校验器对空集合以外的任何结果在 `manifest_version>=1` 时判为硬错误 | declarative | none | plugins/manifest.schema.json:6 |
| 根 `required` | `["manifest_version","id","name","version","publisher","engines"]` | 六个必填根字段；其余（`icon`、`description`、`source`、`homepage`、`permissions`、`entrypoints`、`contributions`、`localizations`）全部可选 | declarative | none | plugins/manifest.schema.json:7 |
| `$schema` | string（可选） | 可选 JSON-Schema URI，供编辑器/CI 校验。运行时解析后忽略、永不回写；catalog 的顶层字段列表完全没提它（由 verifier 补充） | declarative | none | plugins/manifest.schema.json:9 |
| `manifest_version` | `const 1`（整数，必填） | schema 版本鉴别字段，v1 必须为数字 `1`。运行时与 `SUPPORTED_PLUGIN_MANIFEST_VERSION` 比对，为 0 时告警 | declarative | none | plugins/manifest.schema.json:10 |
| `id` | `$ref #/$defs/identifier`，`maxLength 128`，`^[a-z0-9][a-z0-9._-]*$`（必填） | 全局稳定插件 id，小写字母/数字/`.`/`-`/`_`，首字符必须是字母或数字。运行时重新校验，违规即 compatibility 失败 | declarative | none | plugins/manifest.schema.json:60-62 |
| `name` | string，`minLength 1`（必填） | 默认显示名；运行时额外拒绝空白/纯空格名。可按 locale 用 `localizations[locale].name` 覆盖 | declarative | none | plugins/manifest.schema.json:12 |
| `icon` | `$ref #/$defs.assetPath`（可选） | 包内相对默认图标路径。宿主检查文件存在且扩展名受支持 | declarative | none | plugins/manifest.schema.json:13 |
| `version` | semver string，`^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$`（必填） | 包语义版本，运行时用 `semver::Version` 解析，非法即报错 | declarative | none | plugins/manifest.schema.json:14 |
| `publisher` | string，`minLength 1`（必填） | 发布者身份；运行时拒绝空/纯空格，且商店 catalog 必须与该值一致 | declarative | none | plugins/manifest.schema.json:15 |
| `description` | string（可选） | 自由文本描述，可用 `localizations[locale].description` 本地化 | declarative | none | plugins/manifest.schema.json:16 |
| `source` | string，`^https?://[^\s]+$`（可选） | 源码仓库 URL，在已安装插件详情中展示 | declarative | none | plugins/manifest.schema.json:17 |
| `homepage` | string，`^https?://[^\s]+$`（可选） | 项目/文档/支持 URL | declarative | none | plugins/manifest.schema.json:18 |
| `engines` | `{ dbx?: string, host_api: string }`（必填） | 兼容性声明对象，必须含 `host_api`；Rust 侧 `PluginEngines` 为 `deny_unknown_fields` | declarative | none | plugins/manifest.schema.json:22 |
| `engines.host_api` | string，`minLength 1`（必填） | 插件所需的 Host API 语义版本范围，用 `semver::VersionReq` 对宿主公布版本校验，不可满足即硬兼容错误 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:16 |
| `engines.dbx` | string，semver `VersionReq`（可选） | 可选的 DBX 应用版本范围；空串表示不约束 | declarative | none | plugins/manifest.schema.json:24 |
| `permissions` | array，`uniqueItems`，items 为枚举或 `host.network:https://<host>[:port]` | 最小能力声明列表，见 2.2 | declarative | n/a（声明权限本身） | plugins/manifest.schema.json:33 |
| `entrypoints` | `{ backend?: backendEntrypoint, ui?: uiEntrypoint }`（可选，`additionalProperties false`） | UI 与原生 sidecar 入口对象，两个成员都可缺席 | declarative | none | plugins/manifest.schema.json:38 |
| `contributions` | array，`type` 判别联合，五个变体 | 声明式扩展点，见 2.4 起 | declarative | none | plugins/manifest.schema.json:49 |
| `localizations` | `map<localeTag, {...}>` | 本地化映射，见 2.12 | declarative | none | plugins/manifest.schema.json:54 |
| legacy v0 字段 | `protocol_version: u32`、`executable: string`、`drivers: { id, label, kind, database_type? }[]` | 仅旧版 JDBC 清单可读。v1 清单若同时声明其中任一即硬兼容错误 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:802 |

关键校验与坑：

- `id` 的锚点行号需更正：`plugins/manifest.schema.json:59` 只是 `"identifier": {`，引用的 `type`/`maxLength`/`pattern` 成员实际在 60-62 行。内容结论不变。
- 同一 `identifier` 规则还约束 contribution id、provider id、`database_type`、form-field key、action id 与 picker 的 `content_field`；`valid_identifier` 另拒绝空串与超过 128 字符。
- `version` 之外，安装器还拒绝重复的 `(id, version)` 安装：installer.rs:526。
- `engines.dbx` 与 `host_api` 之外没有第三个成员（`additionalProperties:false`），运行时见 manifest.rs:817-827。
- 当前宿主公布的 Host API 版本是 `1.2.0`；若已安装版本为空串则跳过该检查（manifest.rs:1019-1021，#9595）。
- `icon` 由 `validate_declared_icon`（manifest.rs:1428-1450）校验：文件必须存在于包内，扩展名限 svg/png/jpg/jpeg/gif/webp/ico。
- 未知顶层键只有 v1 才硬拒绝（manifest.rs:789-794）；v0 清单容忍它们。
- legacy 的 `executable` 仍被 `backend_entrypoint()` 回退使用（manifest.rs:746-755），且 installer.rs:471-472 对 `.dbxp` 包拒绝 `manifest_version 0`。

### 2.2 permissions 枚举与运行时闸门

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| permission 枚举值 | `host.events` \| `host.binary` \| `host.workbench` \| `host.filesystem` \| `host.plans:read` \| `host.storage` \| `host.ai`，外加参数化的 `host.network:https://<host>[:<port>]` | 恰好接受这七个字符串加网络形态 | n/a | 上列全部 | crates/dbx-plugin-runtime/src/plugins/manifest.rs:24 |
| `manifest.permissions` | array，`uniqueItems`，items 为上述枚举或 `^host\.network:https://[A-Za-z0-9._-]+(:[0-9]+)?$` | 最小能力列表。运行时 `SUPPORTED_PLUGIN_PERMISSIONS` 为 `[host.events, host.binary, host.workbench, host.filesystem, host.plans:read, host.storage, host.ai]` 加 https-only 网络 origin | declarative | n/a（声明权限本身） | plugins/manifest.schema.json:33 |
| 运行时权限闸门 | `fn ensure_permission(plugin, permission: Option<&str>) -> Result<(), String>`；`permission` 为 `None` 时提前返回 `Ok(())`；拒绝时错误文案 `Plugin '<id>' has not declared permission '<p>'` | Host API 调用按清单权限列表逐项放行，未声明即报错 | n/a | 任一已声明 Host API 权限 | crates/dbx-plugin-runtime/src/plugins/host.rs:814 |

关键校验与坑：

- 权限闸门的函数名**需更正**：catalog 写作 `require_permission`，实际函数是 `ensure_permission`，签名为 `Option<&str>` 且对 `None` 提前返回 `Ok(())`；调用点在 host.rs:158、171、184。证据行与引用原文本身正确。
- `parse_host_network_permission`（manifest.rs:42-60）拒绝 http、路径、query、fragment、通配符与非数字端口。
- 网络权限 origin 数量上限 `MAX_PLUGIN_NETWORK_ORIGINS = 8`（manifest.rs:29、848-853）；数组内重复项被拒绝。
- `stdio-framed` transport 需要 `host.binary` 权限。**更正**：原文接着写"与 Rust SDK；Go SDK 只实现 JSONL"，这半句是错的——Go SDK 同样实现 framed：`dbxpluginsdk.NewServer(metadata, handler).WithTransport(TransportFramed|TransportJSONLines)`，常量 `TransportJSONLines` / `TransportFramed` 与 `frameHeaderBytes = 5` 都在，读写两条路径也都在。本仓库 vendored 的副本就是现成反例：`backend/third_party/dbx-plugin-sdk/sdk.go:19,24-25,90,125,140,198,252`。两种 transport 两个 SDK 都支持，差异在别处，见 §4.2 与 §4.16。

### 2.3 entrypoints

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `entrypoints.backend` | `{ protocol_versions?: int[] (minItems 1, uniqueItems, >=1, 默认 [1]), transport?: "stdio-jsonl"\|"stdio-framed", executable: assetPath }`，`required: ["executable"]` | 原生 sidecar 声明，`executable` 是唯一必填成员 | declarative | none | plugins/manifest.schema.json:77 |
| `entrypoints.backend.transport` | enum：`stdio-jsonl` \| `stdio-framed`；默认 `stdio-jsonl` | 线路分帧方式；`stdio-framed` 启用二进制通道 | declarative | none（使用 framed 通道需声明 `host.binary`） | plugins/manifest.schema.json:85 |
| `entrypoints.ui` | `{ root?: string (minLength 1), entry: string (minLength 1) }`，`required: ["entry"]` | 沙箱化 workbench 入口：根目录 + HTML/JS 入口文件，均包内相对且做路径安全校验 | declarative | none | plugins/manifest.schema.json:92 |

关键校验与坑：

- 运行时拒绝未声明协议版本 1 的 backend（manifest.rs:866-871）、缺失的 `executable` 文件，以及任何逃逸出包的路径。
- Windows 上同名的 `.bat` 会优先于无扩展名启动器（manifest.rs:967-982）。
- `ui.root` 默认取 `entry` 的父目录（manifest.rs:889-895）；`entry` 必须被 `root` 包含，否则兼容失败（manifest.rs:906-908）。
- `entrypoints.ui` 被 `workbench` 与 `result-view` 贡献点强制要求。

### 2.4 contributions 总览

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `manifest.contributions` | `type` 判别联合的五个变体：`connection-provider`、`workbench`、`filesystem-provider`、`context-menu`、`result-view` | v1 的声明式扩展点全集 | declarative | none | plugins/manifest.schema.json:49 |
| 兼容性门 | `PluginCompatibility { compatible, errors[], warnings[], target, backend_executable?, ui_entry?, ui_root? }` | `manifest.compatibility()` 重查 `manifest_version`、`id`、`name`、semver `version`、`publisher`、`engines`、`permissions`、`localizations`、`icon`、入口包含关系与贡献点引用；任一错误使插件不兼容并隐藏其全部贡献点 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:815 |

关键校验与坑：

- `contributions` 无 `minItems`/`maxItems`；但 contribution id 必须在所有类型间全局唯一（manifest.rs:1057-1061）。
- Rust 枚举为 `#[serde(tag = "type", rename_all = "kebab-case")]`。
- 贡献点的入口门禁：`workbench` 与 `result-view` 需要 `ui`；`context-menu` 与 `filesystem-provider` 需要 backend；`connection-provider` 的 `capabilities`/`actions` 需要 backend。

### 2.5 connection-provider

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `connection-provider` | `{ type:"connection-provider", id, label?, icon?, database_type, description?, fields[], workbench?, filesystem_provider?, capabilities?, proxy_route?, actions? }`，`required: ["type","id","database_type","fields"]` | 声明一种保存型非 SQL 连接类型：DBX 负责渲染表单并托管生命周期，插件实现 test/connect/disconnect/action RPC | declarative | 声明本身 none；操作需插件自身字段绑定与（对操作而言）backend 入口 | plugins/manifest.schema.json:271 |
| `connection-provider.fields` | formField 数组（schema 必填） | 有序的连接表单字段，宿主负责渲染与校验 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:556 |
| `connection-provider.database_type` | identifier（`maxLength 128`，`^[a-z0-9][a-z0-9._-]*$`） | 插件自定义连接类型 id，存入 `ConnectionConfig.plugin_connection_type`；不是 DBX 内置数据库枚举的扩展 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:1072 |
| `connection-provider` 的 `label` / `icon` / `description` | `label?: string (minLength 1)`、`icon?: assetPath`、`description?: string` | 展示元数据。此处 `label` 可选（而 workbench/context-menu/result-view/filesystem-provider 中必填） | declarative | none | crates/dbx-plugin-runtime/src/plugins/host.rs:222 |
| `connection-provider.capabilities` | array，`uniqueItems`，items enum：`test` \| `connect` \| `disconnect` | 声明 provider 实现哪些生命周期 RPC：`connection/test`、`connection/connect`、`connection/disconnect` | declarative | none（声明任一 capability 需要 backend 入口） | plugins/manifest.schema.json:285 |
| `connection-provider.proxy_route` | boolean，默认 `false` | 多端点协议（如 Kafka `advertised.listeners`）的 opt-in：DBX 交付 SOCKS5 路由而非单端点静态隧道 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:572 |
| `connection-provider.workbench` | identifier，指向同 manifest 内某 `workbench` 贡献点 id | 把保存的连接绑定到连接时打开的 workbench；悬空引用是兼容错误 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:1190 |
| `connection-provider.filesystem_provider` | identifier，指向同 manifest 内某 `filesystem-provider` 贡献点 id | 把连接绑定到文件系统 provider，连接时打开 DBX 通用文件管理器而非插件 workbench；悬空引用是硬错误 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:1194 |
| `connection-provider.actions[]`（`connectionAction`） | `{ id: identifier (必填), label: string (必填), description?, variant?, when?, close_on_success?: bool, requires_valid_form?: bool (默认 true), timeout_ms?: int 1..120000 }` | 在宿主自有的 Save / Save-and-connect 之前的额外对话框按钮，分派到 `connection/action` 并携带 `{ action: { id } }` | declarative | none（需要 backend 入口） | crates/dbx-plugin-runtime/src/plugins/manifest.rs:592 |
| `connectionAction.variant` | enum：`default` \| `outline` \| `secondary` \| `destructive` \| `ghost`（可选） | 自定义连接动作的按钮样式 | declarative | none | plugins/manifest.schema.json:299 |
| `connectionAction.when` | enum：`always` \| `create` \| `edit`（可选；缺席视为 `always`） | 动作出现在哪种对话框模式：始终、仅新建、仅编辑 | declarative | none | apps/desktop/src/lib/plugins/frontendPlugin.ts:142 |
| `connectionAction.close_on_success` | boolean，默认 `false` | 动作成功后关闭连接对话框 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:601 |
| `connectionAction.requires_valid_form` | boolean，默认 `true` | 是否要求表单完整才执行动作；`false` 允许表单不完整时执行自定义动作（DBX 仍校验已声明类型） | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:609 |
| `connectionAction.timeout_ms` | integer，`1..=120000`（可选） | 单动作 RPC 超时预算 | declarative | none | plugins/manifest.schema.json:303 |

关键校验与坑：

- `capabilities`/`actions` 需要 backend 入口；`disconnect` 而不声明 `connect` 会被拒绝（manifest.rs:1093-1100）；`capabilities` 内重复项同样是兼容错误。
- v1 包把它存为 `ConnectionConfig.db_type="plugin"`（frontendPlugin.ts:176）。
- 运行时门禁细节：未声明 `test` capability 时 `test` 返回合成的成功（host.rs:223-224）；`connect`/`disconnect` 决定是否拉起 sidecar 会话、以及句柄关闭时是否断开（host.rs:253-273）。
- `proxy_route` 为 true 且配置了传输层时，生命周期载荷携带 `runtime.proxy = { type:"socks5", host, port, username?, password? }` 而非静态转发（plugins/README.md:304-316）。
- `workbench` 与 `filesystem_provider` 的优先级：打开某 provider 的连接时，被引用的 workbench tab 优先于 `filesystem_provider`（queryStore.ts:3603-3606）；仅绑定 filesystem provider 时打开带 `root_uri` 的 DBX 文件管理器 tab（queryStore.ts:3625-3632）；quick-open 会隐藏已被某 provider 认领的 workbench（useQuickOpen.ts:500-508）。
- `actions[]` 校验见 manifest.rs:1203-1228（唯一有效 id、非空 label、timeout 1..=120000）。运行时以 `params.action = { id }` 调用 `connection/action`（host.rs:299-307），动作未声明即报错。
- `when` 的宿主行为：宿主自有动作 `test`/`save`/`save-and-connect` 是由 capabilities 与对话框模式合成的，不需要声明。
- `close_on_success` 只在宿主自身的测试路径被遵守：`if (testResult.value?.ok && action.close_on_success === true) open.value = false`（ConnectionDialog.vue:3904）。
- `timeout_ms` 的应用方式：`action.timeout_ms.map(Duration::from_millis).or(Some(PLUGIN_REQUEST_TIMEOUT))`（host.rs:313）。
- `connection-provider.fields` 存在 schema 与运行时的要求差异：运行时容忍省略 `fields` 数组（`#[serde(default)]`，manifest.rs:556），发布 schema 则要求它。字段 key 必须唯一且为合法 identifier（manifest.rs:1306-1310）。
- 展示元数据的锚点需更正：catalog 把 `provider_label` 解析行记在 `crates/dbx-plugin-runtime/src/plugins/manifest.rs:222`，该行实为 `PluginFormFieldLocalization` 的 serde 属性；真正解析在 `crates/dbx-plugin-runtime/src/plugins/host.rs:222`（manifest.rs 全文搜 `provider_label` 只命中 manifest.rs:1841 的一个测试函数名）。结论「`connection-provider.label` 可选并回退到插件名」仍然成立。解析顺序为 provider label/icon → 插件 name/icon → provider id（frontendPlugin.ts:279；plugins/README.md:213）。

### 2.6 workbench

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `workbench` | `{ type:"workbench", id: identifier, label: string, description?, icon?: assetPath }`，`required: ["type","id","label"]` | 注册一个沙箱化 workbench tab，可从侧边栏、插件中心、quick-open 或 `host.openWorkbench`（需 `host.workbench`）打开 | declarative | none | plugins/manifest.schema.json:309 |

关键校验与坑：

- 需要 `entrypoints.ui`；被某连接 provider 认领的 workbench 会从 quick-open 中隐藏（useQuickOpen.ts:500-508）。
- 插件 UI 通过 init 载荷的 `contributionId` 得知自己被哪个界面打开（pluginHostBridge.ts:243）。

### 2.7 filesystem-provider

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `filesystem-provider` | `{ type:"filesystem-provider", id, label, description?, icon?, schemes[], capabilities?, root_uri? }`，`required: ["type","id","label","schemes"]` | 注册由插件后端提供的虚拟文件系统；通用文件管理器 tab 由 DBX 托管 | declarative | 声明本身 none；UI 侧 `openFilesystem` 受 `host.filesystem` 门禁 | plugins/manifest.schema.json:346 |
| `filesystem-provider.schemes` | array，`minItems 1`，`uniqueItems`，items `^[a-z0-9][a-z0-9._:-]*$`（`maxLength 256`） | provider 服务的 URI scheme，例如 `["s3"]` 或 `["files"]` | declarative | none | plugins/manifest.schema.json:353 |
| `filesystem-provider.capabilities` | array，`uniqueItems`，items enum：`read` \| `write` \| `delete` \| `rename` \| `mkdir` | provider 实现哪些文件系统操作。`read` 驱动 list/read；其余映射 write/createDirectory/delete/rename | declarative | none | plugins/manifest.schema.json:358 |
| `filesystem-provider.root_uri` | string，`minLength 2`，`maxLength 4096`，`^[a-z0-9._-]+:.+$`（可选） | 虚拟文件系统起始 URI，例如 `s3://bucket/`；用作文件管理器的初始地址 | declarative | none | plugins/manifest.schema.json:354 |

关键校验与坑：

- 需要 backend 入口（manifest.rs:1182-1184）；其 `icon` 会同时用于连接与 DBX tab。
- 运行时拒绝空 `schemes` 数组，以及任何不满足 `valid_capability_name` 的 scheme（manifest.rs:1154-1163）；`root_uri` 的 scheme 必须是已声明 schemes 之一（manifest.rs:1171-1180）。
- `root_uri` 在 pattern 之外还有额外运行时检查：trim 后长度、`<=4096` 字符、无空白、scheme 必须属于已声明 schemes（manifest.rs:1171-1180）。
- 后端变更操作在未声明对应 capability 时被拒绝（plugins/README.md:501）；`capabilities` 内重复项是兼容错误（manifest.rs:1165-1170）。宿主文件管理器以 `has_capability(read)` 作为入口门禁（PluginFileManager.vue:40）。
- 六个 host→plugin 方法（由 verifier 补充，catalog 只用散文描述 capability 到操作的映射，既无方法名也无锚点）：

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| filesystem RPC 方法 | `PLUGIN_FILESYSTEM_LIST_METHOD="filesystem/list"`、`PLUGIN_FILESYSTEM_READ_METHOD="filesystem/read"`、`PLUGIN_FILESYSTEM_WRITE_METHOD="filesystem/write"`、`PLUGIN_FILESYSTEM_CREATE_DIRECTORY_METHOD="filesystem/createDirectory"`、`PLUGIN_FILESYSTEM_DELETE_METHOD="filesystem/delete"`、`PLUGIN_FILESYSTEM_RENAME_METHOD="filesystem/rename"` | filesystem-provider 后端必须实现的六个 host→plugin JSON-RPC 方法，各自受对应已声明 capability 门禁（见 `ensure_provider_capability`） | host->plugin | 清单权限列表内 none；由 provider capabilities 门禁 | crates/dbx-plugin-runtime/src/plugins/filesystem.rs:8 |
| `ensure_provider_capability` | `fn ensure_provider_capability(plugin_id: &str, provider: &PluginFilesystemProviderContribution, capability: PluginFilesystemCapability) -> Result<(), String>` | filesystem-provider.capabilities 的强制实现：除非 provider 声明了匹配 capability，每次后端文件系统调用都被拒绝。catalog 只引用 README 散文，从未引用这个强制函数 | n/a | none | crates/dbx-plugin-runtime/src/plugins/filesystem.rs:459 |

方法级细节：`filesystem/list` 映射到 read capability，`filesystem/read` 亦为 read；`write`/`createDirectory`/`delete`/`rename` 分别映射 write/mkdir/delete/rename。分页默认 200、上限 1000（filesystem.rs:14-15）；预览字节默认 256 KiB、上限 4 MiB（filesystem.rs:16-17）；内联写入上限 4 MiB（filesystem.rs:18）。请求/响应形状见 plugins/README.md:492-501。`ensure_provider_capability` 的调用点：filesystem.rs:187（Read）、222（Write）、247（Mkdir）、266（Delete）、287（Rename）；错误文案 `Filesystem provider '{plugin_id}/{provider_id}' does not declare {capability} capability`。

### 2.8 context-menu

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `context-menu` | `{ type:"context-menu", id, label, description?, icon?, menu: "connection" \| "table" }`，`required: ["type","id","label","menu"]` | 向连接或表上下文菜单加入一个原生渲染项 | declarative | none（需要 backend 入口） | plugins/manifest.schema.json:321 |
| `context-menu.menu` | `enum ["connection", "table"]`（schema 中必填） | 菜单项所属表面。v1 有两个表面：「已保存连接侧边栏菜单」与侧边栏树里的「表节点菜单」（Object Browser 集成不属于第一个表贡献表面） | declarative | none | plugins/manifest.schema.json:328 |

关键校验与坑：

- 需要 backend 入口（manifest.rs:1139-1141）。
- 点击时以 host→plugin 请求 `contextMenu/<contribution-id>` 分派：connection 项的载荷是非敏感连接摘要 `{ connection: { id, dbType, name, database } }`；table 项的载荷是 `{ table: { connectionId, database?, schema?, table } }`，`database`/`schema` 在所选数据库不暴露相应层级时省略（SidebarTreeRuntimeHost.vue:6749-6751；表上下文构造 `apps/desktop/src/lib/plugins/pluginContext.ts:14-38`）。两类载荷都只含对象标识，绝无凭据、连接串或原始连接配置。返回的 `message` 会变成 toast。
- 实现与文档不一致（已收窄）：Rust 以带 `#[serde(default)]` 的普通 `String` 存储它，再在贡献点校验里拒绝任何非 `connection`/`table` 的值（manifest.rs:1133-1138）；schema 已是 `enum ["connection","table"]`，TS 类型也已收紧为 `PluginContextMenuTarget = "connection" \| "table"`（types/database.ts:462、`:477`）。遗留差异只剩「schema 枚举 vs Rust 事后校验」：缺省 `menu` 的 manifest 能先通过 serde 解析、再在兼容性校验里失败。

### 2.9 result-view

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `result-view` | `{ type:"result-view", id, label, description?, icon? }`，`required: ["type","id","label"]` | 注册一个插件渲染的查询结果可视化，作为结果网格旁的工具栏按钮出现 | declarative | none | plugins/manifest.schema.json:334 |
| result-view 启动与上下文快照 | `context: { connectionId, database, sql, result: { columns, rows (<=500), truncated } }` | 选中某个 result view 会打开一个插件 tab，其 workbench 上下文携带一个有界结果快照；插件需向后端重新查询以获得完整数据 | host->ui | none | apps/desktop/src/components/layout/ContentArea.vue:1064 |

关键校验与坑：

- 需要 `entrypoints.ui`，但不需要 backend（manifest.rs:1126-1128）。
- 工具栏最多显示前 4 个已安装 view，且仅当存在结果时显示（QueryResultToolbarActions.vue:37）。
- 被打开的 contribution id 以 `contributionId` 出现在 `dbx-plugin-init/host` 消息里（pluginHostBridge.ts:243），因此一个 UI 入口可以为多个 result view 服务。
- 结果快照的 `rows` 上限为 500，并以 `truncated` 标记是否被截断。

### 2.10 formField（`connection-provider.fields[]` 的元素形状）

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `formField` 必填集 | `required: [key: identifier, label: string minLength 1, type: enum]`；可选：`description`、`placeholder`、`required: bool`、`default`、`options[]` | 最小字段形状。`default` 必须与 type 匹配（text-like 为 string、number、boolean），且 select/radio 的 default 必须是已声明 option 值之一 | declarative | none | plugins/manifest.schema.json:249 |
| `formField.type` | enum：`text` \| `password` \| `number` \| `boolean` \| `select` \| `radio` \| `textarea` | 字段控件类型。`select`/`radio` 要求非空 `options` 数组；其余类型禁止出现 `options` | declarative | none | plugins/manifest.schema.json:238 |
| `formField.binding` | enum：`config` \| `secret` \| `name` \| `host` \| `port` \| `username` \| `password` \| `database`（可选） | 赋予字段语义：`config` → `external_config`，`secret` → secret store，其余映射到标准 `ConnectionConfig` 列 | declarative | none | plugins/manifest.schema.json:244 |
| `formField.options_action` | string（返回 `{ options: [{ value, label }] }` 的插件 RPC 方法） | 把字段指向一个提供动态 select 选项的插件方法；宿主拉取后渲染为动态 select，并保留已声明 type 作为回退 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:283 |
| `formField.picker` | `{ kind: "file"\|"directory" (必填), accept?: string[] (maxItems 16, uniqueItems)，元素为 .ext 或 MIME, content_field?: identifier }` | 文本类字段上的本地文件动作：桌面端原生选择器（保存绝对路径），浏览器端把文件内容上传到兄弟字段 | declarative | none | plugins/manifest.schema.json:111 |
| `$defs.selectOption` | `{ label: string minLength 1 (必填), value: string (必填) }`，`additionalProperties false` | select/radio 字段 `options` 数组每个元素的形状：两个成员都必填且不允许额外键。catalog 只通过 formField 的 allOf 子句引用 options，从未写出该定义 | declarative | none | plugins/manifest.schema.json:98 |

关键校验与坑：

- `key` 必须是 identifier，且在 provider 内唯一；`label` 必须非空；option 的 label 非空且 value 唯一（manifest.rs:1336-1354）。
- 非法 default/type 组合是兼容错误（manifest.rs:1384-1406）；select/radio 的 default 必须出现在 `options` 中。
- `binding` 运行时规则：无 binding 的 password 字段默认按 `secret` 处理（manifest.rs:476-483）；`port` binding 要求 type 为 `number`；其余 binding 都要求字符串类字段类型；`config` 落到 `external_config`，`secret` 落到 `connection_secrets`（frontendPlugin.ts:206-227）。
- `options_action` 用 `deny_unknown_fields` 解析，且会被早于该特性引入版本的宿主拒绝（manifest.rs:280-282）；渲染/回退见 PluginConnectionFields.vue:101-135。
- `picker` 只允许出现在 text/password/textarea 上；`accept` 最多 16 个过滤器；`content_field` 必须是已声明的 text/password/textarea 兄弟字段且不能是声明字段自身；`directory` + `content_field` 组合被拒绝（manifest.rs:1232-1277）。桌面端存路径，浏览器端把内容写入 `content_field` 并清空路径（PluginConnectionFields.vue:198-260）。
- `$defs.selectOption` 的 Rust 镜像为 `PluginFormFieldOption { label: String, value: String }`，`deny_unknown_fields`（manifest.rs:510-515）；option value 必须唯一、label 非空（manifest.rs:1342-1349）。

### 2.11 条件代数与校验上限

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `visible_when` / `required_when` 叶子子句 | `{ field: identifier, one_of: (string\|boolean\|number)[] minItems 1 }`，`required: ["field","one_of"]` | 旧式单字段条件子句：另一个兄弟字段的值驱动本字段的可见性或必填性 | declarative | none | plugins/manifest.schema.json:180 |
| 条件代数：`all_of` / `any_of` / `not` | `{ all_of: condition[] minItems 1 }` \| `{ any_of: condition[] minItems 1 }` \| `{ not: condition }` | 复合条件节点，使 manifest 能表达如 `sudo_source = custom AND read_only = false` | declarative | none | plugins/manifest.schema.json:199 |
| 条件深度/节点上限 | `MAX_PLUGIN_FIELD_CONDITION_DEPTH = 8`、`MAX_PLUGIN_FIELD_CONDITION_NODES = 64`、`MAX_PLUGIN_PICKER_FILTERS = 16` | 条件表达式树最深 8 层、最多 64 个节点；picker 的 `accept` 列表最多 16 个过滤器。超过任一上限即校验失败 | declarative | none | crates/dbx-plugin-runtime/src/plugins/manifest.rs:32 |

关键校验与坑：

- 叶子只在被引用值非空、且其规范字符串形式等于 `one_of` 之一时匹配，因此 `false` 与 `"false"` 都能匹配布尔 false（manifest.rs:444-460）。
- 被引用字段必须存在于兄弟字段中（manifest.rs:1326-1333）；当被引用字段自身被隐藏时条件级联。
- 条件可任意嵌套；混用键（如同时给 `field` 与 `all_of`）或空节点会反序列化失败（manifest.rs:2617-2629）。
- 同一表达式树在对话框内与在 save/test/connect 校验中都参与求值。

### 2.12 localizations

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `manifest.localizations` | `map<localeTag, { name?, description?, contributions?: map<contributionId, { label?, description?, fields?, actions? }> }>`；键的 `propertyNames.pattern` 为 `^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$` | locale 映射（如 `en`、`zh-CN`），可覆盖插件 name/description 以及每个贡献点的 label、字段文案与选项 label。查找顺序：精确 locale → 基础语言 → manifest 默认值 | declarative | none | plugins/manifest.schema.json:54 |

关键校验与坑：

- locale 查找顺序实现在 frontendPlugin.ts:256-264。

### 2.13 共享 `$defs` 与路径安全

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `$defs.identifier` | string，`maxLength 128`，`^[a-z0-9][a-z0-9._-]*$` | 通用标识符；被 contribution id、provider id、`database_type`、form-field key、action id、picker `content_field` 共用 | declarative | none | plugins/manifest.schema.json:60-62 |
| `$defs.capability` | string，`maxLength 256`，`^[a-z0-9][a-z0-9._:-]*$` | filesystem scheme 共用的类型；注意 `:` 在此允许，而 `$defs.identifier` 不允许 | declarative | none | plugins/manifest.schema.json:64 |
| `$defs.assetPath` | string，`minLength 1`，无前导 `/`、无反斜杠、无 `.`/`..` 段、无 `//` | 每个声明路径（icon、picker 资源、`executable`、ui `root`/`entry`）都必须是无法逃逸插件目录的包内相对路径 | declarative | none | plugins/manifest.schema.json:72 |

关键校验与坑：

- `assetPath` 的锚点引用需更正：catalog 的 evidence 字符串在第一个负向前瞻里插入了一个多余空格（`(?!.*\\ )`），schema 中并不存在；schema 拒绝的是任意反斜杠，无尾随空格。更正后的正则为 `^(?!/)(?!.*\\)(?!.*(?:^\|/)\.\.?(?:/\|$))(?!.*//).+$`。
- `resolve_safe_plugin_path` 另外拒绝绝对路径以及 `ParentDir`/`RootDir`/`Prefix` 组件（manifest.rs:997-1009）。

### 2.14 文档与代码不一致汇总

- 锚点偏移：`$defs.identifier` 的 `type`/`maxLength`/`pattern` 在 `plugins/manifest.schema.json:60-62`，而非 catalog 所写的 59。
- 函数名错记：权限闸门是 `ensure_permission(plugin, permission: Option<&str>)`（`None` 提前返回 `Ok(())`），不是 `require_permission`；调用点在 host.rs:158、171、184。
- 证据文件错记：`connection-provider` 的 label 回退解析在 `crates/dbx-plugin-runtime/src/plugins/host.rs:222`；`manifest.rs:222` 是 `PluginFormFieldLocalization` 的 serde 属性，且 `provider_label` 在 manifest.rs 里只出现在 manifest.rs:1841 的测试函数名中。
- 正则非逐字：`$defs.assetPath` 的 evidence 多了一个空格（`(?!.*\\ )`），schema 实际拒绝任意反斜杠。
- schema 与运行时要求不一致（会踩坑）：`connection-provider.fields` 在运行时以 `#[serde(default)]` 容忍省略（manifest.rs:556），但发布 schema 将其列为必填；反向的不一致在 `context-menu.menu`（schema `enum ["connection","table"]`，Rust 用普通 `String` + 事后拒绝，缺省值能先解析、再在兼容校验里失败；TS 类型已收紧为 `PluginContextMenuTarget`，types/database.ts:462、`:477`）。
- catalog 缺失项（由 verifier 补充）：顶层 `$schema` 字段及其 Rust 形状（manifest.rs:64-65，`skip_serializing`，不回写）；`filesystem/list|read|write|createDirectory|delete|rename` 六个方法的常量与方法名（filesystem.rs:8 起，catalog 只有散文映射、无锚点）；`ensure_provider_capability` 这一强制函数（filesystem.rs:459，catalog 只引用 README 散文）；`$defs.selectOption` 定义（manifest.schema.json:98，catalog 只通过 formField 的 allOf 间接引用）。

## 3. Host API（window.dbxPlugin）

`window.dbxPlugin` 是插件 iframe 里唯一的宿主入口。它不是被 `import` 进来的模块，而是由 `pluginSdkSource()` 把 SDK 源码内联进 iframe 的 `srcdoc` 里执行后挂到全局的；整个对象 `Object.freeze`，`storage`、`fileTransfer` 与 `ai` 是同样冻结的子对象。宿主与插件之间的每一帧都走 `postMessage` 信封，双向都由 `source` + `version` + `type` 三个字段判定，任何一项不符即静默丢弃。本节按「信封 → 顶层对象 → 方法 → 监听器 → stream → storage → 文件 → 沙箱/CSP → 权限 → 宿主侧 RPC 与生命周期 → 数据形状 → 集成」的顺序展开，被对抗式校验更正的条目一律给出更正后的表述。

### 3.1 信封协议与协议常量

插件侧发帧用 `source: "dbx-plugin"`，宿主侧发帧用 `source: "dbx-host"`，两边都以 `version: 1` 严格等值比较，`type` 是判别字段。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `PLUGIN_MESSAGE_SOURCE` | `const PLUGIN_MESSAGE_SOURCE = "dbx-plugin"` | 插件 iframe 发往宿主的每一帧（request / ready / shortcut）必须带这个 source；宿主丢弃任何 `data.source` 不匹配的 window message。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:6 |
| `HOST_MESSAGE_SOURCE` | `const HOST_MESSAGE_SOURCE = "dbx-host"` | 宿主→插件帧（init / response / context / env / event / binary / filedrop / dragstate）的 source；注入的 SDK 丢弃 source 不等于该值的帧。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:7 |
| `BRIDGE_VERSION` | `const BRIDGE_VERSION = 1` | 双向每一帧都盖上的协议版本；宿主与 SDK 都用严格相等比较，因此未来的 version 2 会被旧对端静默忽略而不是被误解析。 | n/a | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:8 |
| postMessage 信封 | `{ source: "dbx-plugin"\|"dbx-host", version: 1, type: "ready"\|"shortcut"\|"request"\|"response"\|"init"\|"context"\|"env"\|"event"\|"binary"\|"filedrop"\|"dragstate", ...payload }` | 每一帧都是带 `source`/`version` 与判别字段 `type` 的普通对象。宿主侧 `handleWindowMessage` 只处理 `ready`/`shortcut`/`request`；SDK 只处理 `init`/`response`/`context`/`env`/`event`/`binary`/`filedrop`/`dragstate`，并且额外校验 `event.source === parent`。 | n/a | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:174 |
| `PluginRequestMessage` | `{ source: "dbx-plugin"; version: 1; type: "request"; id: string; method: string; params?: unknown; data?: ArrayBuffer }` | 宿主唯一接受的请求帧形状；`id` 会在匹配的 response 里原样回传，`data` 是可随消息 transfer 的 ArrayBuffer（零拷贝二进制）。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:137 |
| `validRequestMessage` | `typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128 && typeof value.method === "string" && value.method.length > 0 && value.method.length <= 128` | 请求 id 与方法名都必须是 1–128 字符；不满足的帧由 `handleWindowMessage` 返回 false 直接丢弃，且**不回响应**——插件的 Promise 会永远不 settle。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:915 |
| `requireProtocolName` | `/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/` | 守在所有进入后端、且由插件提供的标识符之前：backend 方法名、binary channel、`contributionId`/`providerId`/`connectionId`、download id。上限 256 字符，必须以字母数字开头（因此不允许前导 `/` 或 `.`）。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:924 |
| `MAX_BRIDGE_PAYLOAD_BYTES` | `2 * 1024 * 1024`（2 MiB JSON 字节数） | `enforcePayloadLimit` 用 `JSON.stringify` 序列化 `request.params`，UTF-8 字节数超过 2 MiB 就在任何 dispatch 之前整体拒绝请求。它同时是 `requireBase64` 的 base64 字符串长度上限（2 倍关系）和 `host.copy` 的字符上限。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:9 |
| `MAX_BRIDGE_BINARY_BYTES` | `8 * 1024 * 1024` | 适用于 `backend.sendBinary` 的 transfer（错误文案 "Plugin binary payload exceeds 8 MiB; chunk the transfer"）以及 `host.writeFileChunk`。与 Rust 文件注册表的 `MAX_CHUNK_BYTES` 对齐。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:10 |
| `MAX_BRIDGE_SAVE_BYTES` | `512 * 1024 * 1024` | 单次 `host.saveFile` 全部字节的上限。刻意与 sidecar 二进制上限不同：保存的文件从插件 iframe 直接落到磁盘，不经过插件帧。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:13 |
| `PLUGIN_SAVE_CHUNK_BYTES` | `1024 * 1024`（1 MiB） | 宿主在 `fileTransfer.beginSave` 里以 `chunkBytes` 字段通告的分片大小；1 MiB 经 base64 膨胀后仍低于 2 MiB 桥载荷上限。Rust 注册表以 `SAVE_CHUNK_BYTES` 通告同一数值。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:80 |
| `requireTimeout` | `Math.min(120_000, Math.max(1, Math.round(value)))` | 校验是有限数后把 `backend.invoke` 的 `timeoutMs` 夹到 1..120000 ms；`timeoutMs` 可选，`undefined` 表示使用后端默认值。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:930 |
| `requireSafeAssetPath` | 拒绝以 `"/"` 开头、或含空段 / `"."` / `".."` 段的值 | 仅用于 `ui.readAsset` 的 path；剩余路径由后端在插件自己的 ui 根目录内解析。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:1035 |
| file-handle 校验 | `requireHandleId`：非空 string 且 <= 128 字符；`requireOffset`：有限数且 >= 0 后取整；`requireChunkLength`：有限数且 > 0，再夹到 `min(8 MiB, floor)` | `fileTransfer.read`/`write`/`finish`/`cancel` 参数的边界，在抵达原生注册表之前施加。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:998 |
| 下载并发守卫 | `if (this.downloads.size >= 2 \|\| this.downloads.has(downloadId)) throw new Error("Too many active downloads or duplicate download ID")` | 每个 bridge 最多两个并发的 `host.downloadFile` 流，且 `downloadId` 不得与在飞的那个碰撞；该 id 同时也是取消的作用域单位（由测试 "scopes cancellation" 覆盖）。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:319 |
| `MAX_PLUGIN_WORKBENCH_CONTEXT_BYTES` | `2 * 1024 * 1024` | `snapshotPluginWorkbenchContext` 拒绝 JSON 序列化超过 2 MiB 的 context，并在快照被存储或发送之前就拒绝非有限数、非 plain prototype、循环引用与非 JSON 值。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginData.ts:3 |
| `closeTab` 快捷帧 | `{ source: 'dbx-plugin', version: 1, type: 'shortcut', shortcut: 'closeTab' }` | SDK 的捕获阶段 keydown 处理器在 Cmd/Ctrl+W（排除 alt/shift/输入法合成中）上，先 `preventDefault` + `stopPropagation` 再发出。宿主以 `api.closeTab()` 响应，进而发出关标签页事件。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:908 |
| `toPlain` | `(value) => structuredClone(value)`，失败则 `JSON.parse(JSON.stringify(value))` | 插件 UI 常把 Vue 响应式 Proxy 直接交给 `invoke()`；`postMessage` 无法结构化克隆 Proxy（WebKit 报 "The object can not be cloned."），因此 SDK 对每个出站的 `params` 先克隆或 JSON 往返。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:715 |
| 未知方法失败模式 | `throw new Error(\`Unsupported plugin host method '${method}'\`)` | bridge 不认识的任何 `host.*` 名字都会以带 error 字符串的 response 作答；SDK 侧表现为 rejected promise（`Error(message)`）。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:497 |

> 更正（`PluginRequestMessage`）：原审计描述里「`init` 用于 sidecar 的一次性握手」不成立。`init` 是 host->plugin 的**帧类型**，不是请求方法；sidecar 的一次性握手方法是 `plugin/initialize`，bridge 里根本不存在名为 `init` 的请求方法。

### 3.2 顶层对象与访问器

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `window.dbxPlugin` | `Object.freeze({ ready, context, locale, theme, capabilities, downloadFile, cancelDownload, request, ai, invoke, stream, notify, sendBinary, readAsset, readAssetUrl, openWorkbench, openFilesystem, reopenConnection, getPlanCapabilities, explainPlan, saveFile, copy, storage, fileTransfer, onEvent, onBinary, onContext, onInit, decodeBase64, encodeBase64 })` | 沙箱文档暴露的单个全局对象；由 `pluginSdkSource()` 内联进 iframe `srcdoc`，从不 import。整体冻结，`storage`、`fileTransfer` 与 `ai` 为冻结子对象。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:790 |
| `dbxPlugin.ready` | `ready: Promise<PluginWorkbenchContext>` | 在 `type:"init"` 帧到达时 resolve 为 init context；若宿主永不初始化，则该 Promise 在整个文档生命期内 pending。文档定位为插件应用逻辑的入口闸门。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:791 |
| `dbxPlugin.context` | `get context(): PluginWorkbenchContext \| undefined` | 实时 workbench context；init 之前为 `undefined`。由 `type:"context"` 帧原地更新，因此插件 UI 状态能在宿主导航中存活。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:792 |
| `dbxPlugin.locale` | `get locale(): string` | 当前 DBX 语言（如 `"en"`、`"zh-CN"`）；由 init 帧初始化，并由 `type:"env"` 帧刷新，不重载 iframe。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:793 |
| `dbxPlugin.theme` | `get theme(): PluginBridgeTheme \| undefined`，即 `{ appearance: "light"\|"dark", tokens: Record<string,string>, editor?: PluginEditorAppearance }` | 宿主最后推送的主题；`applyTheme` 同时把 `data-dbx-theme`、`style.colorScheme` 和每个 `--token` 写到 `document.documentElement` 上，CSS 与 JS 保持同步。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:794 |
| `dbxPlugin.capabilities` | `get capabilities(): { downloadFile: boolean; planApi: boolean; storage: boolean; ai: boolean }` | 取自 init 帧的增量能力通告，init 之前为 `{}`。文档要求插件以它做 gate 而不是探测方法是否存在（更旧的宿主会整个省略该键；`ai` 键是最后加入的，同样按「缺键即不支持」处理）。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:795 |
| `dbxPlugin.encodeBase64` / `decodeBase64` | `decodeBase64(value: string) => Uint8Array`；`encodeBase64(value: Uint8Array \| ArrayLike<number>) => string` | 本地 base64 辅助函数（基于 `atob`/`btoa`），插件不必自带；它们永不触达宿主。 | n/a | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:855 |

### 3.3 方法参考

下表的「权限」列是该方法在宿主 bridge 侧实际施加的 manifest 权限门槛；没有门槛的写 `none`。注意 `none` 不等于无限制——尺寸上限与用户交互闸门见各行说明。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbxPlugin.request` | `(method: string, params?: unknown, options?: { transfer?: ArrayBuffer }) => Promise<unknown>` | 直通线缆的逃生口：分配单调递增的字符串 id、保存 pending resolver、把 Vue 响应式 params 过一遍 `toPlain()`，再 post `{source, version, type:'request', id, method, params}`。`options.transfer` 随消息转移一个 ArrayBuffer。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:799 |
| `dbxPlugin.invoke` | `(method: string, params?: unknown, options?: { timeoutMs?: number }) => Promise<T>`，实现为 `request('backend.invoke', { method, params, timeoutMs })` | 调用插件自己声明的 sidecar RPC 方法；不需 manifest 权限（方法本身属于插件）。宿主把 `timeoutMs` 夹到 120s 并把调用重绑到所属 plugin id。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:800 |
| `dbxPlugin.notify` | `(method: string, params?: unknown) => Promise<void>`，实现为 `request('backend.notify', { method, params })` | 单向通知插件 sidecar；无需权限，也不返回业务结果。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:802 |
| `dbxPlugin.sendBinary` | `(channel: string, data: string \| ArrayBuffer \| Uint8Array) => Promise<void>` | 字符串输入以 `params.dataBase64` 发送；类型化输入作为 ArrayBuffer 随消息 transfer。宿主侧要求 `host.binary`，且每帧上限 8 MiB。 | plugin->host | `host.binary` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:803 |
| `dbxPlugin.readAsset` | `(path: string) => Promise<PluginUiAssetPayload>`，即 `{ contentType, dataBase64, etag }` | 经 `ui.readAsset` 读取插件包内相对其 ui 根目录的资源；path 必须相对且不含 `..` 段。无需 manifest 权限。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:808 |
| `dbxPlugin.readAssetUrl` | `(path: string) => Promise<string>`（`blob:` object URL） | `readAsset` 之后 `URL.createObjectURL(new Blob([...], { type: asset.contentType }))`；撤销 URL 的责任在调用方。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:809 |
| `dbxPlugin.openWorkbench` | `(contributionId: string, childContext?: PluginWorkbenchContext, options?: { forceNew?: boolean }) => Promise<void>`，实现为 `request('host.openWorkbench', { contributionId, context: childContext, forceNew })` | 在新的宿主标签页里打开插件自己声明的某个 workbench 贡献点，并传入子 context。需要 `host.workbench`；宿主通过 `findUiContribution` 解析贡献点，`forceNew` 跳过标签页复用。 | plugin->host | `host.workbench` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:813 |
| `dbxPlugin.openFilesystem` | `(providerId: string, childContext?: PluginWorkbenchContext) => Promise<void>`，实现为 `request('host.openFilesystem', { providerId, context: childContext })` | 为插件声明的某个 filesystem provider 打开宿主文件管理器。需要 `host.filesystem`。 | plugin->host | `host.filesystem` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:814 |
| `dbxPlugin.reopenConnection` | `(connectionId: string) => Promise<{ ok: true }>`，实现为 `request('host.reopenConnection', { connectionId })` | 用户显式触发的、走完整宿主流程的插件连接重连（允许交互式密码提示）。值得注意的是它**不受任何 manifest 权限门控**，bridge 只要求宿主提供了实现。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:815 |
| `dbxPlugin.getPlanCapabilities` | `(connectionId: string) => Promise<PluginPlanCapabilities>` | 单个连接只读的预估执行计划能力元数据（`{ dbType, dbVersion?, supports.estimatedPlan, limits }`）；宿主只读已存连接配置，绝不发起连接。需要 `host.plans:read`。 | plugin->host | `host.plans:read` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:818 |
| `dbxPlugin.explainPlan` | `(planRequest: { connectionId, database?, schema?, sql, mode: "estimated", timeoutMs? }) => Promise<PluginPlanResult>` | 为调用方提供的 SQL 获取预估执行计划；EXPLAIN 语句、连接与超时都由宿主掌控，`mode` 必须是字面量 `"estimated"`。需要 `host.plans:read`。 | plugin->host | `host.plans:read` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:819 |
| `dbxPlugin.saveFile` | `(options?: { fileName?, contentType? }, data?: string \| ArrayBuffer \| Uint8Array) => Promise<{ path: string } \| null>` | 把字节交给宿主，由宿主跑原生保存对话框与磁盘写；之所以需要它，是因为沙箱 iframe 无法自行触发下载。类型化数据零拷贝 transfer，字符串数据走 `options.dataBase64`，不传 data 则只发 options。用户取消时 resolve `null`。无 manifest 权限。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:820 |
| `dbxPlugin.copy` | `(text: string) => Promise<{ success: true }>` | 代沙箱把文本写入系统剪贴板；要求非空文本，且上限为 `MAX_BRIDGE_PAYLOAD_BYTES` 个字符。无 manifest 权限。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:826 |
| `dbxPlugin.downloadFile` / `cancelDownload` | `downloadFile(options) => Promise<{ path: string } \| null>`；`cancelDownload(downloadId: string) => Promise<null>` | 桌面端专有的流式下载：把远程源经原生保存对话框落盘，由后端的 download channel 驱动；进度以 `host.download.progress` 事件到达。需要 Tauri 宿主实现。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:796 |

> 更正（`downloadFile`）：原描述「仅当 `capabilities.downloadFile` 为 true 时才通告」不准确。SDK 始终在 `window.dbxPlugin` 上定义 `downloadFile` 与 `cancelDownload`；**只有 capability 标志是条件计算的**（由 `!!api.downloadFile` 得出）。因此必须 gate 在 `capabilities.downloadFile` 上，而不是探测方法是否存在——同一个 catalog 里的 `invoke`/`saveFile` 条目表述是正确的，此处原先的措辞自相矛盾。

### 3.4 监听器（SDK 注册的全部种类）

所有监听器都返回取消订阅闭包。回调注册进 `listeners` 的对应集合（`event` / `binary` / `init` / `context` / `dragstate`），SDK 收到相应帧类型时遍历触发。

| 名称 | 签名/取值 | 触发时机与说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbxPlugin.onEvent` | `(listener: (message) => void) => () => void` | 注册进 `listeners.event`。触发于：后端转发的事件（`type:"event"`）、env 推送（`type:"env"` 复用同一集合）、下载进度、以及 `stream()` 的 chunk/end/error 帧。后端事件转发需要 `host.events` 权限。 | host->plugin | `host.events` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:851 |
| `dbxPlugin.onBinary` | `(listener: (payload: { channel: string; data: Uint8Array }) => void) => () => void` | 接收 `type:"binary"` 帧；宿主以原始 ArrayBuffer 零拷贝 transfer，SDK 包成 `Uint8Array`。转发需要 manifest 上的 `host.binary`。 | host->plugin | `host.binary` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:890 |
| `dbxPlugin.onInit` | `(listener: (context: PluginWorkbenchContext) => void) => () => void` | 每个 init 帧都触发；若 context 已经到达，注册时会**立即**以当前 context 调用一次，因此晚注册不会漏掉初始化。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:854 |
| `dbxPlugin.onContext` | `(listener: (context: PluginWorkbenchContext) => void) => () => void` | 在 `type:"context"` 帧触发，即宿主导航推来新 context 而不重载 iframe。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:853 |
| `dbxPlugin.fileTransfer.onDragState` / `onDrop` | `onDragState(listener: (active: boolean) => void)`；`onDrop(listener: (files: PluginFileHandleMeta[]) => void)` | 操作系统级拖拽状态，以及拖放到本 workbench 区域的文件所对应的、**已经打开**的 handle；分别由宿主的 webview 级 drop 管线发出 `type:"dragstate"` 与 `type:"filedrop"` 帧驱动。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:848 |
| 插件文档 CustomEvents | `'dbx-plugin-init' \| 'dbx-plugin-context' \| 'dbx-plugin-env' \| 'dbx-plugin-event' \| 'dbx-plugin-binary' \| 'dbx-plugin-filedrop' \| 'dbx-plugin-dragstate'` | 每一帧同时会被重新派发为 `document` 上的 `CustomEvent`（刻意不是 `window`：监听方 `onHostThemeChange` 注册在 document 上，裸 window 派发会被静默丢失）。这是给纯 HTML 插件的第二个、无需监听器 API 的集成面。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:876 |

与拖放相衔接的宿主侧事件：`dbx:tauri-file-drop` 是在 `document` 上派发的 webview 级 OS 拖放管线事件，`new CustomEvent("dbx:tauri-file-drop", { detail: { type: "enter"|"over"|"drop"|"leave", paths?: string[], position?: { x: number; y: number } }, cancelable: true })`。Tauri 交给宿主页面的是文件**路径**；带真实文件的 HTML5 drop 事件根本到不了 web 内容，插件 iframe 更是如此。`PluginWorkbenchHost` 认领那些 dpr 换算后的 CSS 坐标落在自己 iframe 上的拖放、`preventDefault` 掉宿主的「作为数据库打开」回退，再把路径变成读 handle 以 `type:"filedrop"` 投递（apps/desktop/src/composables/useFileDrop.ts:50；消费方 apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:561）。

### 3.5 `stream()` 辅助

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbxPlugin.stream` | `(method: string, params?: object, options?: { streamId?: string; closeMethod?: string; timeoutMs?: number }) => Promise<{ stream: ReadableStream<Uint8Array>; metadata: object }>` | 包装 sidecar 的分块传输 RPC：生成 `streamId`（优先 `crypto.randomUUID`，回退 `'stream-<ms>-<seq>'`），发 `backend.invoke` 并带上 `{ ...params, streamId }`，再挂一个事件监听器，只接受 `host.stream.chunk` / `host.stream.end` / `host.stream.error` 三个方法名且 `params.streamId` 匹配的帧。`chunk` 做 base64 解码后 enqueue；`end` 把事件并入 `metadata` 并 close；`error` 拒绝尚未兑现的 Promise 并 error 掉 controller。 | plugin->host | `host.events` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:740 |
| stream 事件名三元组 | `'host.stream.chunk' \| 'host.stream.end' \| 'host.stream.error'` | 这是 stream 辅助唯一响应的三个方法；它们以普通 `type:"event"` 帧（method + params）到达，所以插件**必须**声明 `host.events`，宿主才会转发它们。`chunk` 携带 `params.dataBase64`，`error` 携带 `params.message`。 | host->plugin | `host.events` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:752 |
| stream close/cancel 语义 | `ReadableStream.cancel()` → `request('backend.invoke', { method: closeMethod, params: { streamId } })` | `closeMethod` 默认 `'filesystem/stream/close'`。取消时先移除事件监听器，再至多触发一次 close RPC（由 `closeRequested` 守卫），并吞掉它的 rejection；默认的后端 close 方法在其他任何地方都不会被调用。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:784 |

### 3.6 `storage` 子对象

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbxPlugin.storage` | `Object.freeze({ get: (key) => request('host.storageGet', { key }), set: (key, value) => request('host.storageSet', { key, value: value === undefined ? null : value }), delete: (key) => request('host.storageDelete', { key }) })` | 每插件持久化的键值存储；`set` 把 `undefined` 归一为 `null`，`get` 对未设置的键 resolve `null`。三个方法都要求 `host.storage`，并且应当再用 `capabilities.storage` 做 gate。 | plugin->host | `host.storage` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:829 |
| `host.storageGet` / `host.storageSet` / `host.storageDelete` | `storageGet { key } → unknown \| null`；`storageSet { key, value } → null`；`storageDelete { key } → null` | 三者都要求 `host.storage`。`storageSet` 在到达宿主之前先用 `JSON.stringify` 序列化 value，使原生与 web 两套实现施加同一个逐值上限；key 必须非空、<= 256 字符且不含控制字符。 | plugin->host | `host.storage` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:471 |
| 原生存储命令与上限 | `plugin_ui_storage_get/set/delete(pluginId, key[, value])` → `plugin-data/<id>/ui-storage.json`；`MAX_PLUGIN_STORAGE_VALUE_BYTES` 256 KiB，`MAX_PLUGIN_STORAGE_TOTAL_BYTES` 1 MiB，`MAX_PLUGIN_STORAGE_KEYS` 1024，key <= 256 字符 | JSON 支撑的每插件存储，带串行化锁，因此两个 workbench 标签页不会丢更新；存储文件损坏时先被挪到 `.corrupt` 再重新开始。 | plugin->host | `host.storage` | src-tauri/src/commands/plugin_storage.rs:30 |
| web 端存储回退 | `storage*` → 非 Tauri 时用 `localStorage`，键形如 `dbx-plugin-storage:<plugin>:<key>` | 宿主在 web 上也提供存储实现；`PluginHostBridgeApi` 里这几个成员是可选的。 | n/a | n/a | apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:388 |

### 3.6b `ai` 子对象（2026-09-22 新增）

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbxPlugin.ai.openConversation` | `ai: Object.freeze({ openConversation: (options) => request('host.ai.openConversation', options) })`；`options = { title, prompt, context, send? } → Promise<null>` | 打开内置 DBX AI 面板里的一条「插件数据会话」：宿主把 `context` 快照（经 workbench context 同一套深拷贝/清洗）连同 `pluginId`/`pluginName`/`title`/`capturedAt` 存进会话历史，`prompt` 作为首问；`send` 缺省 `false`，为 `true` 时立即开始分析。入参校验：`title` 非空且 ≤200 字符、`prompt` 非空且 ≤32000 字符、`context` 必须是普通对象、`send` 必须是布尔。数据流是单向的——插件拿不到任何模型输出、模型配置或 SQL 执行权，AI 面板的系统提示词也明确「快照内容是数据不是指令」。 | plugin->host | `host.ai` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:799（SDK 成员）、`apps/desktop/src/lib/ai/aiPluginConversation.ts:19-31`（校验与快照） |
| `host.ai.openConversation` | `{ title, prompt, context, send? } → null` | 上一行的宿主分派路径：先 `requirePermission("host.ai")`，宿主没提供 `openAiConversation` 实现时抛 "DBX AI conversation panel is unavailable"。可用性由 init 帧的 `capabilities.ai` 宣告，插件应先 gate 再调用。 | plugin->host | `host.ai` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:337-343 |

### 3.7 文件相关 API

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbxPlugin.fileTransfer.pick` / `read` | `pick: (options?: { multiple?: boolean }) => Promise<{ files: PluginFileHandleMeta[] }>`；`read: (handleId, offset, length?) => Promise<{ dataBase64, length, eof }>` | 原生打开对话框，随后对已打开的 handle 做顺序分块读；handle 只可能来自用户同意（对话框或系统拖放），绝不会来自插件提供的路径。无 manifest 权限。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:835 |
| `dbxPlugin.fileTransfer.beginSave` / `write` / `finish` / `cancel` | `beginSave(options?) => { handleId, chunkBytes } \| null`；`write(handleId, offset, data) => { written, nextOffset }`；`finish(handleId) => void`；`cancel(handleId) => void` | 分块写路径：原生保存对话框打开写 handle，分片流入（二进制 transfer 或 base64 字符串），`finish` 冲刷并关闭，`cancel` 丢弃 handle。`write()` 在 transfer 前把一个 `Uint8Array` 视图的**可见区间**复制进独立 buffer，因此视图外的字节永不外发。无 manifest 权限。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:843 |
| `host.saveFile` | `{ fileName?, contentType?, dataBase64? }` 或 transfer 的 ArrayBuffer → `api.saveFile(pluginId, { fileName, contentType }, bytes) → { path } \| null` | 字节上限 512 MiB，直通宿主的原生对话框 + 写盘；用户取消时 resolve `null`。无 manifest 权限（用户的保存对话框就是同意闸门）。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:411 |
| `host.pickFiles` / `host.readFileChunk` | `pickFiles { multiple?: boolean } → { files: PluginFileHandleMeta[] }`；`readFileChunk { handleId, offset, length? } → { dataBase64, length, eof }` | 原生打开对话框之后流式读；源码注释记录了它与 `host.saveFile` 处于同一信任级别——字节只在用户选完文件后才流动，因此刻意不设 manifest 权限门。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:427 |
| `host.beginFileSave` / `host.writeFileChunk` / `host.finishFileSave` / `host.closeFileHandle` | `beginFileSave { name?, contentType?, size? } → { handleId, chunkBytes } \| null`；`writeFileChunk { handleId, offset, dataBase64? \| transferred } → { written, nextOffset }`；`finishFileSave { handleId } → null`；`closeFileHandle { handleId } → null` | 含显式取消的分块写路径。被取消的 `beginFileSave` resolve `null`（与文档契约一致），返回的 `chunkBytes` 即 `PLUGIN_SAVE_CHUNK_BYTES`（1 MiB）。无 manifest 权限。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:447 |
| `host.downloadFile` / `host.cancelDownload` | `downloadFile { downloadId, fileName?, params } → { path } \| null`；`cancelDownload { downloadId } → null` | 经桌面宿主把远程源流式落盘（`api.downloadFile` 缺失时抛 "Streaming file downloads require the desktop host"），过程中发 `host.download.progress` 事件。每个 bridge 最多 2 个并发；取消只影响本 bridge 拥有的 `downloadId`。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:316 |
| `host.download.progress` | `type:"event"`, `method: "host.download.progress"`, `params: <progress payload>` | 在 `host.downloadFile` 调用内部由原生下载 channel 的 `onProgress` 直接 post 出的普通事件帧。与 `forwardEvent` 驱动的事件不同，它是**直接 post** 的，所以即使没有 `host.events` 权限也能到达插件。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:324 |
| 原生 file-handle 注册表 | `plugin_file_open(pluginId, path, write)` / `plugin_file_read(pluginId, handleId, offset, length)` / `plugin_file_write(pluginId, handleId, offset, dataBase64)` / `plugin_file_close(pluginId, handleId)`；`MAX_CHUNK_BYTES` 8 MiB，`SAVE_CHUNK_BYTES` 1 MiB，`MAX_OPEN_HANDLES` 64 | handle 归插件所有：每个操作都带调用方 plugin id，不匹配就拒绝，因此插件无法枚举别人的 handle。workbench 宿主在卸载时回收读与写 handle，因为泄漏的 fd 会烧掉共享的 64 个 handle 配额。 | plugin->host | none | src-tauri/src/commands/plugin_file.rs:32 |
| `safeFileName` | `safeFileName(value?: string) => string`：只取 basename；剥离 `[\u0000-\u001f<>:"\|?*]`；空串 / `'.'` / `'..'` → `"download.bin"` | 在 `host.saveFile` 抵达原生保存对话框之前对插件提供的 `fileName` 运行，插件因此无法把路径分隔符或穿越塞进对话框的默认路径。也用于 `beginFileSave` 的默认名。这是插件的字符串与对话框 `defaultPath` 之间唯一的防线。 | plugin->host | none | apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:417 |
| Tauri 下载命令 | `invoke('download_plugin_file', { pluginId, downloadId, fileName, params, onProgress: Channel }) → string \| null`；`invoke('cancel_plugin_download', { pluginId, downloadId })` | `host.downloadFile` / `host.cancelDownload` 背后的桌面实现；进度回调走 Tauri Channel，`fileName` 缺失时默认 `download.bin`。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginFileDownload.ts:7 |
| 桌面回调装配 | `downloadFile: isTauriRuntime() ? downloadPluginFile : undefined`；`saveFile` → `savePluginFile`；`pickFiles` → `pickPluginFiles`；`storage*` → 非 Tauri 时 `localStorage` 回退 | web 宿主仍然提供 pick/read/write/storage 实现（顶层 document 的 file input、内存中的保存缓冲、`dbx-plugin-storage:<plugin>:<key>` 下的 localStorage），唯独把原生下载流留成 `undefined`——这正是 `capabilities.downloadFile` 所报告的内容。 | n/a | n/a | apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:388 |

> 更正（原生 file-handle 注册表，2026-09-23 起二次更正）：审计时的描述是「map 键类型是 `u64`，取值来自 uuid v4 的前 8 字节」。宿主随后把句柄 id 改成了**端到端的 UUID 字符串**（注册表键 `HashMap<String, OpenFile>`、`PluginFileHandle.handle_id: String`，与 `downloadId` 同一约定）——起因是 JS 层把 id 当 double 解析，`u64` 超过 `Number.MAX_SAFE_INTEGER` 时静默丢精度，导致每个 bridge 读写都报 "unknown plugin file handle"。workbench 宿主侧的 `t<uuid>` 前缀句柄也同步改为不透明字符串，且绝不经过 `Number()`（`apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:88-95`）。

### 3.8 沙箱文档、CSP 与样式

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `pluginSandboxDocument` | `(html, permissions?, theme?, options?: { baseUrl? }) => string` | 按顺序注入：CSP meta、可选的 `<base>`、uiKit 样式表、boot-theme 样式、然后是 SDK 脚本——注入到第一个 `<head>` 或合成出来的 document 里。CSP 为 `default-src 'none'`；`script-src 'unsafe-inline' blob:`（+ asset source）；`style-src 'unsafe-inline' blob:`；img/font/media 来自 `data:`/`blob:`/asset；`connect-src` 取自声明的 origin，没有就写 `'none'`。 | host->plugin | n/a | apps/desktop/src/lib/plugins/pluginHostBridge.ts:550 |
| `pluginAssetCspSource` | `dbx-plugin://` baseUrl → `" dbx-plugin:"`；`http(s)://dbx-plugin.localhost` baseUrl → `" <exact origin>"`；其他一律 `""`（同时抑制 `<base>`） | 只有这两种 dbx-plugin 形状会放宽 script/style/img/font/media 的来源；`javascript:` 或任意 origin 的 baseUrl 会被忽略，规范断言此时 CSP 保持不动且不注入 `<base>`。 | declarative | n/a | apps/desktop/src/lib/plugins/pluginHostBridge.ts:576 |
| `pluginNetworkOrigins` | `(permissions) => string[]`：解析 `host.network:https://host[:port]`，去重，最多 8 条 | 把 `host.network` 权限变成 CSP `connect-src` 的 origin：正则 `^https://[A-Za-z0-9._-]+(:[0-9]+)?$`，最多 8 条，所有非 https 或带 path 的条目被**静默丢弃**。必须与 Rust 的 `parse_host_network_permission` 保持一致。 | declarative | `host.network:<origin>` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:527 |
| `pluginBootThemeCss` | `(theme?) => ":root{color-scheme: dark\|light; --token: value; ...}" \| ""` | 预绘制主题种子，避免深色宿主上第一帧是白的。只输出名字匹配 `^--[a-z0-9-]+$`、且值是不含 `"` `{` `}` `<` `>` `;` 的字符串的 token，因此 token 值无法从 style 元素里逃逸；它注入在 uiKit 之后，从而在层叠中胜出。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:596 |
| `pluginUiKitCss` | `() => string`，覆盖 `.dbx-card`、`.dbx-section-title`、`.dbx-btn(--primary/--danger/--ghost)`、`.dbx-label`、`.dbx-input`/`.dbx-select`/`.dbx-textarea`、`.dbx-hint`、`.dbx-row`、`.dbx-table`、`.dbx-badge`、`.dbx-link` | 完全建立在宿主推送的 DBX 设计 token 之上，因此插件 UI 跟随明暗与调色板变化而不需要任何插件侧逻辑；类名清单与文档中的 kit 一致。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:608 |
| 沙箱 iframe 姿态 | `<iframe :srcdoc="source" sandbox="allow-scripts" allow="clipboard-write" referrerpolicy="no-referrer" />` | 插件文档只拿到 `allow-scripts`（不含 same-origin、不含 forms、不含 downloads），不透明 origin，没有 Tauri 对象，也没有父级 DOM 访问权；尽管 `host.copy` 才是受支持的路径，仍委派了 clipboard-write。 | host->ui | n/a | apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:621 |
| `pluginUiBaseUrl` | `(pluginId, entryDirectory) => string \| undefined`：http(s) 宿主页（WebView2）上是 `${location.protocol}//dbx-plugin.localhost/<id>/<dir>/`，否则 `dbx-plugin://localhost/<id>/<dir>/`；web 宿主上为 `undefined` | 选择喂给 `pluginSandboxDocument` 的 `<base href>` origin，好让插件的代码分割 chunk 与 CSS `url()` 引用能在运行时解析；所选形状同时决定 CSP 的 asset source。wry 在 WKWebView/webkit2gtk 上原生服务自定义 scheme，在 WebView2 上则映射为 http 子域，因此由宿主页自身的协议来选择形态。`!isTauriRuntime()` 时返回 `undefined`，web 宿主既没有 `<base>` 也没有放宽的 CSP。 | host->plugin | none | apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:507 |
| `inlineLocalUiAssets` | `inlineLocalUiAssets(html, pluginId) => Promise<{ html: string; entryDirectory: string }>` | srcdoc 构建之前，宿主改写插件的 `index.html`：每个同包的 `<script src>` 与 `<link rel="stylesheet" href>` 都经 `api.readPluginUiAsset` 取出并替换成内联的 `<script>`/`<style>`。入口脚本所在目录成为惰性 chunk 的 `<base>`。绝对地址、`blob:`/`data:`/协议相对 URL 以及任何含 `..` 段的路径都被 `localUiAssetPath` 跳过。与 `pluginUiBaseUrl` 配对：内联让入口自包含，`<base>` 让动态 import 可达。 | host->plugin | none | apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:471 |
| `dbx-plugin` asset 协议 | `dbx-plugin://localhost/<plugin-id>/<asset-path>`（WebView2 上映射为 `http://dbx-plugin.localhost/<plugin-id>/<asset-path>`）；仅 GET/HEAD | 在运行时服务惰性加载的插件 UI chunk 与字体，主机名固定，因此 CSP 只需要一个常量 origin；plugin id 必须是 <= 200 字符的 `[A-Za-z0-9.-]` 且首尾不能是点，穿越校验在注册表里对**解码后**的路径组件执行。 | host->plugin | none | src-tauri/src/plugin_ui_protocol.rs:18 |
| `readPluginUiEntry` / `readPluginUiAsset` | `readPluginUiEntry(pluginId) => Promise<PluginUiAssetPayload>`（web 上 `GET /api/plugins/<id>/ui`）；`readPluginUiAsset(pluginId, path) => Promise<PluginUiAssetPayload>`（`GET /api/plugins/<id>/ui/<percent-encoded path>`） | workbench 宿主在构建沙箱文档之前取得插件 UI 入口点与需要内联的 script/style 资源的方式。路径段逐个百分号编码；桌面端同名的是 Tauri command 包装（apps/desktop/src/lib/backend/tauri.ts:2554 与 :2501）。返回的 `PluginUiAssetPayload` 是 `{ contentType, dataBase64, etag }`（apps/desktop/src/types/database.ts:668）。 | n/a | none | apps/desktop/src/lib/backend/http.ts:693 |

### 3.9 权限模型

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| bridge 接受的 manifest 权限串 | `host.events \| host.binary \| host.workbench \| host.filesystem \| host.plans:read \| host.storage \| host.ai \| host.network:https://<host>[:port]` | 前端 bridge 与 manifest schema 认识的完整枚举。未知字符串会在 Rust 的 `SUPPORTED_PLUGIN_PERMISSIONS` 校验中失败；网络权限必须是严格 https，可带一个数字端口，不能带 path。 | declarative | n/a | plugins/manifest.schema.json:33 |
| `hasPermission` / `requirePermission` | `hasPermission(p) => (plugin.manifest.permissions \|\| []).includes(p)`；`requirePermission(p)` 抛出 `Plugin has not declared permission '${p}'` | bridge 里每一处权限门都是对拥有该 bridge 实例的插件的 manifest 数组做朴素成员判断——没有按次授权，也没有用户提示。 | declarative | n/a | apps/desktop/src/lib/plugins/pluginHostBridge.ts:505 |
| host API 版本下限 | `engines.host_api: string`（semver 要求）；`SUPPORTED_PLUGIN_HOST_API_VERSION = "1.2.0"` | Manifest v1 插件必须声明 `engines.host_api`；plan API 作为 Host API 1.2 落地，所以离不开它的插件声明 `^1.2`，而运行时检查仍是 `capabilities.planApi`。值是作为 semver 要求对宿主版本校验的。 | declarative | n/a | crates/dbx-plugin-runtime/src/plugins/manifest.rs:16 |

按方法汇总的权限要求（无门槛即 `none`）：`request`/`invoke`/`notify`/`ready`/`context`/`locale`/`theme`/`capabilities`/`readAsset`/`readAssetUrl`/`saveFile`/`copy`/`reopenConnection`/`downloadFile`/`cancelDownload`/`fileTransfer.*`/`onInit`/`onContext`/`onDragState`/`onDrop`/`encodeBase64`/`decodeBase64` 均为 `none`；`sendBinary` 与 `onBinary` 需要 `host.binary`；`stream` 与 `onEvent` 需要 `host.events`；`openWorkbench` 需要 `host.workbench`；`openFilesystem` 需要 `host.filesystem`；`getPlanCapabilities` 与 `explainPlan` 需要 `host.plans:read`；`storage.get/set/delete` 需要 `host.storage`；`ai.openConversation` 需要 `host.ai`。

### 3.10 宿主侧 RPC 方法与生命周期帧

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `backend.invoke` | `{ method, params?, timeoutMs? }` → `api.invokePlugin(pluginId, method, params, timeoutMs)` | 把插件 UI 调用转发到插件自己的 sidecar，并把所属 plugin id 重绑上去，因此一个插件永远够不到另一个插件的后端。无 manifest 权限。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:348 |
| `backend.notify` | `{ method, params? }` → `api.notifyPlugin(pluginId, method, params) → null` | 发往插件 sidecar 的 fire-and-forget 通知；成功时总是 resolve `null`。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:352 |
| `backend.sendBinary` | `{ channel, dataBase64? }`（或 transfer 的 ArrayBuffer）→ `api.sendPluginBinary(pluginId, channel, dataBase64)` | 进入 sidecar 分帧传输层的二进制帧。需要 `host.binary`；transfer 的 buffer 上限 8 MiB，base64 字符串必须匹配 base64 字符集。 | plugin->host | `host.binary` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:356 |
| `ui.readAsset` | `{ path }` → `api.readPluginUiAsset(pluginId, path) → PluginUiAssetPayload` | 从插件自己的包里读打包的 UI 资源；path 由 `requireSafeAssetPath` 校验。无 manifest 权限。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:369 |
| `host.getContext` | `{ }` → `snapshotPluginWorkbenchContext(this.context)` | 拉取当前 workbench context 的全新深快照；快照每次调用都重新克隆，因此插件无法经由返回对象改写宿主状态。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:343 |
| `host.openWorkbench` | `{ contributionId, context?, forceNew? }` → `api.openWorkbench(...) → null` | 需要 `host.workbench`；宿主只接受插件自己声明的 id（标签页通过 `findUiContribution` 解析它们）。 | plugin->host | `host.workbench` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:372 |
| `host.openFilesystem` | `{ providerId, context? }` → `api.openFilesystem(...) → null` | 需要 `host.filesystem`；为插件声明的某个 filesystem provider 打开宿主操作的文件管理器。 | plugin->host | `host.filesystem` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:385 |
| `host.reopenConnection` | `{ connectionId }` → `api.reopenConnection(pluginId, connectionId) → { ok: true }` | 插件连接的完整交互式重连；bridge 在此**不施加**任何 manifest 权限门。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:378 |
| `host.getPlanCapabilities` / `host.explainPlan` | `getPlanCapabilities { connectionId }`；`explainPlan { connectionId, sql, mode: "estimated", database?, schema?, timeoutMs? }` | 两者都要求 `host.plans:read`。`explainPlan` 在 bridge 里再做一次校验：`mode` 必须是字面量 `"estimated"`，`sql` 非空且 <= 200_000 字符，标识符 trim 后 <= 256 字符，`timeoutMs` 预先夹到 `MAX_PLUGIN_PLAN_TIMEOUT_MS`（60s）——不符的一律拒绝，而不是转发后再降级。 | plugin->host | `host.plans:read` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:957 |
| `host.copy` | `{ text }` → `api.copyText(pluginId, text) → { success: true }` | 之所以必需，是因为沙箱 iframe 是不透明 origin，其中所有脚本化复制路径都被拒绝；text 必须非空且 <= 2 MiB 字符。 | plugin->host | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:420 |
| init 帧载荷 | `{ source, version, type: "init", pluginId, contributionId, locale, theme?, permissions: string[], capabilities: { downloadFile, planApi, storage, ai }, context }` | 唯一携带插件身份、已声明权限与能力四元组的帧。`permissions` 是 manifest 数组的拷贝，`capabilities` 由宿主实际提供了哪些 bridge 函数（downloadFile/planApi/storage/ai）实时算出。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:249 |
| init 生成与重新初始化握手 | `requestInit(signal: "load" \| "ready")`，配合 `initSignals { load, ready }` 与 `initGeneration` 计数器；每一代 load 的 init 之前都会 await `onReinit` | 宿主用 `initStarted` 让 init 在两个信号中**第一个**到达时就发出；「两个信号都到齐」这个谓词只用于检测**新的 load 代**（取消下载、清空 downloads、重置 `initStarted`）。单独的 `ready`（没有 load）本身就已经产生恰好一次 init。新一代 load 还会取消在飞的下载、清空 downloads 并使过期的 init 失效，而 `onReinit` 在全新 init 之前重新推送插件连接，好让 sidecar 能重连。 | host->plugin | none | apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:409 |
| context / locale / theme 更新帧 | `updateContext → {type:"context", context}`；`updateLocale → {type:"env", locale}`；`updateTheme → {type:"env", locale, theme}` | context 与 env 变更被推进已加载的插件 UI，而不是重建 iframe，因此插件状态能在宿主导航中存活；身份变化（plugin id/version、contribution id）仍会强制整体重载。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:278 |
| 插件后端事件订阅 | `subscribePluginEvents(onEvent, onBinary)` → 桌面端 `Tauri listen('dbx-plugin-event' \| 'dbx-plugin-binary')`，web 端 `EventSource('/api/plugins/events')` 且载荷为 `{kind: "event"\|"binary"\|"lagged"}` | 为已挂载的 workbench 供 `forwardEvent`/`forwardBinary`；这条共享流不是按插件切分的，所以 bridge 在转发到该插件 iframe 之前按 pluginId 过滤。 | host->ui | n/a | apps/desktop/src/lib/backend/http.ts:708 |
| `PluginHostBridgeApi` | `invoke, notify, sendBinary, readAsset, openWorkbench?, openFilesystem?, reopenConnection?, getPlanCapabilities?, explainPlan?, closeTab?, saveFile?, downloadFile?, cancelDownload?, copyText?, pickFiles?, readFileChunk?, beginFileSave?, writeFileChunk?, finishFileSave?, closeFileHandle?, storageGet?, storageSet?, storageDelete?` | bridge 背后的、与线缆无关的宿主契约；宿主省略某个可选成员会让对应方法以 "X is unavailable" 失败（对 downloads/plans 则是翻转 capability 标志）。桌面端实现在 `PluginWorkbenchHost.createBridge` 里装配。 | n/a | n/a | apps/desktop/src/lib/plugins/pluginHostBridge.ts:91 |

### 3.11 上下文、主题与计划结果的数据形状

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `PluginWorkbenchContext` | `{ connectionId?: string; database?: string; schema?: string; values?: Record<string, unknown>; [key: string]: unknown }` | 交给插件 UI 的、深快照的、纯 JSON 的 workbench context。不同宿主表面填充方式不同：侧边栏打开连接发的是 `{ connectionId, providerId, connectionType, workbenchId, connection{...} }`；查询结果工具栏发的是 `{ connectionId, database, sql, result: { columns, rows (<= 500), truncated } }`。 | host->plugin | none | apps/desktop/src/lib/plugins/pluginHostBridge.ts:34 |
| `openPluginResultView` | `openPluginResultView(pluginId, contributionId, label)` → `queryStore.openPluginWorkbench(pluginId, contributionId, { title, connectionId, database, context: { connectionId, database, sql, result: { columns, rows (<= 500), truncated } } })` | 查询结果工具栏启动插件 result-view 表面的路径。它交给插件的 context 就是文档化的有界快照契约：最多 500 行加一个 `truncated` 标志，插件被期望通过自己的后端重新查询，以获取完整或流式的数据集。这也是 `findUiContribution` 与 workbench 并列解析的表面（接线点在 ContentArea.vue:1927 与 :2191 的 `@open-result-view`）。 | host->plugin | n/a | apps/desktop/src/components/layout/ContentArea.vue:1063 |
| `PluginBridgeTheme` | `{ appearance: "light" \| "dark"; tokens: Record<string,string>; editor?: { fontFamily: string; fontSize: number; theme: string } }` | 只从宿主 document root 收集 `--color*`、`--radius*`、`--font*` 自定义属性（排除 `--dbx-*`）；`editor` 承载没有 CSS token 载体的 SQL 编辑器设置，设置在信息不全时整块省略。 | host->plugin | none | apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:353 |
| `PluginPlanResult` / `MAX_PLUGIN_PLAN_BYTES` | `PluginPlanResult = { dbType: string; dbVersion?: string; format: "json"\|"xml"\|"text"; rawPlan: unknown; truncated: boolean; warnings: string[] }`；`MAX_PLUGIN_PLAN_BYTES = 4 * 1024 * 1024` | `host.explainPlan` 的 resolve 值，以及宿主对 `rawPlan` 的全局上限（这是后端侧边界，前端**不**复查——bridge 只预夹 sql 字符数与 `timeoutMs`）。`warnings` 携带 `plan_not_json` / `plan_truncated` / `plan_rows_truncated`，插件据此得知宿主把文本计划降级或裁剪过（`PLUGIN_PLAN_WARNING` 在同文件 :33）。 | host->plugin | `host.plans:read` | apps/desktop/src/types/pluginPlan.ts:23 |

### 3.12 集成面与宿主实现差异

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `findUiContribution` / `PluginUiContribution` | `findUiContribution(pluginId, contributionId): PluginContributionEntry<PluginUiContribution> \| undefined`，只搜索 workbench + result-view | 决定某个插件标签页构建哪个 iframe（进而哪个 bridge）：workbench 与 result-view 两类贡献都通过插件的 UI 入口点渲染，而归属原生 context menu 或 filesystem provider 的 id 不是插件 UI 表面。 | n/a | n/a | apps/desktop/src/lib/plugins/frontendPlugin.ts:83 |
| `openWorkbench` 宿主处理器 | `PluginWorkbenchTab.openWorkbench(pluginId, contributionId, context?, options?)` → `queryStore.openPluginWorkbench({ title, context, forceNew })` | SDK `openWorkbench` 的宿主侧：经 `findWorkbench` 解析目标贡献（因此只有声明过的 workbench 才存在），当 context 带 `connectionId` 时用连接名作标签页标题，标签页复用交给 query store。 | plugin->host | `host.workbench` | apps/desktop/src/components/plugins/PluginWorkbenchTab.vue:96 |
| `openFilesystem` 宿主处理器 | `openFilesystem(pluginId, providerId, context?)` → `queryStore.openPluginFilesystem({ title, connectionId, rootUri, currentUri })` | 解析已声明的 filesystem provider，取 `root_uri` 以及可选的 `context.uri` 以恢复某个文件夹；provider 未声明时抛错。 | plugin->host | `host.filesystem` | apps/desktop/src/components/plugins/PluginWorkbenchTab.vue:110 |
| dev-host mock bridge | `installBridge(channel)`（plugins/sdk/dev-host/browser-bridge.mjs）：`window.dbxPlugin = Object.freeze({ ready, context, locale, theme, request, invoke, stream, notify, sendBinary, readAsset, readAssetUrl, openWorkbench, openFilesystem, reopenConnection, copy, storage, onContext, onEvent, onBinary, onInit, encodeBase64, decodeBase64 })` | `dbx-plugin dev` 往同一个沙箱注入自己的 SDK。它**缺少** `downloadFile`/`cancelDownload`/`saveFile`/`fileTransfer`/`getPlanCapabilities`/`explainPlan`/`ai.openConversation`（以及 whatwg fileTransfer），另加一个每页的 `channel` 字段要求帧回显，并以 200 ms 间隔重试 `type:"ready"` 直到 init，310 s 之后拒绝请求。 | host->plugin | none | plugins/sdk/dev-host/browser-bridge.mjs:14 |
| dev-host 权限门与上限 | `BRIDGE_LIMIT` 2 MiB，`UI_BINARY_LIMIT` 8 MiB，`STORAGE_VALUE_LIMIT` 256 KiB，`STORAGE_TOTAL_LIMIT` 1 MiB；`requirePermission(manifest, p)` 作用于 `host.binary` / `host.workbench` / `host.storage` | dev host 施加与生产相同的数值上限和相同的三个权限串，所以本地能过的插件应当也能过真实门槛；事件与二进制的广播同样按 `host.events`/`host.binary` 过滤。 | plugin->host | n/a | plugins/sdk/dev-host/server.mjs:21 |

### 3.13 数据稀薄与待补之处

- 本节的权限判定全部来自前端 bridge 的 `requirePermission` 调用点；Rust 侧对同一批权限串的二次校验只在 manifest 枚举条目上有证据（plugins/manifest.schema.json:33），没有逐方法的 Rust 证据。
- `MAX_PLUGIN_PLAN_BYTES`（4 MiB）被明确标注为后端侧边界、前端不复查——这是一个已知的执行分散点，评审时应按「前端只保证 sql 长度与 timeoutMs」来理解。
- dev-host 与生产 SDK 的方法集差异是本节唯一成体系的一致性风险来源，且其覆盖面（缺哪些方法、缺哪些能力）来自单条证据；若要把 dev-host 当作完整替身使用，需要另做一轮针对 `browser-bridge.mjs` 的逐方法核对。
- `host.reopenConnection` 无权限门控这一事实，在数据里只有一条证据（apps/desktop/src/lib/plugins/pluginHostBridge.ts:378），但它与 `dbxPlugin.reopenConnection` 条目的「不受 manifest 权限门控」互相印证。

## 4. 后端 RPC 协议

本章描述插件后端（sidecar）与 DBX 宿主之间的线协议。先建立一个前提：DBX 里同时存在**三条互不相同的协议**，它们的信封、方向与权限模型各不相同，混淆三者是插件开发中最常见的错误来源。

| 层 | 载体 | 谁发起 | 本章小节 |
| --- | --- | --- | --- |
| Sidecar wire | 子进程 stdin/stdout，`stdio-jsonl` 或 `stdio-framed` | 宿主调用插件为主；插件侧只有一个反向方法 | 4.1–4.8 |
| UI bridge | DBX 窗口与沙箱 iframe 之间的 `window.postMessage`，信封 `dbx-plugin` / `dbx-host` | 双向 | 4.9、4.13 |
| MCP / Driver | 复用 sidecar wire，但方法与超时自成一套 | 宿主 | 4.6 |

### 4.1 JSON-RPC 信封

宿主写出的信封只有两种：带 `id` 的请求（`PluginRequest`）与完全不带 `id` 的通知（`PluginNotification`）。两者都不做 camelCase 重命名，字段名原样是 `jsonrpc` / `id` / `driver` / `method` / `params`。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `PluginRequest` | `{ jsonrpc: "2.0", id: u64, driver?: string, method: string, params: Value }` | 宿主调用插件后端的唯一请求信封。`id` 是宿主自有的自增 `u64`（`AtomicU64::new(1)` 起）。`driver` 只在 driver 家族调用上出现，connection-provider / filesystem 调用上完全省略（`skip_serializing_if`） | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:137 |
| 序列化字段顺序 | `jsonrpc, id, driver, method, params` | 用 `serde_json::to_vec` 序列化，字段顺序即结构体声明顺序 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:137 |
| `PluginNotification` | `{ jsonrpc: "2.0", driver?: string, method: string, params: Value }`（**没有 `id` 字段**） | 由 `PluginSidecarSession::notify()` 写出，无 `id` 所以插件无法应答。发送前经过 `ensure_running()` 与 `validate_protocol_name(method)` 两道闸 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:147 |
| 通知的公开入口 | `PluginSidecarSession::notify` / `PluginHost::notify` | Tauri 与 web 命令走这两个入口，`required_permission = None` | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:323、dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:162 |
| 插件应答 | `{ jsonrpc: "2.0", id: u64, result }` 或 `{ jsonrpc: "2.0", id: u64, error: { message, ... } }` | 宿主按 `id.as_u64()` 路由到 oneshot sender。走 `error` 分支时**只取 `error.message`，`code` 被丢弃**；两者都没有则报 `response has neither result nor error` | plugin->host | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:993 |
| 未知/重复 `id` | 记日志 `ignored response for unknown request` 后丢弃 | 不会导致会话失败 | plugin->host | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:621 |
| `jsonrpc 2.0` 校验 | 非 legacy 插件每条入站 JSON 必须先满足 `value["jsonrpc"] == "2.0"`，否则 `Plugin '{id}' sent a message without jsonrpc 2.0` | 在任何路由之前检查；legacy 插件豁免 | plugin->host | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:612 |
| `validate_protocol_name` | 非空、长度 `<= 256`、每个字符为 ASCII 字母数字或 `. _ : / -` 之一 | 宿主侧对**出站**的每个 `invoke`/`notify` 方法名生效；非法名报 `Plugin protocol name is invalid`。**更正**：不能说它同时约束插件发来的每个方法名与二进制 channel — 入站二进制 channel 走的是 `validate_binary_channel`，两套文法不同（后者禁空白但允许前导 `.`，而 `validate_protocol_name` 拒绝前导 `.`） | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:1025 |
| `validate_binary_channel` | 长度 `1..=65535` 字节，不得含任何空白字符 | 出站 `send_binary` 与入站二进制帧共用这道闸，因此 channel 名不可能为空或含空格 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:1015 |
| `PluginEvent` | 插件发 `{ jsonrpc: "2.0", method: string, params?: any }`（无 `id`）；宿主向上暴露 `{ pluginId, method, params }`（camelCase） | 任何带 `method` 且没有可用 `id` 的入站消息都会变成 `PluginEvent`，进入每会话 256 容量的 broadcast 通道，再由 `PluginHost` 中继到 512 容量的通道。legacy 插件的事件即使带了字符串 `id` 也仍走这条路径，因为其 method 没有 `host/` 前缀 | plugin->host | `host.events`（仅 UI 消费时） | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:57 |

### 4.2 传输层：`stdio-jsonl` 与 `stdio-framed`

传输方式由 manifest 的 `entrypoints.backend.transport` 决定，宿主在会话启动时读一次并存在 session 上。`StdioJsonLines` 是 `#[default]`。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `stdio-jsonl` | 一行一个 JSON 值，LF 结尾；读侧先 `trim_ascii_whitespace` 再跳过空行 | 默认传输。写路径在 payload 后追加 `b'\n'`；读路径用 `read_limited_line` + 修剪空白。legacy（`manifest_version == 0`）插件会被 `Manifest::backend_entrypoint` 强制钉在这条传输上 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:510 |
| `stdio-framed` | `kind: u8 \| payload_length: u32 大端 \| payload` | 由 `entrypoints.backend.transport = "stdio-framed"` 选中。未知 `kind` 字节是**硬协议错误**（不是「当二进制处理」）。JSON 帧必须装进 `MAX_JSON_MESSAGE_BYTES`；任何非 JSON kind 按 `MAX_BINARY_MESSAGE_BYTES + 1024` 长度检查 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:52 |
| `FRAME_KIND_JSON` / `FRAME_KIND_BINARY` | `FRAME_KIND_JSON = 0`，`FRAME_KIND_BINARY = 1` | 帧头第一个字节 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:52 |
| 分配前长度检查 | `let maximum = if kind == FRAME_KIND_JSON { MAX_JSON_MESSAGE_BYTES } else { MAX_BINARY_MESSAGE_BYTES + 1024 };` | 先按 kind 选上限，再读 payload，避免为超长帧预先分配 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:942 |
| `PluginBackendTransport` | `#[serde(rename = "stdio-jsonl")] StdioJsonLines`（默认） \| `#[serde(rename = "stdio-framed")] StdioFramed` | 只有 `stdio-framed` 才允许 `send_binary` | 声明式 | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:159 |
| 二进制帧线格式 | `kind u8 (=1) \| payload_length u32 大端 \| channel_length u16 大端 \| channel UTF-8 \| data bytes` | 进程内结构 `PluginBinaryMessage { plugin_id, channel, data: Bytes }`。二进制帧**只**存在于 `stdio-framed`：在 `stdio-jsonl` 上调用 `send_binary` 会被拒绝，报 `does not use the framed transport required for binary messages`。入站帧由 `dispatch_binary` 拆分后广播给订阅者 | host<->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:349 |
| 二进制帧的 channel 长度冗余 | 宿主自己写入的长度前缀把 channel 计入 `channel + data`；读侧则从 payload 内部**重新读取** channel 长度 | 两侧对同一字段的两种解析方式，读实现见 runtime.rs:661 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:349、dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:661 |
| `read_limited_line` | `read_limited_line(reader, maximum) -> io::Result<Option<Vec<u8>>>`；当 `output.len() + take > maximum` 时返回 `ErrorKind::InvalidData` | 边读边限长，而不是读满后再检查，所以恶意插件无法先撑爆内存再被拒 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:958 |

### 4.3 尺寸上限

三个上限数值各不相同，且**入站与出站不对称**——这是本章最容易被忽略、也最容易踩坑的一组约束。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `MAX_JSON_MESSAGE_BYTES` | `8 * 1024 * 1024`（8 MiB） | 限制宿主**写出**的每个 JSON payload（`write_json`）以及 framed 读侧接受的每个 JSON 帧。同时被复用为 stderr 单行上限，防止话痨 sidecar 撑内存。写路径超限报 `Plugin JSON message exceeds {n} bytes`，且在任何字节落盘前失败 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:43 |
| `MAX_BINARY_MESSAGE_BYTES` | `64 * 1024 * 1024`（64 MiB） | 限制 `send_binary` 的出站二进制 payload，并（加 1024 字节余量）限制 framed 读侧接受的任何非 JSON 帧 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:44 |
| `MAX_JSON_LINE_BYTES` | `= MAX_BINARY_MESSAGE_BYTES`（即 64 MiB），刻意是 `MAX_JSON_MESSAGE_BYTES` 的 8 倍 | `stdio-jsonl` 读侧用它而非 JSON 帧上限，原因是 legacy 插件没有二进制帧这条逃生通道：一页 12 MB 的 Oracle/JDBC 结果必须能装进一行。超限会让整次读取失败，报 `plugin output line is too large: {n} bytes maximum` | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:51 |
| 不对称性（必须显式记住） | 宿主接受**入站 JSONL 行**最大 64 MiB，却拒绝**发出**超过 8 MiB 的 JSON 消息 | 插件若想利用 64 MiB 额度，必须自己分块或改用二进制帧 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:51、dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:43 |
| `MAX_PLUGIN_FILESYSTEM_INLINE_WRITE_BYTES` | `4 MiB` | `filesystem/write` 内联写入的上限（解码前估一次、解码后再校一次），因为 payload 走单条 JSON-RPC 消息 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:18 |
| `MAX_PLUGIN_WORKBENCH_CONTEXT_BYTES` | `2 * 1024 * 1024`（2 MiB） | workbench / result-view context 快照的独立上限，超限时 `snapshotPluginWorkbenchContext` 抛错。与 `MAX_BRIDGE_PAYLOAD_BYTES` 数值相同但是**两个不同常量、两处不同的检查** | host->ui | 无 | dbx/apps/desktop/src/lib/plugins/pluginData.ts:3、dbx/apps/desktop/src/lib/plugins/pluginData.ts:22 |

### 4.4 握手与 `plugin/initialize`

握手在 spawn 之后**立即**发生，早于任何其他请求，且使用默认的 `PLUGIN_REQUEST_TIMEOUT`。其结果是带 `id` 的普通请求，插件的应答就是 `PluginHandshake`。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `plugin/initialize` | `params = { host: { dbxVersion, hostApiVersion, protocolVersions: [1], features: ["host.requestUserInput"] }, plugin: { id, version }, permissions: [string] }` | spawn 后立刻发送、先于任何其他请求，用标准 `PLUGIN_REQUEST_TIMEOUT`。返回值被**校验两次**（先协议版本，再后端身份），任一失败都会杀掉子进程并让整个 session 启动失败 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:372 |
| `host.features` 逐项取值 | 唯一元素 `"host.requestUserInput"` | 字面量就是 `SUPPORTED_PLUGIN_HOST_FEATURES = &["host.requestUserInput"]`（单元素切片）。其注释把 feature 定义为「插件可以调用的 Host API 方法」——也就是说，当前 Host API 面只有这一个方法 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:18 |
| 文档与实现不一致（必须知道） | README 示例的 `host` 块是 `{ dbxVersion, hostApiVersion, protocolVersions }`，**没有 `features` 键**，且 `hostApiVersion` 示例值落后两个版本 | 线协议上宿主总是携带 `host.features`；照抄文档示例的作者不会发现唯一存在的那个 host API 方法。README:585 的正文确实提到了 `host.features` 与 1.1.0 下限，所以这是「示例 vs 正文」的分歧，而不是概念缺失 | host->plugin | 无 | dbx/plugins/README.md:625 vs dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:377 |
| `PluginHandshake` | `{ protocolVersion: u32, capabilities: [string] (默认 []) , plugin: { id: string, version: string } }`（camelCase） | 插件对 `plugin/initialize` 的应答。宿主存在 `RwLock<Option<PluginHandshake>>` 中并通过 `PluginSidecarSession::handshake()` 暴露，但**没有任何生产代码回读它**——仓库里唯一的消费者是一个单元测试 | plugin->host | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:97 |
| `PluginHandshakeIdentity` | `{ id, version }` | 该结构体**没有** `serde(rename_all)`：`id` 与 `version` 本身就是小写 | plugin->host | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:97 |
| `SUPPORTED_PLUGIN_PROTOCOL_VERSION` | `u32 = 1`；manifest `entrypoints.backend.protocol_versions` 默认 `[1]` | manifest 的 `protocol_versions` 不包含 1 即不兼容；宿主在 `initialize` 时向插件通告同样的单元素数组 | 声明式 | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:19 |
| `SUPPORTED_PLUGIN_HOST_API_VERSION` | `"1.2.0"` | 以 `host.hostApiVersion` 出现在 `plugin/initialize` 中，同时也作为环境变量 `DBX_HOST_API_VERSION` 注入子进程。它是**建议性**的版本门（版本只增不减），与 `protocol_versions` 那条硬拒绝是不同的轴。Rust SDK 用它来 gate `HostClient::request_user_input` | 声明式 | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:16、dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:375、dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:297 |
| 版本不匹配的行为 | `protocolVersion != 1` -> `Plugin selected protocol version {}, expected {}` | 校验在 `initialize()` 内完成；失败时 `PluginSidecarSession::start` 调用 `session.shutdown()`（杀掉子进程）并返回 `Err("Plugin '{id}' initialization failed: {error}")`。有测试断言此后进程确已死亡 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:385 |
| 身份不匹配的行为 | `plugin.id/version` 与 manifest 不符 -> `Plugin backend identity '{}/{}' does not match manifest '{}/{}'` | 与版本校验同处，失败路径相同（杀进程 + session 启动失败） | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:385 |
| SDK 侧的同一拒绝 | Rust SDK 返回 `-32001 "DBX and plugin do not share a protocol version"` | SDK 校验的是 `host.protocolVersions` 是否包含 1 | plugin 侧 | 无 | dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:549 |
| legacy 路径（`manifest_version == 0`） | `is_legacy() == (manifest_version == 0)` | legacy 插件**完全跳过** `plugin/initialize`（无握手），不要求声明 `jsonrpc 2.0`，stdout 上非协议行只记日志而不致命，并被钉死在 `stdio-jsonl` 与老的 `protocol_version` 字段上。`compatibility()` 会警告 `Legacy plugin manifest v0 is supported for migration only` | 声明式 | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:742 |

### 4.5 宿主 -> 插件：connection provider 家族

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `connection/test` | `params = { provider: { id, databaseType }, connection: <ConnectionConfig>, runtime: { host, port, proxy? }, operationId: uuid }` | 若 provider 未声明 `test` capability 则**完全跳过**，宿主本地报 `{label} is available`。结果被归一化自 `{success,message}` / `string` / `null` / `ConnectionTestResult`。超时是插件自己的连接期限，而不是 `PLUGIN_REQUEST_TIMEOUT` | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:20、dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:227、dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:447 |
| `connection/connect` | 与 `connection/test` 同一套 lifecycle params；结果不得含 `success:false` | provider 声明 `connect` capability 时，每次打开已保存连接调用一次。只有声明了 `connect` **或** `disconnect` 才为该连接启动 sidecar session。返回 `{success:false,message}` 会中止连接 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:21、dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:260、dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:799 |
| `connection/disconnect` | 同一 lifecycle params；以 `PLUGIN_REQUEST_TIMEOUT`（30 s）和 `driver = None` 调用 | 仅在 provider 声明 `disconnect` 且 session 仍为 `Running` 时由 `PluginConnectionHandle::disconnect()` 发出；否则 handle 静默成功 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:22 |
| `connection/action` | `params = lifecycle params + { action: { id } }`；超时 = manifest 中 `action.timeout_ms`，否则 `PLUGIN_REQUEST_TIMEOUT` | 派发一个 manifest 声明的连接对话框动作。provider 必须声明该 action id，`requires_valid_form` 决定是否先跑必填校验。结果可以是 `null`、消息字符串，或 `{ success, message?, fieldValues? }`，其中 field values 会按 provider 声明的字段做类型检查 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:23、dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:285、dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:307 |
| 连接类 capability 枚举 | `connection-provider.capabilities: ["test", "connect", "disconnect"]`（kebab-case 枚举 `PluginConnectionCapability`） | capability 决定宿主究竟发不发这些生命周期 RPC：没有 `test` 就本地伪造成功消息；`connect` 和 `disconnect` 都没有就根本不为该连接启动 sidecar session | 声明式 | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:584 |

### 4.6 宿主 -> 插件：filesystem provider 家族

除 `list` 外每个方法都先检查对应的 capability，不匹配时报 `Filesystem provider '{pluginId}/{providerId}' does not declare {capability} capability`。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `filesystem/list` | `{ providerId, connectionId?, uri, cursor?, limit } -> { entries: [{ name, uri, kind: file\|directory\|symlink\|other, size?, modifiedAt?, contentType? }], nextCursor? }` | 列一个目录。`limit` 默认 200，钳到 `1..=1000`。宿主会拒绝：条目数超过请求 limit、`nextCursor` 为空或超 4096、条目 `name` 为空或超 1024 字节、条目 URI 的 scheme 未被 provider 声明。超时 `PLUGIN_REQUEST_TIMEOUT`（30 s）。**`list` 无 capability 门**（只有 read/write/delete/rename/mkdir 受门控） | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:8 |
| `filesystem/read` | `{ providerId, connectionId?, uri, maxBytes } -> { dataBase64, contentType?, truncated, etag? }` | 预览级读取，受 `read` capability 门控。`maxBytes` 默认 256 KiB，钳到 `1..=4 MiB`。宿主会 base64 解码并**重新核对真实字节数**，超过 `maxBytes` 即拒绝。硬编码 30 s 超时 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:9 |
| `filesystem/write` | `{ providerId, connectionId?, uri, dataBase64, create, overwrite, etag? } -> { success, message?, entry? }` | 受 `write` capability 门控。内联写入解码后上限 4 MiB（检查两次：先估算、后解码核对），因为 payload 走单条 JSON-RPC 消息。返回 mutation 结果，其中 `success` 默认 `true` | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:10、dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:18 |
| `filesystem/createDirectory` | `{ providerId, connectionId?, uri } -> { success, message?, entry? }` | 受 `mkdir` capability 门控；30 s 超时（与其余变更操作共用同一路径） | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:11 |
| `filesystem/delete` | `{ providerId, connectionId?, uri, recursive: bool } -> { success, message?, entry? }` | 受 `delete` capability 门控 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:12 |
| `filesystem/rename` | `{ providerId, connectionId?, sourceUri, targetUri, overwrite: bool } -> { success, message?, entry? }` | 受 `rename` capability 门控；两个 URI 都在调用前做 scheme 校验 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:13 |
| filesystem capability 枚举 | `filesystem-provider.capabilities: ["read", "write", "delete", "rename", "mkdir"]`（kebab-case 枚举 `PluginFilesystemCapability`） | 除 `list` 外每个 filesystem RPC 都对照检查 | 声明式 | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:704 |
| filesystem URI 文法 | 去空白后 `<= 4096` 字节、不含控制字符、必须以 provider 声明的某个 scheme 加 `:` 开头 | 对请求 URI、每个返回条目 URI、以及 rename 的 source/target 都生效。调用方没给 URI 时默认取 `provider.root_uri`，否则取 `"{schemes[0]}:/"` —— 因此 `schemes` 实际上是**必须非空**的 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:351 |
| filesystem 超时 | `list = PLUGIN_REQUEST_TIMEOUT`（30 s）；`read = Duration::from_secs(30)`；所有变更操作（write/createDirectory/delete/rename）`= Duration::from_secs(30)` | 该面**写死字面量 30 s** 而不是复用常量，所以一旦改动 `PLUGIN_REQUEST_TIMEOUT`，`list` 会与 read/write 失步 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:203、dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:313 |

**filesystem 如何抵达 sidecar（命令面，易被漏掉）**：`list_plugin_filesystem_entries` / `read_plugin_filesystem_file` / `write_plugin_filesystem_file` / `create_plugin_filesystem_directory` / `delete_plugin_filesystem_entry` / `rename_plugin_filesystem_entry`，web 侧镜像为 `POST /plugins/filesystem/{list,read,write,create-directory,delete,rename}`。它们解析 provider、执行 capability 门控、再发出 `filesystem/*` RPC，全部传 `required_permission = None`。证据 dbx/src-tauri/src/commands/plugins.rs:358、dbx/crates/dbx-web/src/main.rs:427。

### 4.7 宿主 -> 插件：context menu、workbench、result view

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `contextMenu/<contributionId>` | `method = "contextMenu/" + contribution.id`；connection 项 `params = { connection: { id, dbType, name, database } }`，table 项 `params = { table: { connectionId, database?, schema?, table } }`；结果可选读作 `{ message?: string }` 以弹出 toast | 原生（非 iframe）的侧边栏菜单项用**字符串拼接**直接派发到插件后端（connection 与 table 两个表面各有一条拼串调用点）；宿主没有对应常量，也**没有 DBX 侧的权限门**（Tauri/web invoke 路径传 `required_permission = None`） | ui->host（进而 host->plugin） | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:651、dbx/apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue:6749 |
| workbench：**不存在**后端 RPC 方法 | `PluginWorkbenchContribution { id, label, description?, icon? }` —— 仅展示元数据，且必须声明 UI entrypoint | 宿主里没有任何 `workbench/*` 后端方法（全仓 grep `workbench/` 作为方法字符串命中 0 次）。打开 workbench 会加载插件的沙箱 UI entrypoint；workbench 需要后端做什么，都由它自己用 `backend.invoke` 加自选方法名发起。manifest 校验器强制 workbench contribution 必须声明 UI entrypoint，且引用某 workbench 名的 connection provider 必须指向已存在的那个 | 声明式 | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:641 |
| result view：**不存在**后端 RPC 方法 | `PluginResultViewContribution { id, label, description?, icon? }` —— 仅展示元数据，且必须声明 UI entrypoint | 选择某个 result view 会打开插件 workbench UI 并交给它一份有界的 context 快照，没有 result-view 专属的 host->plugin 请求。快照由前端构造为 `{ connectionId, database, sql, result: { columns, rows (<=500), truncated } }`，与文档契约一致。**更正**：`const cappedRows = result.rows.slice(0, 500);` 并不在 `ContentArea.vue:1056`，那里是 `openPluginResultView` 的声明处，引用行在其后若干行；「500 行上限、无 result-view RPC」这一论断本身正确 | 声明式 | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:667、dbx/apps/desktop/src/components/layout/ContentArea.vue:1056 |
| contribution tag 取值 | kebab-case `type` 标签：`connection-provider \| workbench \| filesystem-provider \| context-menu \| result-view` | manifest v1 包可以声明的五种 contribution。只有 `connection-provider`、`filesystem-provider` 和（以未文档化方式）`context-menu` 会映射到 sidecar 方法 | 声明式 | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:229 |

### 4.8 宿主 -> 插件：driver 家族（**legacy manifest-v0 专属**）

这是一个**完全独立于上面所有内容**的第二套 RPC 面：manifest 里声明为 `driver` 的插件会被 `dbx-core` 当成一个数据库引擎。这些调用走 `PluginRegistry::invoke_driver` / `PluginDriverSession`，会在请求上设置 `driver = Some(driver_id)`。

> **关键更正（必须写进正文）**：driver 面是 **legacy manifest v0 的专属声明**。manifest v1 **直接拒绝 `drivers` 字段**，因此当前 manifest schema 下的任何插件都无法使用这些方法，本手册的参考插件 `io.dbx.excalidraw`（`manifest_version 1`）同样不能。此外，原条目引用的 `connection/mod.rs:1695` 只展示了 `connect` 调用，并不能佐证「请求携带 `driver = Some(driver_id)`」；决定性的那行在 `dbx-plugin-runtime` 里。

| 方法 | 参数形状 | 说明 | 角色 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `testConnection` | `{ connection, ... }` | driver 连通性测试 | host->plugin | 无 | dbx/crates/dbx-core/src/connection/mod.rs:1703 |
| `connect` | `{ connection, ... }` | 建立驱动级连接，超时用 `external_driver_connect_timeout(config)` | host->plugin | 无 | dbx/crates/dbx-core/src/connection/mod.rs:1720 |
| `executeQuery` | `{ connection, ... }` | 执行查询；`executeQueryPage` 的兜底目标 | host->plugin | 无 | dbx/crates/dbx-core/src/query/mod.rs:2321、dbx/crates/dbx-core/src/query/mod.rs:2341、dbx/crates/dbx-core/src/query/mod.rs:2362 |
| `executeQueryPage` | `{ connection, ... }` | **可选**方法：插件若以 method-not-found 应答，自动回落到 `executeQuery` | host->plugin | 无 | dbx/crates/dbx-core/src/query/mod.rs:2212 |
| `fetchQueryPage` | `{ connection, ... }` | 分页拉取 | host->plugin | 无 | dbx/crates/dbx-core/src/query/mod.rs:2314 |
| `closeQuerySession` | `{ connection, ... }` | 关闭查询会话 | host->plugin | 无 | dbx/crates/dbx-core/src/query/mod.rs:3071 |
| `beginManualTransaction` | `{ connection, ... }` | 手工事务开始 | host->plugin | 无 | dbx/crates/dbx-core/src/query/mod.rs:5757 |
| `executeInManualTransaction` | `{ connection, ... }` | 手工事务内执行 | host->plugin | 无 | dbx/crates/dbx-core/src/query/mod.rs:6524 |
| `commitManualTransaction` | `{ connection, ... }` | 手工事务提交 | host->plugin | 无 | dbx/crates/dbx-core/src/query/mod.rs:6718 |
| `rollbackManualTransaction` | `{ connection, ... }` | 手工事务回滚 | host->plugin | 无 | dbx/crates/dbx-core/src/query/mod.rs:6382 |
| `getExplainInfo` | `{ connection, ... }` | AI explain 用的执行计划信息 | host->plugin | 无 | dbx/crates/dbx-core/src/ai/agent_explain.rs:71 |
| `listDatabases` | `{ connection, ... }` | 库列表 | host->plugin | 无 | dbx/crates/dbx-core/src/schema/mod.rs:658 |
| `listSchemas` | `{ connection, ... }` | schema 列表 | host->plugin | 无 | dbx/crates/dbx-core/src/schema/mod.rs:858 |
| `listTables` | `{ connection, ... }` | 表列表 | host->plugin | 无 | dbx/crates/dbx-core/src/schema/mod.rs:2321 |
| `getObjectSource` | `{ connection, ... }` | routine/对象源码 | host->plugin | 无 | dbx/crates/dbx-core/src/schema/mod.rs:9874 |
| `getColumns` | `{ connection, ... }` | 列信息，**timeout 传 `None`（即无限等待）** | host->plugin | 无 | dbx/crates/dbx-core/src/data/transfer.rs:6243 |
| `connectionInfo` | `{ connection, ... }` | 连接信息 | host->plugin | 无 | dbx/crates/dbx-core/src/connection/mod.rs:5031 |

### 4.9 宿主 -> 插件：MCP 面

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `mcp/tools` | `params = {} -> { tools: [...] }`（也接受裸数组）；超时 30 s | 内建 DBX MCP server 用它枚举每个兼容插件的 MCP 工具，再按 `pluginId` 分组。**无权限门**。`plugins/README.md` 里完全没有提到这个方法 | host->plugin | 无 | dbx/crates/dbx-mcp/src/backend.rs:742 |
| `mcp/call` | `{ tool: string, arguments: object, lifecycle? }`；`lifecycle` 与 `connection/test` 同一套 `{ provider, connection, runtime, operationId }`；超时 300 s（MCP CLI）或来自桌面 MCP 桥的 `clamp(1000, 600000)` ms | 把一个 agent 工具调用转发进插件后端。lifecycle payload 由宿主根据已保存连接**生成**，所以插件凭据从不离开宿主；当该工具被路由到终端时，桌面桥会先打开/聚焦连接 workbench | host->plugin | 无 | dbx/crates/dbx-mcp/src/backend.rs:782、dbx/src-tauri/src/commands/mcp_bridge.rs:1417 |

### 4.10 插件 -> 宿主：`host/requestUserInput` 与提示流程

这是 sidecar 线上**唯一**的插件反向方法。方向判定是结构性的：一条消息若 `id` 是**字符串**而非 `u64`、且 `method` 以 `host/` 开头，就被路由到 `handle_plugin_request`，并在一个 spawned task 中应答，从而让 stdout reader 继续排空。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `host/requestUserInput` | 插件发 `{ jsonrpc: "2.0", id: "<string>", method: "host/requestUserInput", params: { prompt, title?, echo?, default?, options?[{value,label}], timeoutSecs? } }`；宿主回 `{ jsonrpc: "2.0", id: <同一字符串>, result }` 或 `{ ..., error: { code, message } }` | **不需要任何 manifest 权限**（与 `host.events` / `host.binary` 等门控 UI 桥的权限不同）；唯一的门槛是 `plugin/initialize` 时通过 `host.features` 的广播 | plugin->host | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:26 |
| `PLUGIN_HOST_REQUEST_PREFIX` | `"host/"` —— 只有以该前缀开头的方法才会被当成插件请求 | 该命名空间被保留，使插件 manifest 永远不会被寻址到 `host/*` 之下；同时它也是把「恰好带了字符串 id 的 legacy 插件事件」留在事件路径、而不误入 host-request 路径的守卫 | plugin->host | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:29 |
| 错误码 | `-32001` = 无用户界面 / 无法询问用户；`-32002` = 打开的提示过多；`-32601` = 方法不存在；`-32602` = 参数非法 | 错误形状为 `{ jsonrpc, id, error: { code, message } }`。字符串 id 以 `host/` 开头但方法未实现时返回 `-32601 "Method not found: {method}"`。插件被期望对四种错误都降级处理而不是阻塞 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:782、dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:1310 |
| 结果动作 | `{ action: "submit", value: string }` \| `{ action: "cancel" }` \| `{ action: "timeout" }` | 只有**敲入的 Secret 回答**才算 `submit`。用户关闭对话框（Reject）或宿主按键 Accept{remember} 都映射为 `cancel`；提示过期映射为 `timeout`。宿主**从不**合成或缓存值，插件对任何非 `submit` 的结果都必须 fail closed | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:892 |
| `MAX_PLUGIN_PROMPTS_IN_FLIGHT` | 每个插件会话 **4** 个并发提示；第 5 个返回 `-32002 "Plugin already has 4 input prompts open"` | 按 `PluginSidecarSession` 计数（通过 watch channel `PromptActivity`），使损坏或恶意的后端无法堆叠对话框。这个计数同时是请求死线暂停的触发条件 | plugin->host | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:32 |
| 参数边界 | `prompt`：必填、非空白、`<= 2000` 字符；`title <= 200`；`default <= 1000`；`options <= 8`，各 `value` 唯一且 `<= 200` 字符；`echo: bool`（默认 `false`，即掩码）；`timeoutSecs` 钳到 `5..=600`（默认 300） | 所有字段在 `UserInputSpec::parse` 中先校验再请求对话框，违规返回 `-32602` 并附具体消息。选项的 `label` 为空时回落到其 `value` | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:38、dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:865 |
| 提示打开期间暂停请求死线 | `await_response` 在 `prompts.open > 0` 时暂停计时预算；`MAX_PROMPT_PAUSE = 600 s` 封顶总暂停时长 | 只要有提示打开，所有在途 host->plugin 请求都停止计入死线，并在最后一个提示关闭时一起恢复。累计暂停超过 600 s 则该请求失败：`was waiting for user input for more than 600 seconds`。存在这条机制的原因是 `connection/test` / `connection/connect` 共用的连接超时远短于人类读完一个堡垒机 MFA 挑战所需的时间 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:34 |
| 关闭时强制释放提示 | `session.prompts.close()` 让挂起的对话框以 `cancel` 解决 | session shutdown 的一部分 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:34 |

### 4.11 超时常量汇总

| 名称 | 取值 | 适用范围 | 证据 |
| --- | --- | --- | --- |
| `PLUGIN_REQUEST_TIMEOUT` | `Duration::from_secs(30)` | 调用方未指定时的默认 host->plugin 死线，覆盖 `plugin/initialize` 与每次 filesystem `list`。超时报 `Plugin '{id}' request '{method}' timed out after {n} seconds` | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:22 |
| 连接建立死线 | `plugin_connect_deadline()`：从 `connection.external_config` 读 `connect_timeout_secs`，否则用 provider 字段默认值，否则用 `config.effective_connect_timeout_secs()`；再 `clamp(1, 300)` 秒 | `connection/test` 与 `connection/connect` **不用** `PLUGIN_REQUEST_TIMEOUT`，而用插件自己的握手超时，保证宿主死线不会先于插件触发。插件给出的值预期优先于类型化字段 | dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:444 |
| driver `connect` 超时（对照） | `external_driver_connect_timeout = agent_connect_timeout`，即 `effective_connect_timeout_secs().max(30)` | driver 家族（legacy v0 专属） | dbx/crates/dbx-core/src/connection/mod.rs:6543 |
| filesystem RPC 超时 | `list` 用 `PLUGIN_REQUEST_TIMEOUT`；`read` 与全部变更操作用字面量 `30 s` | filesystem 面 | dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:203、dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:313 |
| `connection/action` 超时 | manifest 中 `action.timeout_ms`，缺省回落到 `PLUGIN_REQUEST_TIMEOUT` | 连接对话框动作 | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:23 |
| `mcp/tools` | 30 s | MCP 工具枚举 | dbx/crates/dbx-mcp/src/backend.rs:742 |
| `mcp/call` | 300 s（MCP CLI）；桌面 MCP 桥为 `clamp(1000, 600000)` ms | MCP 工具转发 | dbx/crates/dbx-mcp/src/backend.rs:782 |
| driver `getColumns` | `None`（**无限等待**） | driver 家族，见 4.8 更正说明 | dbx/crates/dbx-core/src/data/transfer.rs:6243 |
| UI 侧 `backend.invoke` 的 `timeoutMs` | 校验后钳到 `1..=120000` ms | iframe bridge 传入的参数，钳制发生在 `requireTimeout`（**更正**：引用的 return 语句在 pluginHostBridge.ts:930，`:928` 是该函数声明行；钳制语义 `1..=120000` 本身正确） | dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:930 |
| Tauri / web 命令层的 `timeout_ms` | 到达 session 前钳到 `1..=120000` ms | `invoke_plugin` 等命令入口 | dbx/src-tauri/src/commands/plugins.rs:320 |
| user input 暂停上限 | `MAX_PROMPT_PAUSE = 600 s` | 见 4.10 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:34 |
| Rust SDK 插件侧调用超时 | 默认 330 s | SDK `HostClient` | dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:20 |

### 4.12 stream 事件：`host.stream.chunk` / `.end` / `.error`

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `host.stream.chunk` / `host.stream.end` / `host.stream.error` | `{ source: "dbx-host", version: 1, type: "event", method: "host.stream.chunk"\|"host.stream.end"\|"host.stream.error", params: { streamId, dataBase64?, message?, ...metadata } }` | 宿主 SDK 的 `stream()` 辅助函数会往 `backend.invoke` 请求中注入一个 `streamId`，按该 id 过滤转发过来的插件事件，并把它们变成一个 `ReadableStream` 加一个 metadata 对象。取消流时会用 close 方法再调一次 `backend.invoke`（默认 close 方法名 `"filesystem/stream/close"`） | **plugin->host->ui**（更正后） | 无 | dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:752 |
| 方向更正（必须显式写出） | 原描述称这三个是「UI-bridge 事件，不是 sidecar 线帧」并把方向定为 host->ui | **已被证伪**：这三个方法名是由**插件后端**作为普通 sidecar `PluginEvent` 通知（plugin->host JSON-RPC 通知）发出的；bridge 只是把 sidecar 事件以自己的方法名重新投递，而被注入的 SDK helper 是唯一消费者。Rust 侧从不发出它们（全仓 grep `host.stream.` 只命中 TS/MJS）。正确方向是 **plugin->host->ui** | n/a | 无 | dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:752 |
| `filesystem/stream/close` 的地位 | 只是**约定**，不是宿主方法 | 它仅作为注入 SDK 的默认 closeMethod 出现，参考 Excalidraw 插件并没有实现该方法（`backend/main.go` 只路由 `document/`、`asset/`、`export/`、`filesystem/`） | plugin 侧 | 无 | dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:752 |
| `host.download.progress` | `{ source: "dbx-host", version: 1, type: "event", method: "host.download.progress", params: <进度 payload> }` | UI bridge 在原生侧跑 `host.downloadFile` 时合成的进度回调；它是宿主**自己发起**的、唯一带 `host.*` 名字的事件（与 `host.stream.*` 由插件发起正好相对） | host->ui | 无 | dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:324 |

### 4.13 会话状态机

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `PluginSessionState` | `Starting \| Running \| Stopping \| Stopped \| Exited`，`serde rename_all = "snake_case"`，因此线值为 `starting/running/stopping/stopped/exited` | 五态枚举，由 `PluginSessionStatus { state, message? }` 与 `ActivePluginSession { pluginId, processId, state }` 携带 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:73 |
| 状态迁移与调用守卫 | `Starting -> Running`（启动成功时；legacy 插件则立即进入 `Running`）；`Starting/Running -> Stopping -> Stopped`（`shutdown()`）；reader 结束/失败 -> `Exited`（**从不覆盖** `Stopping`/`Stopped`） | `invoke_value` 接受 `Starting \| Running`；`notify` 与 `send_binary` 要求**恰好** `Running`。若 session 在初始化期间离开了 `Starting`，`start()` 会在杀掉子进程并回收挂起请求后失败：`stopped during initialization{message}` | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:536 |
| 运行时守卫 | `ensure_running` / `ensure_running_or_starting` | 上述调用前置条件的具体实现 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:525、dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:534 |
| `shutdown` 语义 | `shutdown() -> 状态 Stopping -> prompts.close() -> child.kill() -> fail_pending("Plugin session stopped") -> 状态 Stopped{message}` | **没有优雅关闭 RPC**：宿主直接杀 OS 进程（spawn 时 `kill_on_drop(true)`）。在途请求以 `Plugin session stopped` 失败，每个打开的提示都被释放使对话框消失，kill 的错误会记录到 `Stopped` 状态消息里 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:357 |
| 输出流结束的防御性终止 | `terminate_after_output_end` 会追加 `; process terminated by host` | 输出流正常结束也会防御性地终止进程 | n/a | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:357 |
| 子进程 spawn 契约 | 可执行文件来自 `compatibility.backend_executable`；cwd = 插件安装目录；stdin/stdout/stderr 均为 pipe；`kill_on_drop(true)`；环境变量 `DBX_PLUGIN_ID`、`DBX_PLUGIN_VERSION`、`DBX_APP_VERSION`、`DBX_HOST_API_VERSION`、`DBX_PLUGIN_PROTOCOL_VERSION`、`DBX_PLUGIN_DATA_DIR` | 插件以当前 OS 用户权限运行（**无沙箱**）。stdout 仅供协议使用（reader 会解析），stderr 逐行加 `[plugin:<id>]` 前缀记日志。Unix 上可执行文件必须至少有一个执行位，否则启动即失败。`DBX_PLUGIN_DATA_DIR` 由 registry 注入为 `<data dir>/plugin-data/<id>`（调用方已设置则不再覆盖），Go SDK 通过 `DataDirEnvVar` 读取 | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:1064、dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:415 |

### 4.14 背压与广播容量

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 每会话 broadcast 容量 | events `256`、binary `64` | `PluginEvent` 与二进制消息通过 tokio broadcast 通道分发 | host->ui | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:225 |
| 宿主级 broadcast 容量 | events `512`、binary `128` | 订阅 API 为 `PluginHost::subscribe_events` / `subscribe_binary` | host->ui | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:85 |
| 落后订阅者的行为 | 记日志 `Plugin host event relay skipped {n} events`，而不是阻塞 sidecar | 后果是**慢 UI 会静默丢事件**，插件不能假设每个事件都被送达 | host->ui | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:225 |
| `GET /plugins/events`（SSE） | 每个 SSE `data:` 帧是一个 `PluginStreamMessage`，`serde(tag = "kind")` + snake_case kind + camelCase 字段：`{ kind: "event", pluginId, method, params }` \| `{ kind: "binary", pluginId, channel, dataBase64 }` \| `{ kind: "lagged", skipped }` | 浏览器宿主把每个插件事件与二进制消息暴露为一条长连 SSE 流，是 Tauri 事件通道的 web 对应物。与 iframe bridge 不同，这条路径上**没有任何**按插件、按 contribution 或按 manifest 权限的过滤。订阅者落后时发出 `lagged` 帧而不是断开连接 | host->ui | 无 | dbx/crates/dbx-web/src/routes/plugins.rs:564、dbx/crates/dbx-web/src/routes/plugins.rs:165、dbx/crates/dbx-web/src/main.rs:433 |

### 4.15 权限模型：`ensure_permission` 与 UI 桥的门

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `ensure_permission` | `PluginHost::invoke/notify/send_binary(..., required_permission: Option<&str>, ...)` -> `Err("Plugin '{id}' has not declared permission '{permission}'")` | sidecar 路径上**唯一**的权限执行点。声明值对照 `manifest.permissions`；传 `None` 则完全跳过检查。所有生产调用方（Tauri 命令 `plugins.rs`、web 路由 `plugins.rs`、`mcp_bridge.rs`、dbx-mcp `backend.rs`）都传 `None`，**因此当前没有任何 host->plugin sidecar 方法受权限门控** | host->plugin | 无 | dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:810、dbx/src-tauri/src/commands/plugins.rs:322 |
| `SUPPORTED_PLUGIN_PERMISSIONS` | `["host.events", "host.binary", "host.workbench", "host.filesystem", "host.plans:read", "host.storage"]` 外加任意多个 `host.network:<origin>` 条目 | manifest 校验器接受的完整白名单，其余字符串都会产生以该字符串命名的兼容性错误。有测试断言发布的 `manifest.schema.json` 枚举与这份列表逐字节相等。注意这是 **UI-bridge/host-bridge 白名单**，除经 `ensure_permission` 外与 sidecar RPC 无关 | 声明式 | n/a | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:24 |
| `host.network:<origin>` | `host.network:https://host[:port]` —— 仅 https，不允许 path/query；解析出的 origin 成为沙箱文档的 `connect-src`（**最多 8 个**） | 由 `parse_host_network_permission` 解析，TypeScript 侧由 `pluginNetworkOrigins` 镜像。未声明任何 origin 时注入的 CSP 是 `connect-src 'none';`，即插件 UI 出网**默认拒绝** | 声明式 | `host.network:<origin>` | dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:37、dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:527 |
| UI bridge 的权限门 | `host.workbench` -> `host.openWorkbench`；`host.filesystem` -> `host.openFilesystem`；`host.storage` -> `host.storageGet/Set/Delete`；`host.binary` -> `backend.sendBinary`；`host.plans:read` -> `host.getPlanCapabilities` / `host.explainPlan`；`host.ai` -> `host.ai.openConversation`；`host.events` -> 事件转发；`host.binary` -> 二进制转发 | 前端 bridge 用**一条统一错误消息**执行七道 manifest 门。`host.saveFile` / `host.pickFiles` / `host.readFileChunk` / `host.writeFileChunk` / `host.copy` **刻意不设门**，因为字节只有在原生对话框或显式用户操作之后才会移动 | ui->host | `host.workbench \| host.filesystem \| host.storage \| host.binary \| host.plans:read \| host.ai \| host.events` | dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:501 |
| `window.dbxPlugin` 的 host 方法全表 | `host.downloadFile`、`host.cancelDownload`、`host.getContext`、`host.openWorkbench`、`host.reopenConnection`、`host.openFilesystem`、`host.getPlanCapabilities`、`host.explainPlan`、`host.ai.openConversation`、`host.saveFile`、`host.copy`、`host.pickFiles`、`host.readFileChunk`、`host.beginFileSave`、`host.writeFileChunk`、`host.finishFileSave`、`host.closeFileHandle`、`host.storageGet`、`host.storageSet`、`host.storageDelete`、`backend.invoke`、`backend.notify`、`backend.sendBinary`、`ui.readAsset` | 沙箱 UI 的全部宿主面。未知方法报 `Unsupported plugin host method '<name>'`。**更正**：原文「其中只有四个带权限门」是错的，且与本章自身的权限条目自相矛盾 —— 仅 dispatch 路径就执行**六**个不同的权限串（`host.binary`、`host.workbench`、`host.filesystem`、`host.plans:read`、`host.storage`、`host.ai`），事件/二进制转发又各有一道（`host.events`、`host.binary`）。其余方法或者按设计不设门（走原生对话框的文件路径），或者由 init 消息里的 capability 广播门控（`capabilities.downloadFile` / `planApi` / `storage` / `ai`） | ui->host | 见上行与下下行 | dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:314、dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:497 |
| `backend.invoke` / `backend.notify` / `backend.sendBinary` | `backend.invoke { method, params?, timeoutMs? } -> T`；`backend.notify { method, params? } -> null`；`backend.sendBinary { channel, dataBase64? }`（外加 transferred ArrayBuffer）`-> null` | 真正抵达 sidecar 线的三个 bridge 方法。`backend.invoke` 映射到 Tauri/web 的 `invoke_plugin` 命令（`required_permission = None`）；`timeoutMs` 经校验钳到 `1..=120000` ms；二进制发送需要 `host.binary` | ui->host | `host.binary`（仅 `backend.sendBinary`） | dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:344、dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:930 |
| bridge 的 postMessage 信封 | 插件->宿主 `{ source: "dbx-plugin", version: 1, type: "request"\|"ready"\|"shortcut", id: string, method: string, params?, data?: ArrayBuffer }`；宿主->插件 `{ source: "dbx-host", version: 1, type: "init"\|"context"\|"env"\|"event"\|"binary"\|"response"\|"filedrop"\|"dragstate", ... }` | 与 sidecar 线**完全独立**的协议。请求 id 是字符串（`<= 128` 字符），应答带 `{ result }` 或 `{ error: string }`，params 在派发前被限制在 2 MiB JSON 之内。信封常量：`BRIDGE_VERSION = 1`、`HOST_MESSAGE_SOURCE = "dbx-host"`、`MAX_BRIDGE_PAYLOAD_BYTES = 2 MiB`、`MAX_BRIDGE_BINARY_BYTES = 8 MiB`、`MAX_BRIDGE_SAVE_BYTES = 512 MiB` | host<->ui | 无 | dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:6 |
| bridge init 消息 | `{ source: "dbx-host", version: 1, type: "init", pluginId, contributionId, locale, theme?, permissions: string[], capabilities: { downloadFile: bool, planApi: bool, storage: bool }, context }` | iframe 协议的握手，是插件依赖的**第二个**握手契约。它告诉插件哪些宿主 API 存在（`capabilities`）以及被允许做什么（`permissions`）。被注入的 SDK 把它存下来，文档化的规则是「缺键即不支持，不要探测重试」；storage 的使用在 `capabilities.storage` 上有显式门控 | host->ui | 无 | dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:249、dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:867 |
| Tauri / web 命令面 | `invoke_plugin(plugin_id, method, params, timeout_ms?)`、`notify_plugin(plugin_id, method, params)`、`send_plugin_binary(plugin_id, channel, data_base64)`、`list_active_plugins`、`stop_plugin`、`activate_plugin`；HTTP 镜像 `POST /plugins/invoke`、`/plugins/notify`、`/plugins/binary`、`/plugins/connection-action` | 通往 sidecar runtime 的传输无关入口。三个 RPC 命令全部传 `required_permission = None`，`timeout_ms` 在抵达 session 前钳到 `1..=120000` ms。**更正**：原列表漏了真正驱动 filesystem-provider RPC 的那六个宿主入口（见 4.6 末），读者会因此不知道 `filesystem/*` 是怎么抵达 sidecar 的 | ui->host | 无 | dbx/src-tauri/src/commands/plugins.rs:320、dbx/crates/dbx-web/src/main.rs:423 |

### 4.16 跨实现不一致（宿主 vs 两个 SDK）

三处不一致都是真实的坑：插件作者若只读 SDK 源码，会对宿主行为产生错误预期。

| 名称 | 签名/取值 | 说明 | 证据 |
| --- | --- | --- | --- |
| `MAX_JSON_LINE_BYTES` vs SDK 出站上限 | 宿主 JSONL reader 允许每行 64 MiB，而两个 SDK 都把**出站** JSON 消息限制在 8 MiB（`MAX_JSON_BYTES` / `maxJSONBytes`），Go SDK 的**入站** scanner 也是 8 MiB | 宿主抬高行上限是为了放行宽表 Oracle/JDBC 结果，但使用任一已发布 SDK 的插件仍然无法序列化超过 8 MiB 的 JSON 消息（Rust SDK 报 `-32600 "JSON message is too large"`），而 Go SDK 甚至读不下超过 8 MiB 的宿主行。插件若想用满宿主的 64 MiB 额度，必须自己分块或改走二进制帧。宿主这份不对称是**有意为之**（runtime.rs:45-50 有注释），但两个 SDK 都没有反映 | dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:133、dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:51 |
| `validate_protocol_name` 三个版本 | 宿主：非空、`<=256`、字符集 `[A-Za-z0-9._:/-]`；Rust SDK：非空、`<=256`、禁空白；Go SDK：`1..=256`、首字符必须字母数字、后续可用 `. _ : / -` | 同一个字段有三套文法。Go 插件永远发不出宿主本可接受的前导标点名；Rust SDK 会放过含 `#` 的名字，随后被宿主拒绝，把本地成功变成协议错误 | dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:400、dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:675 |
| framed 读上限三方不同 | 宿主 framed reader：JSON 8 MiB / 其他 `MAX_BINARY_MESSAGE_BYTES + 1024`；Rust SDK：`MAX_BINARY_BYTES + 1024`；Go SDK：`maxBinaryBytes + 2 + 256` | 三个二进制帧上限相差 768 字节，因此一个大小介于 (64 MiB + 1024) 与 (64 MiB + 1298) 之间的帧会被 Go SDK 接受、被宿主拒绝。宿主还会把未知 kind 视为致命错误而不是当作二进制 | dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:264、dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:942、dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:513 |
| SDK 侧的实现形状 | Rust：`PluginServer::new(PluginMetadata::new(id, version).with_capability(..), handler).transport(PluginTransport::JsonLines\|Framed).worker_threads(2..16).work_queue_capacity(256).serve()`；Go：`dbxpluginsdk.NewServer(Metadata{ID,Version,Capabilities}, handler).WithTransport(TransportFramed\|TransportJSONLines).Serve()`，可选 `BinaryHandler.HandleBinary(channel, data, emitter)` | Rust SDK 工作池默认 = `available_parallelism` 钳到 `2..=16`，`HostClient` 的 id 是字符串 `"plugin-{n}"`。Go SDK 对 `plugin/initialize` **同步内联**应答，其余请求各起一个 goroutine 且仅在请求带 id 时回答，所以通知是 fire-and-forget。Go 帧头 5 字节；JSONL 入站用 `bufio.Scanner` 且 max token 为 `maxJSONBytes` | dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:549、dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:652、dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:313、dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:292、dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:19、dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:202 |
| 插件侧事件发射 API | Go：`func (emitter *Emitter) Event(method string, params any) *PluginError`；Rust：`PluginEmitter::event(&self, method: &str, params: Value) -> Result<(), PluginError>`；两者都写 `{ jsonrpc: "2.0", method, params }`（无 id）；Go 另有 `Emitter.Binary(channel, data)`（仅 framed 传输） | 插件实际发出 `PluginEvent` 通知的方式。两个 SDK 都会在写出前于本地校验方法名，这是第三套名字文法。Go 的 `Binary` channel 校验用的是 `validProtocolName`，所以 Go 插件无法打开某些宿主 `validate_binary_channel` 本会放行的 channel 名 | dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:78、dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:93、dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:333 |

### 4.17 参考实现：`io.dbx.excalidraw` 的方法命名空间

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `io.dbx.excalidraw` 后端方法面 | `document/list`、`document/create`、`document/get`、`document/saveScene`、`document/rename`、`document/delete`、`asset/stat`、`asset/putChunk`、`asset/getChunk`、`export/write` —— 按前缀 `document/` \| `asset/` \| `export/` \| `filesystem/` 派发，其余一律 `MethodNotFound` | 展示了预期的分工：插件私有命名空间承载 UI 自身需求，而宿主拥有的 `filesystem/*` 名字由同一个 Go handler 处理。插件声明权限 `[host.workbench, host.filesystem]`，contribution 为 workbench + result-view + filesystem-provider（scheme `"excalidraw"`，capabilities 为 read/write/delete/rename，**不含 mkdir**） | host->plugin | `host.workbench`, `host.filesystem` | dbx-plugin-excalidraw/backend/main.go:110、dbx-plugin-excalidraw/manifest.json:14、dbx-plugin-excalidraw/manifest.json:48 |

### 4.18 数据完备性说明

本章条目覆盖了审计数据中 `rpc-protocol` 维度的全部 53 条记录，未做删减。两处数据稀薄需要读者知晓：

- `PluginHandshake.capabilities` 的**实际用途**在数据中只有一条负面证据：`RwLock<Option<PluginHandshake>>` 存储后无任何生产代码回读。没有找到任何按 capability 分支的宿主逻辑，因此无法说明该字段当前有何行为效果。
- `mcp/tools` 与 `mcp/call` 只有两个调用点的证据，没有插件侧的响应契约描述（例如 `tools` 数组元素的确切形状），SDK 侧也没有对应的 MCP 辅助 API 条目 —— 若要实现 MCP 工具，这一块需要直接读 `dbx-mcp` 源码补全。

## 5. 事件（Events）

DBX 插件事件链路上有两套彼此独立的通道，先记住这个分界，后面每一节都落在其中一半：

- **plugin↔host 后端事件链**：sidecar 进程 stdout 上的 id-less JSON-RPC notification → `PluginEvent` → 会话级 broadcast → host 级 broadcast → Tauri emit 或 SSE。前端以 `dbx-plugin-event`（JSON）和 `dbx-plugin-binary`（二进制）两个 Tauri 事件接收。
- **host↔plugin UI 桥接链**：插件 iframe 与宿主之间的 `postMessage` 帧，最终以 `document` 上的 `CustomEvent`（`dbx-plugin-init` / `dbx-plugin-context` / `dbx-plugin-env` / `dbx-plugin-event` / `dbx-plugin-binary` / `dbx-plugin-filedrop` / `dbx-plugin-dragstate`）暴露给插件代码。

两套链路在传输结构上没有任何继承关系，但字段命名约定被统一为 camelCase，这是全线的事实线格式（wire contract）。

### 5.1 事件信封 `PluginEvent` 与其生产路径

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `PluginEvent` | `{ pluginId: String, method: String, params: serde_json::Value }`，`serde(rename_all = "camelCase")` | 每一个异步 plugin→host 通知的唯一信封。只在 `dispatch_json` 里从「带 `method` 且无 `id`」的 JSON-RPC 消息构造；`plugin_id` 由 manifest 盖章写入，**不取自载荷**。会话→host 中继与 Tauri emit 复用同一个结构体，因此 camelCase 字段名是整条链路的线契约 | plugin->host | producer 侧无权限要求；`host.events` 只 gate UI 转发 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:57；构造点 runtime.rs:646 |
| `dispatch_json` 通知路由 | `method` 存在且无 `id` → `PluginEvent{plugin_id, method, params}` → `events.send()` | 插件事件的唯一注入点。数字 `id` 走 pending-response map；字符串 `id` + `host/*` method 走 Host API handler；其余必须带 `method` | plugin->host | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:642、:651 |
| `validate_protocol_name` | 非空、≤256 字节、字符集 `[A-Za-z0-9._:/-]` | 对每个非 legacy 事件 method（以及 host→plugin 的 notify/invoke 名）校验。**非法 method 会让整条 stdout 读循环失败，而不只是丢弃该帧**。legacy manifest（无 `manifest_version`）跳过校验并走 banner 容错解析 | plugin->host | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:1025，调用点 :644；legacy 分支 :916-925 |
| 畸形帧终止会话 | `"Plugin '<id>' sent a protocol message without id or method"` → 读循环返回 Err → `status = Exited(message)` | 插件输出的协议级错误是致命的：`fail_pending` 清空全部在途请求、关闭 prompts、进程仍存活则 kill | plugin->host | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:654；终态处理 :550-567；`terminate_after_output_end` 追加 `"; process terminated by host"` :601 |
| 非 legacy 插件必须先声明 `jsonrpc: "2.0"` | 否则整条读循环报错 | 与校验同源的硬门槛，注意别把它当成「兼容的旧字段」 | plugin->host | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:612-615 |
| `PluginNotification`（host→plugin 通知线） | `{ jsonrpc:"2.0", driver?: string /* skip_serializing_if None */, method: string, params: Value }` | `PluginEvent` 的镜像：host→plugin 通知信封，由 SDK 的 `notify()` / `window.dbxPlugin.notify()` 产生。`driver` 是宿主为自身连接调用提供的可选路由提示。`notify()` 先 `ensure_running()`，因此向已停止会话发通知返回 `Err` 而不是排队 | host->plugin | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:147；写入点 :326；UI 入口 src-tauri/src/commands/plugins.rs:335-342 |

命名约定：事件 method 采用 `<plugin-namespace>/<event>`，由 `validate_protocol_name` 约束（`sample/progress` 是运行时测试里用来验证这一约定的例子，见 5.2）。

### 5.2 实际出现的每一个 `method` 取值及其触发源

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `ssh/session/state` | `params = { state?: string, connectionId?: string }`，宿主只对 `state === "disconnected"` 反应 | DBX UI 自身唯一解释的后端事件：SSH 插件会话死亡时把侧栏连接翻成离线，而不做完整的 disconnect/teardown，见 5.4 的 UI 反应说明。它直接在 `dbx-plugin-event` 上被监听，绕过任何插件 iframe；插件要让自己 UI 也看到该事件才需要声明 `host.events` | plugin->host->ui | `host.events`（仅对插件自身 UI 生效；shell 侧无条件） | apps/desktop/src/composables/useTauriEvents.ts:76；反应 apps/desktop/src/stores/connectionStore.ts:4462 |
| `sample/progress`（仅测试） | `params = { value: 50 }` | 运行时测试 sidecar 发出的 id-less 通知，用来证明并发请求在途时事件广播仍然送达 | plugin->host | 测试 manifest 里声明 `host.events` | crates/dbx-plugin-runtime/src/plugins/runtime.rs:1639（断言 :1682，manifest :1657） |
| `host.stream.chunk` | `params = { streamId: string, dataBase64: string }` | 流式响应的数据帧，见 5.6 | plugin->host->ui | `host.events` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:752、:746 |
| `host.stream.end` | `params = { streamId, ...metadata }` | 终止帧，见 5.6 | plugin->host->ui | `host.events` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:766、:757 |
| `host.stream.error` | `params = { streamId, message?: string }` | 失败帧，见 5.6 | plugin->host->ui | `host.events` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:762 |
| `host.download.progress` | `params = progress`（不透明，来自 native `Channel`） | 由**宿主自己**合成的 bridge 事件帧（`type:"event"`, `method:"host.download.progress"`），`downloadFile` 实现把每条 native 进度消息转成一个事件帧。它以普通 `event` 帧投递，插件在 `onEvent()` 里收到 | **host->plugin**（不是 host->ui） | 除 `capabilities.downloadFile` 外无额外权限 | apps/desktop/src/lib/plugins/pluginHostBridge.ts:324 |

> 方向更正：`host.download.progress` 的原始条目标为 `host->ui`，这是错的 —— 该帧由宿主侧 bridge 投递进插件 iframe，机制与同样被标为 host->plugin 的 `dbx-plugin-context` 完全一致，且条目自己的描述里就写着「插件在 `onEvent()` 里收到」。本手册按 `host->plugin` 记。

注意：`host.stream.*` 与 `host.download.progress` 是**插件作者自行实现的生产端**，DBX 仓库里没有任何代码发出 `host.stream.*`（全仓 grep 只命中消费者与 dev-host 的浏览器 bridge）。也就是说，除了 `ssh/session/state` 这类约定方法外，事件 method 空间完全由插件自定。

### 5.3 二进制通道：`PluginBinaryMessage` 与 channel

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `PluginBinaryMessage` | `{ plugin_id: String, channel: String, data: Bytes }`，无 serde derive（纯进程内） | 从 `FRAME_KIND_BINARY` sidecar 帧解码出的一帧二进制。从不直接序列化：Tauri 层与 SSE 层各自重新编码（base64 + camelCase）。`data` 是帧中 2 字节 channel 长度前缀之后的 `Bytes` 切片，因此载荷相对读缓冲是零拷贝 | plugin->host | `host.binary` | crates/dbx-plugin-runtime/src/plugins/runtime.rs:65 |
| `dispatch_binary` 线帧布局 | `u16 BE channel_len ‖ channel bytes（UTF-8，无空白，1..65535）‖ data` | 帧解析失败（实际短于声明的 channel 长度，或 channel 非 UTF-8）会让读循环失败，与畸形 JSON 帧同样致命 | plugin->host | `host.binary`（UI 侧） | crates/dbx-plugin-runtime/src/plugins/runtime.rs:661；校验 :1015-1023 |
| 二进制帧读取上限 | `MAX_BINARY_MESSAGE_BYTES + 1024` | 多出的 1024 字节正是为 channel 前缀留的空间 | plugin->host | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:942 |
| `dbx-plugin-binary`（Tauri 事件） | `payload = { pluginId, channel, dataBase64 }` | 二进制 sidecar 帧被 base64 编码成 camelCase 载荷，在 JSON 事件流之后由**另一条** bridge task emit | host->ui | emit 侧无权限；`host.binary` gate 其进入 iframe | src-tauri/src/commands/plugins.rs:170、:175；载荷结构体 :141 |
| `send_binary`（host→plugin） | `channel: &str, data: &[u8]` → 若 `transport != StdioFramed` 返回 `Err` | 二进制在 stdio-jsonl 上不可能实现，因此宿主→插件二进制发送显式报错，而不是污染行协议。对 UI 暴露为 `send_plugin_binary`（base64 入） → `PluginHost::send_binary` | host->plugin | `host.binary` | crates/dbx-plugin-runtime/src/plugins/runtime.rs:333；stdin 帧写入 :349-354；Tauri 命令 src-tauri/src/commands/plugins.rs:344-355 |
| 二进制尺寸上限 | sidecar 64 MiB（`MAX_BINARY_MESSAGE_BYTES`）；JSON 8 MiB（`MAX_JSON_MESSAGE_BYTES`）；legacy JSONL 行 64 MiB（`MAX_JSON_LINE_BYTES`）；**UI bridge 8 MiB** | sidecar 通道允许 64 MiB，但 workbench bridge 在过 `postMessage` 之前就拒绝超过 8 MiB 的帧，**插件 UI 必须自行分片**。base64 请求载荷另有上限：`2 × MAX_BRIDGE_PAYLOAD_BYTES` 字符 | n/a | `host.binary` | crates/dbx-plugin-runtime/src/plugins/runtime.rs:44；apps/desktop/src/lib/plugins/pluginHostBridge.ts:10；:1015 |

### 5.4 会话状态事件及其 UI 反应

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `PluginSessionState` | `Starting \| Running \| Stopping \| Stopped \| Exited`，`serde(rename_all = "snake_case")` | sidecar 会话的五个生命周期状态；snake_case 序列化正是前端 `ActivePluginSession` union 所镜像的东西。**没有 `error` 状态**：启动失败返回 `Err`，崩溃落到 `Exited` 并带 message | host->ui | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:73；前端镜像 apps/desktop/src/types/database.ts:665 |
| `PluginSessionStatus` | `{ state: PluginSessionState, message?: string /* skip_serializing_if None */ }` | 会话 watch channel 上携带的状态：`state` 加一个可选的人类可读原因（kill 错误、退出码、输出流关闭） | host->ui | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:83 |
| `ActivePluginSession` | `{ pluginId: string, processId: number \| null, state: PluginSessionState }` | 一个运行中 sidecar 的快照，由 `list_active_plugins` / `activate_plugin` 返回。**这是会话状态抵达 webview 的唯一通道** | host->ui | 无 | crates/dbx-plugin-runtime/src/plugins/host.rs:20；命令 src-tauri/src/commands/plugins.rs:303 |
| Running 转换 | `Starting → Running`（无 message），在握手成功后；若此时状态已离开 `Starting`，会话以 `"stopped during initialization"` 关停 | `Running` 只在 `initialize()` 成功后（legacy manifest 则立即）发布，这正是 `activate()` 可以被 await 当作同步点使用的原因 | host->ui | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:262；失败路径 :265-273；初始值 `Starting` :227 |
| `Stopping` / `Stopped` | `Stopping`（无 message） → `Stopped`（message = kill 错误或 `None`） | `shutdown()` 先发 `Stopping`，让在途的 exit handler 能区分「有意停止」与「崩溃」并跳过 `Exited` 写入 | host->ui | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:358、:364；竞态守卫 :557-559 |
| `Exited` | `Exited(message)`，message ← `exit_message()` 或读错误，随后 `terminate_after_output_end()` | stdout reader 的终态路径：无 stop 的 EOF 变成 `Exited`，message 区分「exited with status X」「closed its output stream」或原始读错误。写状态之前先 `fail_pending` 用同一 message 清空全部在途请求 | host->ui | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:565；message 来源 :588-594；fail_pending :554 |
| 无推送通道（能力缺口） | `PluginHost::list_active(&self) -> Vec<ActivePluginSession>`，由 `list_active_plugins` 提供；`subscribe_status()` 只存在定义、`runtime.rs` 之外无任何调用 | 会话生命周期变化（exited/stopped）**从不同步抵达 webview**：唯一暴露面是 `list_active_plugins` 命令，而前端的 `listActivePlugins`/`activatePlugin`/`stopPlugin` 包装在 apps/desktop 里零调用点。想显示「插件崩溃了」的 UI 只能轮询，而今天没有任何东西在轮询 | host->ui | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:289；无调用者的包装 apps/desktop/src/lib/backend/tauri.ts:2454 |

> 两处更正必须落在正文：
> 1. `PluginSessionStatus` 的 `message` **从未被序列化到任何 UI 表面**。`ActivePluginSession` 只携带 `state: PluginSessionState`（crates/dbx-plugin-runtime/src/plugins/host.rs:23），全仓 grep 显示 `PluginSessionStatus` 只出现在 runtime.rs（定义 + watch）与 crates/dbx-plugin-runtime/src/plugins.rs:57 的一处 re-export。kill 错误 / 退出原因只存在于进程内 —— 这使「无推送路径」这一结论比原描述更强。
> 2. `ActivePluginSession.processId` 是**普通 `Option<u32>`，没有 `skip_serializing_if`**（host.rs:22），因此无 pid 时 serde 仍然发出 `"processId": null` —— 键始终存在。`processId?: number` 描述的是手写 TS 接口（apps/desktop/src/types/database.ts:664），不是 serde 的真实输出。原条目第二条证据路径 `crates/../src-tauri/src/commands/plugins.rs:303` 是畸形路径，正确路径为 src-tauri/src/commands/plugins.rs:303。

UI 反应侧：宿主对会话状态本身没有反应代码；唯一被 `dbx-plugin-event` 直接消费并驱动 UI 的是 5.2 里的 `ssh/session/state`，它在状态为 `disconnected` 时调用 `markConnectionOffline(connectionId)` 把侧栏连接标记离线，而不做完整断连（apps/desktop/src/composables/useTauriEvents.ts:76；apps/desktop/src/stores/connectionStore.ts:4462）。

### 5.5 安装 / 升级 / 开标签页生命周期事件

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `plugin-runtime-replaced` | `payload = { pluginId: string, version: string }` | 在 `install_marketplace_plugin`、`install_plugin_package`、`install_plugin_package_from_url`、`rollback_plugin` 之后发出，让已打开的工作台标签重载新 UI bundle 而不是继续展示旧版 | host->ui | 无 | src-tauri/src/commands/plugins.rs:515；emitter 调用点 :127、:204、:232、:251 |
| `plugin-runtime-replaced` 消费端 | `listen<{pluginId, version}> → deps.refreshPluginWorkbenches(pluginId)` | App 级监听器把 id 路由到该插件所有已挂载 workbench 标签的重挂载；每个标签 `refresh()` 重新拉 `listPlugins`，宿主的 version watch 重建 sandbox iframe。`refreshPluginWorkbenches` 按 `pluginWorkbench.pluginId` 过滤，因此只重载被替换插件的标签 | host->ui | 无 | apps/desktop/src/composables/useTauriEvents.ts:176；apps/desktop/src/App.vue:3522 |
| `plugin-url-download-progress` | `payload = { downloaded: number, total: number \| null }` | 从 marketplace `install_url_package` 的进度回调流出，`.<dbxp>` 从 URL 下载期间逐段上报；服务端不发 `Content-Length` 时 `total` 为 `null` | host->ui | 无 | src-tauri/src/commands/plugins.rs:222；监听 apps/desktop/src/components/plugins/PluginContributionsPanel.vue:705 |
| `agent-install-progress`（plugin 路径） | `payload = AgentProgressEvent`（`DriverInstallProgress`） | `install_jdbc_plugin` 把 JDBC 引导进度并进共享的 `agent-install-progress` 事件，使 JDBC 插件的安装与 agent driver 走同一通道 | host->ui | 无 | src-tauri/src/commands/plugins.rs:652；监听 apps/desktop/src/lib/backend/tauri.ts:2732 |
| `agent-install-progress`（driver 路径，第二个生产端） | `payload = AgentProgressEvent`，agent 路径上附带 `operationId` | 同一事件名也被普通 agent driver 安装发出，并携带 operation id。按事件名过滤的消费者会同时看到两个生产端；进度载荷形状是共享的。**只有 agents.rs 路径会填 `operationId`** | host->ui | 无 | src-tauri/src/commands/agents.rs:313；对比 plugin 路径 src-tauri/src/commands/plugins.rs:653 |
| `dbx-open-plugin-install-links` | `payload = string[]`（deep-link URL） | `dbx://plugin/install?url=...` 的 OS deep-link 投递；前端把第一条尚未消费的链接转成确认对话框，然后调用 `installPluginFromUrl` | host->ui | 无 | src-tauri/src/lib.rs:711；消费 apps/desktop/src/composables/useTauriEvents.ts:158 |
| `mcp-open-connection-workbench` | `payload = { connection_id: string }`（**snake_case**，与插件事件的 camelCase 不同） | MCP bridge 在某 agent 工具要求打开连接的插件工作台时发出；UI 解析配置后调用 `queryStore.openPluginConnection(connection_id)`，该函数去重标签页并在返回前确保 sidecar/PTY 会话存在。它是唯一由外部驱动打开插件工作台标签的路径。有意**不聚焦窗口**，以免 agent 终端调用抢走 OS 焦点 | host->ui | 无 | src-tauri/src/commands/mcp_bridge.rs:1399；消费 apps/desktop/src/composables/useTauriEvents.ts:52（不聚焦的注释 :61-63） |

两个必须写明的限制：
- `uninstall_plugin` **不**发 `plugin-runtime-replaced`（src-tauri/src/commands/plugins.rs:255-291）—— 被移除插件的已打开标签永远收不到通知。
- `plugin-url-download-progress` 的监听器只在单次 `installUrl` 调用期间注册，并在 `finally` 里拆除（apps/desktop/src/components/plugins/PluginContributionsPanel.vue:715）。
- `dbx-open-plugin-install-links` 的安装请求 watcher 会防护重复处理已经处理过的 id（PluginContributionsPanel.vue:855-868）。

### 5.6 stream 事件：`host.stream.chunk` / `host.stream.end` / `host.stream.error`

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `host.stream.chunk` | `params = { streamId: string, dataBase64: string }` | 流式响应的一帧数据。SDK 的 `stream()` 辅助函数注册一个 `onEvent` 监听器、按 `streamId` 过滤、base64 解码后写进 `ReadableStream`；**只有开场的 `backend.invoke` resolve 之后**该 stream 才 resolve | plugin->host->ui | `host.events`（未声明则完全不转发） | apps/desktop/src/lib/plugins/pluginHostBridge.ts:752（过滤）、:746（enqueue） |
| `host.stream.end` | `params = { streamId, ...metadata }` —— 每个多余字段都被 `Object.assign` 进 stream 的 metadata 对象 | 终止帧：移除监听器、把载荷合并进返回的 `metadata`、关闭 `ReadableStream`。`metadata` 以 `{ stream, metadata }` 返回给调用者。它也是插件在 open 调用之后上报 size/ETag 的唯一途径 | plugin->host->ui | `host.events` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:766（`Object.assign(metadata, event);`）、:757（`controller.close();`） |
| `host.stream.error` | `params = { streamId, message?: string }` | 失败帧：reject 在途的 open promise，并以 `new Error(event.message \|\| 'Plugin stream failed')` 让 stream controller 进入 error | plugin->host->ui | `host.events` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:762 |
| 取消路径 | `backend.invoke(closeMethod, { streamId })`，`closeMethod` 默认 `'filesystem/stream/close'` | `stream().cancel()` 只触发一次 close 调用，错误被吞掉 | plugin->host | `host.events` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:784 |
| SDK `stream()` 辅助函数 | `stream(method, params = {}, { streamId?, closeMethod? = 'filesystem/stream/close', timeoutMs? }) → Promise<{ stream: ReadableStream, metadata }>` | `window.dbxPlugin.stream` 的客户端半边：发送带额外 `streamId` 的 `backend.invoke`，把匹配的 `host.stream.*` 事件转成 `ReadableStream` | plugin->host | `host.events`（必须转发事件，chunk 才会到达） | apps/desktop/src/lib/plugins/pluginHostBridge.ts:740 |

> 锚点更正：`host.stream.end` 的两条引用各偏了一行。决定性行是 apps/desktop/src/lib/plugins/pluginHostBridge.ts:766（`Object.assign(metadata, event);`）与 :757（`controller.close();`）；原条目引的 :757 与 :758 中，:758 实际是闭合花括号 `}`。行为描述正确，锚点不对。

实现现状：Rust 或 Go SDK 里**没有生产端对应物**，因此每个做流式的插件都必须自己实现 `host.stream.*` 的发出侧。

### 5.7 拖放文件事件与文件句柄元数据

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `dbx:tauri-file-drop`（webview 级载体） | `detail = { type: "enter" \| "over" \| "drop" \| "leave", paths?: string[], position?: { x: number; y: number } }` | 带真实文件的 HTML5 drop 事件永远到不了 web 内容（尤其是插件 iframe），因此 webview 级的 Tauri 事件被重新 dispatch 进页面，每个 surface 自行对外观坐标做 hit-test | ui->host | 无 | apps/desktop/src/composables/useFileDrop.ts:50；插件消费 apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:561，:319 的 `event.preventDefault()` 认领 drop，阻止宿主「以数据库方式打开」的兜底逻辑 |
| `filedrop` 帧 + `PluginFileHandleMeta` | `type:"filedrop", files: [{ handleId: string, name: string, size: number, contentType: string }]` | OS 拖入的路径由宿主打开成读句柄，以**已打开的句柄**交给插件；插件永远看不到文件系统路径。只对落在本工作台 iframe 内的 drop 触发 —— 宿主对物理落点做 hit-test | host->plugin | 无（触发凭据就是 drop 手势本身） | apps/desktop/src/lib/plugins/pluginHostBridge.ts:301；形状 :57；hit-test PluginWorkbenchHost.vue:318 |
| `dragstate` 帧 | `type:"dragstate", active: boolean` | 告诉插件当前是否有 OS 拖拽位于其工作台之上，以便显示 drop 覆盖层；在 enter/over 时置位，在 leave/drop 以及落点离开 iframe 矩形时清除 | host->plugin | 无 | apps/desktop/src/lib/plugins/pluginHostBridge.ts:296；状态机 PluginWorkbenchHost.vue:303-328 |

`dropDragActive` 用于防止重复的 `true`/`false` 帧。插件中心另注册自己的监听器来接收 `.<dbxp>` 拖入（PluginContributionsPanel.vue:880）。

### 5.8 theme / locale / context 推送事件

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `dbx-plugin-init`（DOM `CustomEvent`） | `detail = { source, version, type:"init", pluginId, contributionId, locale, theme?, permissions, capabilities:{downloadFile,planApi,storage,ai}, context }` | init 帧 dispatch 在 `document` 上（**不是 window**），携带身份、权限、能力声明、theme 与初始 workbench context；参考插件用它拿到自己的 `contributionId` 与 result-view 载荷 | host->plugin | 无 | apps/desktop/src/lib/plugins/pluginHostBridge.ts:876；消费方参考插件 frontend/src/host.ts:46 |
| `dbx-plugin-context`（DOM `CustomEvent`） | `detail = PluginWorkbenchContext { connectionId?, database?, schema?, values?, [key: string]: unknown }` | 在 workbench context 的每次 prop 变化时推送，**不重建 iframe**，因此插件 UI 状态能跨导航存活；同时更新 SDK 的 `window.dbxPlugin.context` | host->plugin | 无 | apps/desktop/src/lib/plugins/pluginHostBridge.ts:266；触发方 PluginWorkbenchHost.vue:580-584 的 deep watch |
| `dbx-plugin-env`（DOM `CustomEvent`） | `detail = { type:"env", locale: string, theme?: PluginBridgeTheme { appearance, tokens, editor? } }` | locale 与 theme 推送共用一个帧类型；SDK 更新 `locale`、把 theme token 重新应用到 document root，并触发 `listeners.event` 及该 CustomEvent | host->plugin | 无 | apps/desktop/src/lib/plugins/pluginHostBridge.ts:278；消费方参考插件 frontend/src/useHostSession.ts:61 |
| `dbx-plugin-event` / `dbx-plugin-binary` / `dbx-plugin-filedrop` / `dbx-plugin-dragstate`（DOM `CustomEvents`） | `event → { method, params }`；`binary → { channel, data: Uint8Array }`；`filedrop → PluginFileHandleMeta[]`；`dragstate → boolean` | 每种 bridge 帧类型都镜像为 document CustomEvent，使插件可以在 SDK 辅助函数之外监听；SDK 同时维护 `onEvent`/`onBinary`/`onDrop`/`onDragState` 监听器集合 | host->plugin | **更正**：只有 `event` 受 `host.events` 门控、`binary` 受 `host.binary` 门控；**`filedrop` 与 `dragstate` 没有任何权限门**。原先填的"`host.events` / `host.binary` 在帧被 post 之前分别 gate"以及引用的 `:877/:885/:889/:881` 都不成立——那四行是沙箱侧收到消息后的 `document.dispatchEvent`，其中没有权限检查。真正的门在**发送侧**：`forwardEvent`（`:278-280`）与 `forwardBinary`（`:283-286`）各查一次 `hasPermission`，而 `forwardDragState`（`:291-293`）与 `forwardFileDrop`（`:298-300`）根本没查。调用点 `PluginWorkbenchHost.vue:298-340` 也只判断"光标是否落在本插件 iframe 上"，不查权限。**结论：任何有 workbench 标签页的插件，即使一条权限都没声明，也能收到 filedrop / dragstate**（§5.7 与 §3.6 的 `none` 是对的，本行原先是错的） | 发送侧：apps/desktop/src/lib/plugins/pluginHostBridge.ts:281-283（event，有门）、:283-286（binary，有门）、:291-293（dragstate，无门）、:296-298（filedrop，无门）；沙箱侧 dispatch：:877、:881、:885、:889 |

必须写明的三点：
- **init 的 dispatch 目标**：`document.dispatchEvent` 与裸 `dispatchEvent`（后者落在 window）不是一回事 —— 这里是一处真实修复过的 bug，插件必须监听 `document`（apps/desktop/src/lib/plugins/pluginHostBridge.ts:876）。
- **身份变化会强制重建 iframe**：`pluginId`/`version`/`contributionId` 变化走完整 iframe 重建，只有 context 值变化才走轻量 context 推送（PluginWorkbenchHost.vue:576-579 vs :580-584）。
- **env 的触发面**：`updateTheme` 在 themeRevision 自增、以及显式的 font-size / syntax-theme watch 上触发（PluginWorkbenchHost.vue:589-596）。
- **`host.events` 缺失时插件一个事件帧都收不到** —— gate 发生在 `forwardEvent`，不在 SDK 侧（pluginHostBridge.ts:282）。
- **参考插件（Excalidraw）的实际消费面极窄**：它从不调用 `onEvent`/`onBinary`/`sendBinary`/`fileTransfer`，只消费 init/context/env 三种帧，并从 init detail 里恢复 `contributionId` 和 result-view 载荷；它还通过读 `window.dbxPlugin.context` 来补救错过的 init（因为 init 是同步 dispatch 的，而懒求值的模块可能还没挂上监听器）（参考插件 frontend/src/host.ts:46、:79-92；frontend/src/useHostSession.ts:61）。

### 5.9 用户输入类事件（`host/requestUserInput` 及其 UI 落地）

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `host/requestUserInput` | `params = { prompt: string (必填, ≤2000), title?: string (≤200), default?: string (≤1000), echo?: bool (默认 false), options?: [{value,label}] (≤8, 唯一, 各 ≤200), timeoutSecs?: number (钳制 5–600, 默认 300) }`；`result = { action:"submit", value } \| { action:"cancel" } \| { action:"timeout" }` | **插件唯一被允许回调宿主的方法**；宿主把问题转给 UI 并原样返回用户输入，从不合成答案 | plugin->host | 无显式声明；能力门控来自 `host.features` 是否宣传 `host.requestUserInput` | crates/dbx-plugin-runtime/src/plugins/runtime.rs:26；dispatch :700-703；边界 :804-871 |
| `host/requestUserInput` 错误码 | `-32001` 无 UI 连接 / `-32002` 打开的 prompt 过多 / `-32601` 方法不存在 / `-32602` 参数非法 | 无头宿主（MCP、测试）会立即让 prompt 失败，使插件可以降级而不是挂死；插件应按 code 分支。**dismiss/timeout 不是错误**，它们以 `{action:"cancel"}` / `{action:"timeout"}` 返回 | host->plugin | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:731；错误码 :719、:783、:786；cancel/timeout 路径 :742-749 |
| prompt 并发上限与 deadline 暂停 | `MAX_PLUGIN_PROMPTS_IN_FLIGHT = 4`、`MAX_PROMPT_PAUSE = 600 s`、`USER_INPUT_DEFAULT_TIMEOUT = 300 s`、`MIN 5 s`、`MAX 600 s` | prompt 打开期间 `await_response` 停止把流逝时间计入请求 deadline，最后一个 prompt 结束时恢复；超过 `MAX_PROMPT_PAUSE` 则请求以 `"was waiting for user input for more than N seconds"` 失败。这正是让 MFA 验证码可以被输入而不触发 `connection/test` 更短超时的机制 | plugin->host | 无 | crates/dbx-plugin-runtime/src/plugins/runtime.rs:32；暂停循环 :462-482；相关测试 :1371-1393 |
| `ssh-prompt` | `payload = SshPromptRequest { id, kind, host, port, key_type?, fingerprint?, previous_fingerprint?, prompt?, echo, source?, title?, default_value?, options }` | 插件的用户输入请求最终落到这里，`kind=UserInput` 且 `source` 被写成插件显示名，使对话框能在视觉上区分堡垒机登录提示与宿主自有的提示 | host->ui | 无 | src-tauri/src/commands/ssh_prompt.rs:184；`source` 盖章 crates/dbx-plugin-runtime/src/plugins/runtime.rs:726 |
| `ssh-prompt-dismiss` | `payload = string`（prompt id） | 两个生产端：5 秒 sweeper 回收那些 oneshot responder 已被丢弃的 prompt（后端超时/取消），以及 emitter 自身在投递失败时。UI 据此关闭孤儿对话框 | host->ui | 无 | src-tauri/src/commands/ssh_prompt.rs:153、:186 |
| `ssh-host-key-notice` | `payload = SshHostKeyNotice` | 带外 host-key 事件（密钥变化 → 可能 MITM，或用户拒绝了密钥）从 dbx-core notice gateway 转发过来，让 UI 能解释连接为何失败 | host->ui | 无 | src-tauri/src/commands/ssh_prompt.rs:172；安装点 src-tauri/src/lib.rs:1683 |

Tauri 事件**不会**为迟到的监听器重放，所以 bridge 会把请求排队直到对话框调用 `ssh_prompt_ready`（src-tauri/src/commands/ssh_prompt.rs:119-122、:192-197）。停止插件会话会关闭所有打开的 prompt（crates/dbx-plugin-runtime/src/plugins/runtime.rs:360 `self.prompts.close()`），从而丢弃 responder 并触发上述 sweep。

### 5.10 桥接控制帧、握手与 dev-host 工具链事件

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `ready` 握手 | `{ source: "dbx-plugin", version: 1, type: "ready" }` | 注入的 SDK **在 IIFE 求值时恰好发一次**（不响应任何 load 信号）。宿主 bridge 把 `load` + `ready` 视为一代完成，重置 init 状态、取消在途下载并自增 generation，使过期的异步 reinit 永远无法投出过期 init | plugin->host | 无 | apps/desktop/src/lib/plugins/pluginHostBridge.ts:910；generation 逻辑 :194-221 |
| `closeTab` 快捷键 | `{ type: "shortcut", shortcut: "closeTab" }`，在无修饰键的 Ctrl/Cmd+W 上发出 | 让沙箱化 workbench 能响应标准关标签快捷键（iframe 自己做不到）；宿主把它路由到 `api.closeTab`。SDK 在捕获阶段吞掉 keydown 并 `stopPropagation()`，因此插件 UI 自己看不到这个按键 | plugin->host | 无 | apps/desktop/src/lib/plugins/pluginHostBridge.ts:908；处理 :177-180 |
| bridge response 帧 + 单请求载荷上限 | `type:"response", id, result? \| error?`；请求 params 上限 `MAX_BRIDGE_PAYLOAD_BYTES = 2 MiB` JSON | 每个请求恰好被回答一次，按调用方的字符串 id 匹配；超限的请求参数在 dispatch 之前就被拒绝 | host->plugin | 无 | apps/desktop/src/lib/plugins/pluginHostBridge.ts:509；上限 :1030-1031 |
| dev-host 浏览器 bridge | `installBridge(channel)` 暴露 ready/context/locale/theme/request/invoke/stream/notify/sendBinary/readAsset/openWorkbench/openFilesystem/reopenConnection/copy/storage/onContext/onEvent/onBinary/onInit | 本地 dev host 把同一份 bridge 源码序列化进 sandbox 并自行应答 bridge 请求；sidecar 事件经 SSE 拉取后以 `{...m, binaryChannel: m.channel}` 重投到每个 frame | host->plugin | 需要 `manifest.permissions` 含 `host.events` / `host.binary` | plugins/sdk/dev-host/browser-bridge.mjs:2；SSE fan-out plugins/sdk/dev-host/ui/App.vue:390；权限检查 plugins/sdk/dev-host/server.mjs:158、:161 |
| dev-host SSE 诊断/状态事件 | `page-frames \| status \| diagnostic \| diagnostic-history \| connections \| ui-rebuilt \| auto-reload \| auto-reload-error \| frames-removed \| watch-error \| event \| binary` | 调试宿主自己的控制通道：后端状态变化、构建诊断、auto-reload 结果、frame 归属；它也承担背压处理（`writableLength` 超过 16 MiB 的流会被销毁） | host->ui | 无 | plugins/sdk/dev-host/server.mjs:141；消费 plugins/sdk/dev-host/ui/App.vue:367-391 |

> `ready` 握手的更正（必须按更正后写）：原条目称「在求值时立即发一次，并在宿主每次 `load` 信号时再发一次」，这是**错的**。注入的 SDK 只在 IIFE 求值时发一次 `ready`（apps/desktop/src/lib/plugins/pluginHostBridge.ts:910），从不因 `load` 信号而重发。`load` 是宿主侧 init 信号 —— `sendInit()`（:190）调用 `requestInit("load")`，只负责自增 generation；插件的 `ready` 来自它自己在 iframe（重）载后的求值。只有 dev-host 模拟会重发 `ready`（每 200 ms）。
>
> dev-host 的两个已知偏差同样要写：它对二进制施加 `UI_BINARY_LIMIT` 并**丢弃**超大帧而不是分片；它每 200 ms 重试 ready 握手直到 init 到达。dev-host 把后端状态 `"failed"` 记为 error 诊断并清空已连接连接（plugins/sdk/dev-host/server.mjs:150-156）。

### 5.11 背压与丢失行为

链路上有**四段彼此独立的丢弃/滞后点**，插件作者无法从插件侧观测到任何一段：

| 环节 | 容量 / 行为 | 说明 | 方向 | 证据 |
|---|---|---|---|---|
| 会话级事件广播 | `broadcast::channel(256)`（`PluginEvent`）、`broadcast::channel(64)`（`PluginBinaryMessage`） | 每个 `PluginSidecarSession` 自持一个 256 槽事件环与 64 槽二进制环；落后于读指针的订阅者会丢失最老的帧并收到 `RecvError::Lagged`。`send()` 的失败被忽略，因此**零订阅者时发出的事件被静默丢弃** | plugin->host | crates/dbx-plugin-runtime/src/plugins/runtime.rs:225、:226；send 失败忽略 :651、:674 |
| host 级广播 + `skipped N events` 日志 | `broadcast::channel(512)`（事件）、`broadcast::channel(128)`（二进制）；命中 `Lagged(skipped)` → `log::warn!` | `PluginHost` 把每个会话的事件扇入一条 512 槽通道（二进制 128），由 Tauri bridge、web SSE 路由与任何 embedder 订阅。**中继任务记录日志后继续运行 —— 被跳过的事件是丢失，不会重放**。两跳意味着最多两个独立滞后窗口：session→host 中继，然后 host→消费者 | plugin->host | crates/dbx-plugin-runtime/src/plugins/host.rs:85；`"Plugin host event relay skipped {skipped} events"` :392（二进制变体 :408） |
| 桌面 bridge 滞后日志 | `Err(RecvError::Lagged(skipped))` → `log::warn!("Desktop plugin event bridge skipped {skipped} events")` | 若面向 webview 的任务跟不上 512 槽宿主通道（例如 Tauri 主循环上的一次慢 emit），帧被丢弃且**只留一行日志 —— 插件 UI 永远不知道自己漏了事件**。这里 `emit()` 的返回值同样被丢弃，因此投递失败与成功无法区分 | host->ui | src-tauri/src/commands/plugins.rs:157（二进制变体 :178） |
| web SSE `lagged` 帧 | `#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]` → `Event{pluginId,method,params} \| Binary{pluginId,channel,dataBase64} \| Lagged{skipped}` | `/api/plugins/events` SSE 路由把滞后**显式**表达成 `{kind:"lagged", skipped}` 帧，而不是隐藏它 —— 这是四段里唯一一处把丢失暴露给消费者的地方。但 web 客户端把它解析进 union 类型后**什么都不做**（apps/desktop/src/lib/backend/http.ts:709-710） | host->ui | crates/dbx-web/src/routes/plugins.rs:571；枚举定义 :166 |

Tauri 事件（`dbx-plugin-event` / `dbx-plugin-binary`）与 webview 之间没有队列语义，emit 失败同样被丢弃：`let _ = app_handle.emit(...)`（src-tauri/src/commands/plugins.rs:154、:175）。

### 5.12 事件权限与信任边界

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| 权限字符串清单 | `"host.events"`、`"host.binary"`、`"host.workbench"`、`"host.filesystem"`、`"host.plans:read"`、`"host.storage"`（另有 `host.network:<origin>`） | 事件与二进制的转发 gate 在 **bridge 里，而不是后端**：`forwardEvent`/`forwardBinary` 只有在 manifest 声明了匹配权限**且**事件的 `pluginId` 等于本工作台的插件时才继续，否则静默返回 | declarative | `host.events` | crates/dbx-plugin-runtime/src/plugins/manifest.rs:25；gate apps/desktop/src/lib/plugins/pluginHostBridge.ts:282 |
| `backend.sendBinary` 的第二道检查 | 未声明时错误文案为 `"Plugin has not declared permission 'host.binary'"` | 除转发 gate 之外的显式报错路径 | plugin->host | `host.binary` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:356、:491 |
| `host.events` 不 gate DBX shell 消费者 | 转发 gate：`event.pluginId === manifest.id && hasPermission("host.events")`；DBX shell 监听器：**无条件** | `host.events` 只在插件 iframe 边界生效。DBX 应用自身对原始 `dbx-plugin-event` Tauri 事件的监听器没有 pluginId 也没有权限过滤，因此**每个已安装插件的事件都会到达 shell UI，无论它声明了什么权限** | declarative | `host.events` | apps/desktop/src/lib/plugins/pluginHostBridge.ts:282 vs apps/desktop/src/composables/useTauriEvents.ts:73（无过滤） |
| web SSE 插件事件流未过滤 | `GET /api/plugins/events` → 512/128 槽宿主广播里的每一条 `PluginEvent` 与 `PluginBinaryMessage` | web 变体直接订阅宿主级广播并把每个事件与二进制帧序列化给 HTTP 客户端；**没有按插件或按权限的过滤**，与原生 iframe 路径（按 pluginId + `host.events`/`host.binary` 过滤）不同。任何能触达该 API 的客户端都会收到全部插件的事件与二进制载荷（base64） | host->ui | 路由层无权限检查；`host.events`/`host.binary` 只在投递之后的浏览器 bridge 里检查 | crates/dbx-web/src/routes/plugins.rs:564、:575-578；注册点 crates/dbx-web/src/main.rs:433；客户端 apps/desktop/src/lib/backend/http.ts:705-712 |

后果必须明确写出：一个**完全不声明任何权限**的插件仍可通过 shell 解释的事件方法（如 `ssh/session/state`）驱动 shell 行为，也可以刷爆 shell 监听器；同时 web 端口的任何客户端可以看到所有插件的事件与二进制内容。

## 6. 权限模型

DBX 插件的权限是一份**声明在 `manifest.json` 里的字符串白名单**，不是运行时协商出来的授权。宿主把它当作一张静态能力表读取：安装时校验它是否合法，会话启动时把它回显给插件，UI 侧每次特权调用前用精确字符串比对查这张表。没有任何通配、层级或隐含语义（`crates/dbx-plugin-runtime/src/plugins/host.rs:817`）。

### 6.1 可声明的权限串（封闭集合）

非参数化权限的权威定义是 Rust 常量 `SUPPORTED_PLUGIN_PERMISSIONS`，共 6 个：

```rust
&["host.events", "host.binary", "host.workbench", "host.filesystem", "host.plans:read", "host.storage"];
```
`crates/dbx-plugin-runtime/src/plugins/manifest.rs:25`

| 名称 | 签名/取值 | 解锁什么 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `host.events` | 字符串 `host.events` | 让 workbench UI 收到插件后端事件。Rust 侧无条件中继所有插件事件，桌面桥在权限缺失或 pluginId 不匹配时丢弃 | host→ui | `host.events` | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:282` |
| `host.binary` | 字符串 `host.binary` | 双向二进制帧。桥里检查两次：一次入站推给 UI，一次 UI 的 `backend.sendBinary`。`stdio-framed` 传输方式也要求它 | host→ui \| ui→host | `host.binary` | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:287`；`plugins/sdk/rust/dbx-plugin-sdk/README.md:67` |
| `host.workbench` | 字符串 `host.workbench` | UI 的 `host.openWorkbench` 导航请求（在新宿主标签页里打开自己的另一个 workbench contribution） | ui→host | `host.workbench` | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:372` |
| `host.filesystem` | 字符串 `host.filesystem` | **只**管 UI 的 `host.openFilesystem` 导航请求（请宿主文件管理器打开自己的某个 filesystem provider）。**不**管文件系统 RPC 面 | ui→host | `host.filesystem` | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:385` |
| `host.plans:read` | 字符串 `host.plans:read` | 只读估算执行计划：同时管 `host.getPlanCapabilities` 与 `host.explainPlan` | ui→host | `host.plans:read` | `apps/desktop/src/types/pluginPlan.ts:17` |
| `host.storage` | 字符串 `host.storage` | workbench UI 的按插件持久化 KV 存储，落地为 `plugin-data/<id>/ui-storage.json`；三个方法（get/set/delete）都检查 | ui→host | `host.storage` | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:471` |
| `host.network:<origin>` | 参数化权限，见 6.2 | 为一个 HTTPS origin 打开沙箱 CSP 的 `connect-src` | 声明式 | `host.network:<origin>` | `plugins/manifest.schema.json:34` |

`SUPPORTED_PLUGIN_PERMISSIONS` 与发布出去的 JSON Schema enum 之间有一条逐字节相等的测试断言，所以 schema 和运行时不能各自漂移：`crates/dbx-plugin-runtime/src/plugins/manifest.rs:1635` — `assert_eq!(declared, SUPPORTED_PLUGIN_PERMISSIONS.iter().map(|value| value.to_string()).collect::<Vec<_>>());`。

**计划权限只有这一个作用域。** `host.plans:execute`、`host.plans`、`host.plans:read:all`、`host.plan:read` 在 manifest 校验阶段被显式拒绝，由测试锁定：`crates/dbx-plugin-runtime/src/plugins/manifest.rs:1595` — `for permission in ["host.plans:execute", "host.plans", "host.plans:read:all", "host.plan:read"] {`。

**权限与「provider 能力」是两条不同的授权轴。** 文件系统 RPC 真正的逐操作授权是 `PluginFilesystemCapability`，与 `host.filesystem` 无关：

```rust
pub enum PluginFilesystemCapability { Read, Write, Delete, Rename, Mkdir }
```
（serde kebab-case，线上字符串 `"read"`/`"write"`/`"delete"`/`"rename"`/`"mkdir"`）— `crates/dbx-plugin-runtime/src/plugins/manifest.rs:704`。映射关系：list 不需要能力，read 要 `Read`，write 要 `Write`，mkdir 要 `Mkdir`，delete 要 `Delete`，rename 要 `Rename`。缺能力是硬错误并点名 provider：`crates/dbx-plugin-runtime/src/plugins/filesystem.rs:459` — `if provider.has_capability(capability) {`。这一点值得单独写明，因为 catalog 只是隐约提到。

### 6.2 `host.network:<origin>` 的语法与匹配规则

唯一的参数化权限。签名形态：

```
host.network:https://HOST[:PORT]
```

Schema 正则（`plugins/manifest.schema.json:34`）：
```
^host\.network:https://[A-Za-z0-9._-]+(:[0-9]+)?$
```

规则逐条：

| 规则 | 结论 | 证据 |
|---|---|---|
| 协议 | 只允许 `https://`，`http://` 不接受 | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:43` 起的 `parse_host_network_permission` |
| 路径/查询/片段 | 一律禁止；含 `/`、`?`、`#` 即被拒 | 同上 |
| 通配 | **没有通配语法**。不匹配 `*`，也不匹配前缀 | 正则与解析器均只接受 `[A-Za-z0-9._-]` |
| 子域 | **不匹配子域**，也不被父域匹配。`host.network:https://example.com` 只放开 `example.com` 本身，`api.example.com` 需另声明一条 | 匹配是精确字符串比对 |
| 端口 | 可选数字端口 `[:PORT]`；写了端口就只放开该端口 | `(:[0-9]+)?` |
| 大小写 | **区分大小写**，且不做任何规范化（无 lowercase、无尾点归一） | `parse_host_network_permission` |
| 条数上限 | **每个插件最多 8 个不同 origin** | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:29` — `pub const MAX_PLUGIN_NETWORK_ORIGINS: usize = 8;` |

超限是安装期 manifest 错误，文案 `Plugin declares N network origins; at most 8 are allowed`；TS 侧 CSP builder 收集到 8 条就停止（`pluginNetworkOrigins`，`apps/desktop/src/lib/plugins/pluginHostBridge.ts:527`）。

**两个解析实现，外加一处真实分歧。** Rust 的 `parse_host_network_permission`（`crates/dbx-plugin-runtime/src/plugins/manifest.rs:43`）是权威版本；前端镜像 `pluginNetworkOrigins(permissions)`（`apps/desktop/src/lib/plugins/pluginHostBridge.ts:527`）把声明转成 CSP origin，正则 `^https:\/\/[A-Za-z0-9._-]+(?::[0-9]+)?$`，**不匹配的条目被静默跳过而不报错**，同样在 8 条截断。

分歧点必须写清：Rust 解析器只校验**最后一段**冒号分段是数字（`manifest.rs:54-58`），因此

```
host.network:https://a.example:8443:9000
```

**在 Rust 侧被接受**，而 JSON Schema 正则和 TS 解析器都拒绝它。这是解析器之间的真实不一致，会让「schema 校验通过 = 运行时通过」的假设在这一个边上失效。

另一条容易踩的边：`pluginAssetCspSource(baseUrl)`（`apps/desktop/src/lib/plugins/pluginHostBridge.ts:576`）只认两种 base URL 形态——WebView2 映射的 `http(s)://dbx-plugin.localhost` 精确 origin，和原生 `dbx-plugin:` 自定义 scheme；其他任何形态（例如 `javascript:`）既不给 CSP source，也不注入 `<base>`，插件无法自行放宽资源策略。

### 6.3 没有权限时做不到什么：默认拒绝面

**UI 侧**：没有声明任何 `host.network:` 时，沙箱文档的 CSP 里 `connect-src` 是 `connect-src 'none';`（`apps/desktop/src/lib/plugins/pluginHostBridge.ts:548`，测试锁定在 `pluginHostBridge.spec.ts:773-774`），即 UI 完全不能发起网络请求。iframe 属性为

```
sandbox="allow-scripts" allow="clipboard-write" referrerpolicy="no-referrer"
```
`apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:621`

只有 `allow-scripts`：没有 `allow-same-origin`（opaque origin，`localStorage`/cookie/IndexedDB 直接抛异常）、没有 `allow-forms`、`allow-popups`、`allow-downloads`、`allow-modals`、`allow-top-navigation`。因为 opaque-origin 的 srcdoc 帧无法自行发起下载，宿主才提供 `host.saveFile`/`host.downloadFile` 作为替代（`apps/desktop/src/lib/plugins/pluginHostBridge.ts:404-406`）。

**完全不受权限门控的桥方法**（即"默认拒绝面"的反面，必须显式知道）：

| 方法集合 | 说明 |
|---|---|
| `backend.invoke`、`backend.notify` | 插件的 UI 可以驱动自己的后端，不需要任何已声明权限 |
| `host.getContext`、`ui.readAsset` | 无门控 |
| `host.downloadFile`、`host.cancelDownload`、`host.saveFile`、`host.copy`、`host.pickFiles`、`host.readFileChunk`、`host.beginFileSave`、`host.writeFileChunk`、`host.finishFileSave`、`host.closeFileHandle` | 文件读写允许，因为路径由用户在原生对话框里选定 |
| `host.reopenConnection` | 无权限门控，但有归属门控 |

证据：`apps/desktop/src/lib/plugins/pluginHostBridge.ts:426` — `// Same trust level as host.saveFile: the bytes only flow after the user picked the files in the native dialog, so no manifest permission gate.`；`host.reopenConnection` 的归属检查在 `apps/desktop/src/stores/connectionStore.ts:4749` — `if (config.plugin_id !== pluginId) throw new Error("Connection is owned by another plugin");`。这些方法只靠「宿主能力是否存在」（`if (!this.api.X) throw ...`）加逐次参数校验兜底。

**一个被验证者更正过的表述**：`host.events` 并非"唯一控制什么能到达沙箱 UI 的门"。`host.downloadFile` 通过另一条代码路径向沙箱投递合成的 `host.download.progress` 事件，**不检查 `host.events`**（`apps/desktop/src/lib/plugins/pluginHostBridge.ts:324`）。任何启动了流式下载的插件，即使没有 `host.events` 权限也会收到进度帧。除此之外，所有以 `type: "event"` 抵达 UI 的东西都走 `forwardEvent` 及其权限检查。

### 6.4 三层强制点：安装时 / 会话启动 / 每次调用

权限在四个不同时刻被不同代码看过，效果差别很大。逐层说明：

| 层 | 时机 | 检查代码 | 结果与力度 |
|---|---|---|---|
| L0 编辑器/CI | 写 manifest 时 | `plugins/manifest.schema.json:29` 的 `uniqueItems: true` + enum/pattern 的 `anyOf` | 只是契约镜像。**注意**：`permissions` 子 schema 本身**没有** `additionalProperties` 字段，全文件唯一的 `additionalProperties: false` 在最顶层对象（第 6 行）。条目名"additionalProperties:false on permissions"是不准确的命名 |
| L1 安装时 / registry 加载 | 安装或激活前 | `manifest.compatibility()`，`crates/dbx-plugin-runtime/src/plugins/manifest.rs:833` — `let valid = SUPPORTED_PLUGIN_PERMISSIONS.contains(&permission.as_str())` | **硬门**。未知权限、重复权限、重复 network origin、超过 8 条，全部进入 `errors`，插件被判定不兼容，因而不可安装/不可激活。调用点：安装器 `crates/dbx-plugin-runtime/src/plugins/installer.rs:477`；激活 `crates/dbx-plugin-runtime/src/plugins/host.rs:135-137`（在 spawn 之前拒绝） |
| L1b 市场安装期望 | 市场安装时 | `crates/dbx-plugin-runtime/src/plugins/installer.rs:839` — `if permissions != expectation.permissions {` | 包 manifest 的权限集合必须与 catalog 声明集合**精确相等**（`BTreeSet` 相等，多一条少一条都失败），与 id/version/publisher/signing-key 相等一起把已安装权限绑定到评审通过的那份。**仅在存在 expectation 时运行**（`install_marketplace_bytes`）；文件/URL 安装不传 expectation，权限就是 manifest 说了算 |
| L1c 目录装载 | 装载 market catalog 时 | `crates/dbx-plugin-runtime/src/plugins/marketplace.rs:622` | 任一插件声明了不支持权限、重复权限或超 8 origin，**整个 catalog 被拒**。这是权限的人类可评审副本 |
| L2 会话启动 | `plugin/initialize` 握手 | `crates/dbx-plugin-runtime/src/plugins/runtime.rs:380` — `permissions: &self.plugin.manifest.permissions,` | **纯信息性**。宿主把插件自己声明的权限表发回给插件后端；握手接受条件只看 protocol_version 和 plugin id/version（`runtime.rs:385-396`），**权限在那里从不被重新校验**，也没有任何后端能力被它门控 |
| L2b UI 初始化 | 沙箱文档 receive `init` | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:246` — `permissions: [...(this.plugin.manifest.permissions || [])],` | 同样**纯信息性**，但这是注入的 SDK/bridge 做自身门控决策所依据的那份拷贝。宿主序列化一份新数组，插件代码改不动 manifest |
| L3 每次 UI→host 调用 | 每个特权桥方法入口 | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:501` — `if (!this.hasPermission(permission)) throw new Error(\`Plugin has not declared permission '${permission}'\`);` | **真正的执行点**。失败是一个被拒的请求，SDK 表现为 promise rejection。调用顺序是**权限优先**：先 `requirePermission(...)`，再 `if (!this.api.X) throw ...`（`pluginHostBridge.ts:392` 之后才是 `:393` 的能力检查），所以无权限的插件总是拿到权限错误，无法用错误文案探测宿主能力 |
| L3b 每次事件转发 | 事件/二进制推入沙箱前 | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:282`（事件）、`:284`（二进制） | 精确权限检查加 pluginId 匹配。**Rust 侧没有对应检查**：`crates/dbx-plugin-runtime/src/plugins/runtime.rs:651` — `let _ = self.events.send(event);`，中继是无条件的 |
| L4 每次 host→plugin 调用 | `PluginHost::invoke/notify/send_binary` | `crates/dbx-plugin-runtime/src/plugins/host.rs:158` — `ensure_permission(session.plugin(), required_permission)?;` | 每次调用可带**一个** required permission，在激活之后检查，拒绝文案 `Plugin '<id>' has not declared permission '<p>'`。`None` 表示不门控——而**当前所有调用方都传 `None`**：`src-tauri/src/commands/plugins.rs:322`（UI 的 `backend.invoke`）、`plugin_download.rs:79/88/122`、`mcp_bridge.rs:1417`，以及 `filesystem.rs` 全部。**这道闸接线了但当前未被使用** |

拒绝路径的判定语义（`ensure_permission`，`crates/dbx-plugin-runtime/src/plugins/host.rs:817`）就是精确字符串成员测试：

```rust
if plugin.manifest.permissions.iter().any(|declared| declared == permission) { Ok(()) }
else { Err(format!("Plugin '{}' has not declared permission '{permission}'", plugin.manifest.id)) }
```

**manifest v1 不接受未知顶层字段**：`crates/dbx-plugin-runtime/src/plugins/manifest.rs:791` 的文案 `Plugin manifest contains unknown top-level field(s): {}`（`errors.push(format!(` 在第 790 行）是一条硬错误，所以把 `permissions` 拼错不会静默通过评审。实现靠 `#[serde(default, flatten, skip_serializing)] unknown_fields`（`manifest.rs:92-93`）。

### 6.5 沙箱 CSP：插件 UI 与插件后端是两种网络现实

| 对象 | 约束 | 证据 |
|---|---|---|
| 插件 UI（沙箱文档） | 注入的 CSP meta：`default-src 'none'; script-src 'unsafe-inline' blob:<asset>; style-src 'unsafe-inline' blob:; img-src data: blob:<asset>; font-src data: blob:<asset>; connect-src <origins\|'none'>; media-src data: blob:<asset>;` | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:550` |
| 插件 UI 的网络 | 只有声明了 `host.network:` origin 才放开 `connect-src`；没有则 `connect-src 'none';`。无远程脚本、无远程样式、无远程图片、无 frame、无 plugin、无 worker（全部回落到 `default-src 'none'`）。内联脚本**允许**，所以插件自带的打包 JS 总能运行 | `pluginHostBridge.ts:550`、`:548`、`pluginHostBridge.spec.ts:773-774` |
| 插件后端（原生 sidecar） | **不受限**。它是持有用户 OS 凭据的普通子进程，网络与文件系统访问不受约束；`dbx-plugin-runtime` 里不存在 seccomp/AppArmor/netns 沙箱 | `plugins/README.md:695` — `Native process filesystem/network access cannot currently be completely mediated by DBX.` |

`host.network` 的效力范围因此必须说清：**它只编辑沙箱文档里的一个 CSP 指令**。反证也是存在的——在 `crates/dbx-plugin-runtime/src` 里 grep `sandbox|seccomp|firewall|restrict`，只命中关于 UI CSP 的文档注释。

sidecar 还会无条件拿到自己的数据目录绝对路径，不看任何权限：

```
DBX_PLUGIN_DATA_DIR=<store>/plugin-data/<plugin-id>
```
`crates/dbx-plugin-runtime/src/plugins.rs:127` — `pub const PLUGIN_DATA_DIR_ENV: &str = "DBX_PLUGIN_DATA_DIR";`

`host.storage` 的原生后端另有边界（边界不在权限里，而是另有实现）：`plugin-data/<id>/ui-storage.json`，`MAX_PLUGIN_STORAGE_VALUE_BYTES=256KiB`、`MAX_PLUGIN_STORAGE_TOTAL_BYTES=1MiB`、`MAX_PLUGIN_STORAGE_KEYS=1024`（`dbx/src-tauri/src/commands/plugin_storage.rs:28`、`:30`、`:32`）。`validate_plugin_id` 先把插件 id 按 manifest identifier 模式校验，再作为单个路径组件拼接，因而无法穿越到别的插件目录（`dbx/src-tauri/src/commands/plugin_storage.rs:54`）。Web 宿主则回落到顶层文档的 `localStorage`，键为 `dbx-plugin-storage:<pluginId>:<key>`（`PluginWorkbenchHost.vue:171`，原生调用在 `apps/desktop/src/lib/backend/http.ts:5203` 被 stub 掉）。

**`dbx-web`（浏览器宿主）的事件面比桌面大得多，必须显式知道。** `GET /api/plugins/events` 是一条 SSE，订阅运行时的事件与二进制广播通道时**没有插件过滤、没有权限检查**，把**每个**插件的事件和二进制帧流给任何打开该连接的客户端（`crates/dbx-web/src/routes/plugins.rs:564` — `let mut events = state.app.plugin_host.subscribe_events();`）。客户端 `apps/desktop/src/lib/backend/http.ts:706` 用 `new EventSource(apiUrl("/api/plugins/events"))` 接入，之后才由共享 bridge 的 `forwardEvent`/`forwardBinary` 做 `host.events`/`host.binary` 作用域过滤。桌面路径不暴露该 endpoint。

### 6.6 `host.plans:*` 与插件能看到的计划数据

`host.plans:read` 是唯一计划作用域。它门控两个方法：

| 方法 | 签名 | 说明 | 证据 |
|---|---|---|---|
| `host.getPlanCapabilities` | `getPlanCapabilities(connectionId: string) => Promise<{ dbType, dbVersion?, supports: { estimatedPlan }, limits: { maxTimeoutMs, maxPlanBytes } }>` | 不做连接与探测，直接返回逐连接计划元数据：方言、DBX 已知的服务器产品版本、是否存在 estimated-plan 路径、生效的超时与字节上限 | `pluginHostBridge.ts:392` — `this.requirePermission(PLUGIN_PLAN_PERMISSION);` |
| `host.explainPlan` | `explainPlan({ connectionId, database?, schema?, sql, mode: "estimated", timeoutMs? }) => Promise<{ dbType, dbVersion?, format: "json"\|"xml"\|"text", rawPlan, truncated, warnings }>` | 宿主为插件自己的 SQL 生成估算计划。插件**从不**发送 EXPLAIN 文本、驱动命令或执行模式；桥在转发前就拒掉任何非字面量 `"estimated"` 的 mode | `pluginHostBridge.ts:957` — `if (input.mode !== "estimated") throw new Error('host.explainPlan serves mode "estimated" only');` |

**重要：`host.plans:read` 能读到用户任意已打开的连接，不只是插件自己的。**

```
plugin_plan_capabilities(state, connection_id) / explain_estimated_plan(state, request) — 参数中没有 plugin_id
```
`crates/dbx-core/src/query/plugin_plan.rs:166` — `let config = connection_config(state, &request.connection_id).await?;`

两个入口只收一个裸 `connectionId`，从不检查该连接是否由调用插件创建或属于它。任何有 `host.plans:read` 的插件都能对用户已有的任意内置 Postgres/MySQL/… 连接做计划，并读回它的 `db_type` 和服务器版本。唯一的边界是**存活状态**：`crates/dbx-core/src/query/plugin_plan.rs:459` — `if state.is_connection_open(connection_id).await { return Ok(()); }`，它拒绝「已保存但已关闭」的连接，而不是用存储的凭据去拨号。另注：桥之下不再复查该权限（Tauri command 不收 plugin id）。

插件能看到的计划数据面：

| 类型 | 字段 | 证据 |
|---|---|---|
| `PluginPlanResult` | `{ dbType, dbVersion?, format, rawPlan, truncated, warnings }` | `crates/dbx-core/src/query/plugin_plan.rs` |
| `PluginPlanCapabilities` | `{ dbType, dbVersion?, supports.estimatedPlan, limits.{maxTimeoutMs,maxPlanBytes} }` | 同上 |

插件看到计划文本/JSON 加连接方言与产品版本；**看不到**凭据、host/port、由宿主生成的那段 SQL，也拿不到任何真实（actual）计划数据——宿主构造 EXPLAIN 语句时 `analyze` 永远不被设置：`crates/dbx-core/src/query/plugin_plan.rs:227` — `analyze: None,`（注释：`// Estimated only: \`analyze\` is exactly what turns this into a statement`）。上限：计划行数 20,000（`PLUGIN_PLAN_MAX_ROWS`），序列化计划 4 MiB（`MAX_PLUGIN_PLAN_BYTES`），SQL 200,000 字符（`MAX_PLUGIN_PLAN_SQL_CHARS`）。

桥在请求抵达后端之前就做参数校验（后端在 Rust 侧再验一遍每个边界）：`requirePluginPlanRequest` 检查 `connectionId`（trim 后非空、≤256 字符）、`sql`（trim 后非空、≤200000 字符）、可选 `database`/`schema`（≤256）、`timeoutMs` 夹到 `[1, 60000]`，并且空 scope 被剥掉而不转发空字符串。证据：`pluginHostBridge.ts:962` — ``throw new Error(`sql must be at most ${MAX_PLUGIN_PLAN_SQL_CHARS} characters`);``。

**权限之外的第二个开关：宿主能力通告。** init 消息里除权限表外还有 `capabilities: { downloadFile: boolean, planApi: boolean, storage: boolean }`；`planApi` 由 `apps/desktop/src/lib/plugins/pluginHostBridge.ts:251` — `planApi: !!this.api.getPlanCapabilities && !!this.api.explainPlan,` 计算。宿主缺适配器时会报 `planApi:false`，**即使插件声明了 `host.plans:read`**，请求仍以 `Host plan API is unavailable` 失败。

**第三个开关：`engines.host_api` 版本门槛。** `SUPPORTED_PLUGIN_HOST_API_VERSION = "1.2.0"`（`crates/dbx-plugin-runtime/src/plugins/manifest.rs:16`），`engines.host_api` 必须是它能满足的 semver 要求；manifest 校验拒绝要求高于宿主通告值的插件（测试在 `manifest.rs:1646` 断言 `^1.2` 匹配，并在 `:1653-1655` 拒绝 `>=1.3.0` 与 `^2.0`）。**注意锚点更正：`manifest.rs:1645` 那行是 `assert!(`，引用的 `semver::VersionReq::parse("^1.2")...` 在第 1622 行。** 这是安装期的版本门，但它本身**不授予**权限——权限串仍然必须声明。

### 6.7 签名与信任模型是否影响权限

结论先行：**签名状态不参与任何权限判定**。宿主的权限执行点（`ensure_permission`、`hasPermission`、`compatibility()`）从不读取签名、信任库或撤销状态。签名是**安装准入**的开关，并且通过「签名覆盖包字节 → 包字节含 manifest → manifest 含 permissions」这条链，**间接**把权限绑定到评审过的字节上。

| 机制 | 签名/取值 | 效果 | 证据 |
|---|---|---|---|
| 包签名验证 | `signature.json { algorithm: "ed25519", key_id, signature }`，对 `checksums.json` 字节验证 | 被签载的是包的 `checksums.json`，而它必须精确覆盖整个包（`checksums.json` 与 `signature.json` 自身除外）。未知 key id、错误算法、签名不通过都是硬安装错误 | `crates/dbx-plugin-runtime/src/plugins/installer.rs:315` — `.ok_or_else(\|\| format!("Plugin package is signed by untrusted key '{}'", signature.key_id))?;` |
| 安装策略 | `pub enum PluginInstallPolicy { LocalSigned, LocalDevelopment }`，`let policy = if allow_unsigned { LocalDevelopment } else { LocalSigned };` | `LocalSigned` 下缺 `signature.json` 是致命的；`LocalDevelopment` 下未签名包可安装，记录为 `PluginSignatureStatus::Unsigned`。`LocalDevelopment` 还跳过更新连续性检查与"已安装重复"检查 | `src-tauri/src/commands/plugins.rs:195`；同一开关在 web 安装器 `crates/dbx-web/src/routes/plugins.rs:288-289`，URL 安装在 `plugins.rs:218` |
| 信任库 | `<store>/.trust/keys.json { keys: { key_id: base64-32-byte-ed25519-public-key } }` 加编译内置的 `BUILTIN_OFFICIAL_TRUSTED_KEYS` | 官方仓库公钥编译进二进制；release 构建可通过构建期环境变量追加轮换密钥；用户密钥若 id 与内置 id 冲突但字节不同，安装**失败**而不是静默覆盖 | 内置公钥字面量 `crates/dbx-plugin-runtime/src/plugins/marketplace.rs:33` — `("dbx-store-preview-2026", "VRb0VscZfWwuFa7LYfeD/wEOJeyNP8wPGND9br8Icmk="),`。**锚点更正：该行只支撑"内置公钥"，不支撑所述的轮换冲突行为；后者实现在 file-vs-builtin 合并逻辑中，应引 `marketplace.rs:772-780`。** 构建期覆盖：`marketplace.rs:31` — `const ADDITIONAL_OFFICIAL_TRUSTED_KEYS_JSON: Option<&str> = option_env!("DBX_PLUGIN_MARKETPLACE_TRUSTED_KEYS_JSON");` |
| 更新连续性 | `ensure_update_continuity(provenance, active_version, repository_id, publisher, signing_key_id, candidate_version, allow)` | 更新若改变了记录的 repository、publisher 或 signing key，或是降级，未被用户显式确认即被拒；该检查在 store 锁下重复一次 | `crates/dbx-plugin-runtime/src/plugins/installer.rs:226` — `if (repository_changed \|\| publisher_changed \|\| key_changed) && !allow {` |
| 权限集是否被记录 | `PluginInstallProvenance { repository_id?, publisher?, signing_key_id?, source }` | provenance 记录来源（marketplace/url/file）以便日后发现来源被换。**权限本身除市场相等检查外不被重新记录**——非市场来源的覆盖安装**可以静默改变权限集**，只把 repository id 带过去 | `crates/dbx-plugin-runtime/src/plugins/installer.rs:577`；更新连续性只比较 repository/publisher/signing key，**从不比较权限**（`installer.rs:501-515`） |
| 撤销 | `dbx-store/revoked.json { version, pluginVersions: [{pluginId, version}], signingKeys: [keyId] }` | 被撤销的版本与签名密钥**只由 DBX Store 校验器、它的签名工作流和生成的 catalog 强制执行**；DBX 宿主中**没有任何代码读取 `revoked.json`，也不复查 `signing-keys.json` 状态**。已安装的插件、或从撤销前构建的 catalog 快照提供的插件，会继续运行 | `dbx-store/scripts/validate.mjs:98` — `assert(!revoked.pluginVersions.has(\`${plugin.id}@${version.version}\`), ...)`。反证：在 `dbx/` 里 grep `revoked` 除注释外无 plugin-runtime / src-tauri 命中；宿主密钥集只有编译内置加用户 `.trust/keys.json`，两者都没有 status 字段 |
| 签名模型意图 | 文档声明 | "DBX plugin signing v1 uses one signature owned by the repository that distributes the package."——v1 刻意不做 per-author 密钥。**`publisher` 字段是作者身份元数据，明确不是签名密钥所有者，因此 publisher 字符串不能用于权限或信任判定** | `plugins/SIGNING.md:15` — ``The `publisher` field records authorship and catalog ownership. It is not a signing-key owner.`` |

权限经评审绑定的完整链条：catalog 携带权限列表（`PluginMarketplacePlugin.permissions -> Vec<String>`）→ 市场代码拷进安装期望（`crates/dbx-plugin-runtime/src/plugins/marketplace.rs:441` — `permissions: plugin.permissions.iter().cloned().collect(),` → `PluginPackageExpectation.permissions: BTreeSet<String>`）→ 安装器对包 manifest 强制精确相等。这是评审者的权限决定约束已安装字节的唯一通道。

### 6.8 用户可见性：安装 UI 只显示权限**数量**

`dbx/apps/desktop/src/components/plugins/PluginContributionsPanel.vue:1026` 只渲染一个徽标：

```vue
<Badge v-if="listing.plugin.permissions.length" variant="outline" ...>{{ t("pluginPlatform.permissionsCount", { count: listing.plugin.permissions.length }) }}</Badge>
```

没有逐权限同意对话框、更新时没有 diff 提示、也没有任何 UI 展示某条 `host.network:` 究竟指向哪个 origin。manifest 的声明是用户唯一能看到的记录；另一处面向用户的权限产物只有安装期对已评审 catalog 集合的相等检查（`installer.rs:839`）。

### 6.9 开发期 `dev-host` 与生产宿主的行为差异

写插件时最容易误判的地方：`dev-host` 只实现了权限模型的一个子集。

| 项 | dev-host 行为 | 证据 |
|---|---|---|
| 强制点 | 唯一执行点是精确数组成员测试，语义与 Rust `ensure_permission`、桥的 `hasPermission` 相同，但错误串不同：`Plugin permission required: <p>`。对 `host.binary`、`host.workbench`、`host.storage` 调用；事件/二进制广播门控则内联用 `manifest.permissions?.includes` | `plugins/sdk/dev-host/server.mjs:21`、`:249` |
| 未实现的方法 | **不实现 `host.filesystem`，也完全不实现 plan API**——这些方法落到 `Unsupported mock host method` | `plugins/sdk/dev-host/server.mjs`；`plugins/sdk/dev-host/README.md:71` — "Unimplemented methods, such as `host.openFilesystem`, return errors." |
| `host.network` | **被忽略**：dev iframe 的 CSP 硬编码 `connect-src 'none'`。依赖已声明 `host.network:` origin 的插件在 dev 下所有出网被封，与真实桌面宿主行为不同 | `plugins/sdk/dev-host/browser-bridge.mjs:189` — `... media-src data: blob:; connect-src 'none';">` |

### 6.10 与权限相邻但**不受权限门控**的插件→宿主通道

`host/requestUserInput` 是唯一由插件主动发起的 Host API 方法，除 host API 版本 1.1 外**没有任何权限门控**。宿主把它作为 `host.requestUserInput` 列在 initialize 的 `features` 里，插件应当检查通告的版本/特性而不是探测。`crates/dbx-plugin-runtime/src/plugins/runtime.rs:701` — `PLUGIN_REQUEST_USER_INPUT_METHOD => self.request_user_input(params).await,`；通告集合 `crates/dbx-plugin-runtime/src/plugins/manifest.rs:18` — `pub const SUPPORTED_PLUGIN_HOST_FEATURES: &[&str] = &["host.requestUserInput"];`。

**线上形状以更正后的为准（原条目写错两处）：**

| 项 | 正确取值 | 说明 |
|---|---|---|
| 超时参数名 | `timeoutSecs`（整秒，被夹到 `5..600`） | **不是** `timeout`。宿主夹取范围 5–600 秒 |
| 成功动作 | `"submit"` | **不是** `"answer"` |
| 结果载荷 | 动作集合为 `{"submit", "cancel", "timeout"}`，成功时还带 `value` 字符串 | 提示被关闭返回 `{"action":"cancel"}`，超时返回 `{"action":"timeout"}` |
| SDK 类型对 | `UserInputPrompt { prompt, title?, echo, default, options[], timeoutSecs? }` / `UserInputAnswer { action: "submit"\|"cancel"\|"timeout", value? }`，带 `submitted()`/`is_cancelled()`/`is_timeout()` 辅助方法 | `options` 上限 8，标签缺省用 option 值 |

证据：`plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:182` — `pub timeout_secs: Option<u64>,`；`:238` — `if self.action == "submit" {`。

同样不受权限管、但受**运行时校验**约束的还有文件系统 URI 的方案封闭：`resolve_filesystem_uri(provider, requested_uri)` 要求 scheme 属于 `provider.schemes`，默认根为 `provider.root_uri` 或 `"<scheme>:/"`，长度 ≤4096 且无控制字符；provider 返回的每个 URI 都会按声明的 scheme 重新校验。`crates/dbx-plugin-runtime/src/plugins/filesystem.rs:356` — `return Err(format!("Filesystem URI scheme '{scheme}' is not handled by provider '{}'", provider.id));`。

### 6.11 本章核对到的缺口与不一致（汇总）

| 缺口 | 性质 | 证据 |
|---|---|---|
| Rust / TS / Schema 三份 `host.network` 解析器不一致：`host.network:https://a.example:8443:9000` Rust 接受、另两者拒绝 | 真实解析分歧 | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:54-58` vs `apps/desktop/src/lib/plugins/pluginHostBridge.ts:527` |
| Rust 侧事件中继无权限检查，`host.events` 只在桌面桥的前端生效 | 执行点在客户端 | `crates/dbx-plugin-runtime/src/plugins/runtime.rs:651` |
| `host.download.progress` 绕过 `host.events` 直达沙箱 UI | 更正了"唯一门"的说法 | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:324` |
| `dbx-web` 的 `/api/plugins/events` 无插件作用域、无权限检查，向任何客户端流送全部插件的 event 与 binary | 浏览器宿主专有 | `crates/dbx-web/src/routes/plugins.rs:564` |
| `PluginHost::invoke` 的 Rust 权限闸已接线但所有调用方传 `None` | 未启用的防御 | `crates/dbx-plugin-runtime/src/plugins/host.rs:158`，调用方见 6.4 |
| `host.filesystem` 只保护导航，不保护数据面；数据面靠 provider 能力 | 权限语义窄于名字 | `crates/dbx-plugin-runtime/src/plugins/filesystem.rs:170`、`:202`、`:313`（`None`）、`:222` |
| `host.plans:read` 可对用户任意已打开连接做计划 | 授权过宽 | `crates/dbx-core/src/query/plugin_plan.rs:166` |
| 非市场来源的覆盖安装可静默改变权限集；更新连续性不比较权限 | 评审绑定只在市场通道成立 | `crates/dbx-plugin-runtime/src/plugins/installer.rs:577`、`:501-515` |
| `revoked.json` 只被 store 侧读取，宿主从不复查 | 撤销对已安装插件无效 | `dbx-store/scripts/validate.mjs:98` |
| 安装 UI 只显示权限数量，不显示 `host.network:` 具体 origin | 用户不可见 | `apps/desktop/src/components/plugins/PluginContributionsPanel.vue:1026` |
| `dev-host` 忽略 `host.network`，且不实现 filesystem / plan API | 开发期行为误导 | `plugins/sdk/dev-host/browser-bridge.mjs:189`、`plugins/sdk/dev-host/README.md:71` |
| 原生 sidecar 无沙箱，`host.network` 对它无效 | 权限模型的最大边界外区域 | `plugins/README.md:695` |

## 7. SDK 与工具链

本章覆盖 `dbx-plugin` CLI 的全部子命令与产物、Rust / Go 两套 Sidecar SDK、`dbx-plugin.toml` 与 `manifest.json` 的关系、`.dbxp` 包格式与签名校验链、dev-host 调试路径、UI 与后端模板，以及 npm 分发与 CI 发版链路。所有锚点均为仓库相对路径，与 `dbx-plugin.toml` 一起构成「源 → 产物」的完整视角。

### 7.1 CLI 概览

`dbx-plugin` 是一个 Rust 二进制（`[[bin]] name = "dbx-plugin"`，见 plugins/sdk/cli/Cargo.toml:11），crate 名为 `dbx-plugin-cli`，当前版本 0.1.9。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbx-plugin <command>` | `create` \| `package` \| `dev` \| `keygen` \| `version` \| `--help` | 二进制只分派这五个子命令：`create` 脚手架、`package` 产出 `.dbxp` + artifact 元数据、`dev` 交给 Node dev host、`keygen` 生成 Ed25519 仓库密钥、`version`/`--help` 打印信息。除此之外没有别的动词 | n/a | 无 | plugins/sdk/cli/src/lib.rs:328（`Some("create") => run_create(arguments.collect()),`；注意 327 行是 `match arguments.next().as_deref() {` 头） |
| `dbx-plugin version` / `--version` / `-V` | `dbx-plugin <CARGO_PKG_VERSION>` | 版本输出接受三种写法，比上面「五个动词」的表述多一个入口；`dbx-plugin --version` 的字符串同时被真实 npm 安装后的验证脚本断言 | n/a | 无 | plugins/sdk/cli/src/lib.rs:332（`Some("--version" \| "-V" \| "version") => {`） |
| `create_usage()` 与解析器不一致 | 用法串：`"dbx-plugin create [directory] [--template frontend\|rust\|go] [options]"` | 报错/用法横幅只广告三个模板，但解析器接受四个（含 `svelte`），`print_create_help` 也列出了 `svelte`；凡是抓取用法行做判断的工具都会误以为不支持 svelte | n/a | 无 | plugins/sdk/cli/src/lib.rs:1614 |
| 文档漂移：`plugins/README.md` | `sdk/cli` — Rust source for the `dbx-plugin create/package` CLI published as `@dbx-app/plugin-cli` | README 仍只写 `create/package`；`dev` 与 `keygen` 已实现且在 `GETTING_STARTED.zh-CN.md` 有文档，但没进这份摘要，文档落后于二进制 | n/a | 无 | plugins/README.md:23 |

### 7.2 `dbx-plugin create`

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbx-plugin create` | `dbx-plugin create [directory] [--template frontend\|svelte\|rust\|go] [--backend none\|svelte\|rust\|go] [--language rust\|go] [--id ID] [--name NAME] [--publisher NAME] [--description TEXT] [--version VERSION] [--sdk-root PATH] [--force] [-y\|--yes] [-h\|--help]` | 从四个模板脚手架出工程。`--template`/`-t`/`--backend` 选择 `frontend`/`svelte`/`rust`/`go`；`--language`/`-l` 是 `rust`/`go` 的兼容别名，映射到同一模板 | n/a | 无 | plugins/sdk/cli/src/lib.rs:349（`"--template" \| "-t" \| "--backend" => {`） |
| `ProjectTemplate` 枚举 | `frontend` \| `frontend-only` \| `ui` \| `none` \| `svelte` \| `rust` \| `go` \| `golang` | 四个模板：`frontend`（纯沙箱 UI，universal 包）、`svelte`（Svelte+Vite UI，universal 包）、`rust`（UI + Rust sidecar）、`go`（UI + Go sidecar）。`frontend`/`svelte` 不带 `[backend]`；`rust`/`go` 会加一个 `backend/` 目录 | declarative | 无 | plugins/sdk/cli/src/lib.rs:117 |
| 模板别名冲突 | `"{option} conflicts with the previously selected plugin template"` | 同一条命令里给出相互冲突的别名（例如 `--template rust --language go`）是硬错误 | n/a | 无 | plugins/sdk/cli/src/lib.rs:541 |
| 非交互默认模板 | `frontend` | 非交互模式下不指定模板时默认 `frontend` | n/a | 无 | plugins/sdk/cli/src/lib.rs:561 |
| 位置参数语义 | 目标目录名 → 工程 slug → 默认 plugin-id 后缀 | 位置参数是目标目录；目录名同时成为工程 slug 和默认 plugin id 后缀 | n/a | 无 | plugins/sdk/cli/src/lib.rs:561 同段（notes） |
| `--signing-key-id`（已被 create 拒绝） | `error: "--signing-key-id is no longer used when creating plugins; official packages are signed by DBX Store after review"` | 传了 `--signing-key-id` 时 `create` 直接失败，明确告知官方包由 DBX Store 审核后签名，而不是作者自签 | n/a | 无 | plugins/sdk/cli/src/lib.rs:363 |
| `BINARY_NAME` / `METHOD_PREFIX` 派生 | `binary_name = format!("dbx-plugin-{slug}")`；`method_prefix = slug.replace('_', "-")` | Rust/Go 后端的 crate/二进制名与模板 `ping` RPC 前缀都由目标目录名派生，因此生成的 `{{METHOD_PREFIX}}/ping` 方法名是「slug 把下划线换成连字符」 | n/a | 无 | plugins/sdk/cli/src/lib.rs:800 |
| `validate_identifier` / `validate_semver` / `validate_artifact_target` | identifier：非空、≤256、ASCII 小写字母/数字，index 0 之后才允许 `. _ -`；version：`semver::Version::parse`（严格 SemVer）；artifact target：`[a-z0-9-]{1,64}`；相对路径：不允许空/绝对/父级组件 | 所有作者提供的身份字符串（plugin id、publisher、version）与 artifact target 在脚手架或打包前统一校验，因此一个大写字母或 `1.0` 会让命令失败，而不是产出一个被拒的包 | n/a | 无 | plugins/sdk/cli/src/lib.rs:1382；错误文案在 lib.rs:1391 与 lib.rs:1399 |

**模板文件集**（`plugins/sdk/cli/src/lib.rs:269` 起）：

| 名称 | 组成 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `SHARED_TEMPLATES`（2 项） | `.gitignore`、`assets/plugin.svg` | 任何模板都会写入 | n/a | 无 | plugins/sdk/cli/src/lib.rs:269 |
| `FRONTEND_TEMPLATES`（5 项） | `dbx-plugin.toml`、`manifest.json`、`README.md`、`ui/index.html`、`.github/workflows/plugin-release.yml` | 纯前端模板 | n/a | 无 | 同上 |
| `SVELTE_TEMPLATES`（10 项） | 在 frontend 基础上加 `package.json`、`svelte.config.js`、`vite.config.js`、`src/main.js`、`src/App.svelte`、`index.html`，并**去掉** `ui/index.html` | Svelte 工程把 UI 源放在 `src/`，由 Vite 编译进 `ui/` | n/a | 无 | 同上 |
| `NATIVE_TEMPLATES`(5) + `RUST_TEMPLATES`(2) / `GO_TEMPLATES`(2) | 公共的 `dbx-plugin.toml`/`manifest.json`/`README`/`ui` + 工作流；Rust/Go 各自再加 `backend/` 两个文件 | rust/go 模板 | n/a | 无 | 同上 |

**模板引擎**：模板用简单的 `{{MARKER}}` 替换渲染，之后会扫描是否还有残留的大写 marker；一旦发现未解析 marker 就中止创建，而不是写出一个坏文件（守卫在 plugins/sdk/cli/src/lib.rs:1301 的 `fn unresolved_template_marker(rendered: &str) -> Option<String>`）。

值映射的 marker 名单比初步审计列出的 20 个更长（`plugins/sdk/cli/src/lib.rs:1248` `fn template_values(`）。除 `{{PLUGIN_ID}}`、`{{PLUGIN_NAME_JSON}}`、`{{PLUGIN_NAME_HTML}}`、`{{VERSION}}`、`{{CLI_VERSION}}`、`{{LANGUAGE}}`、`{{BINARY_NAME}}`、`{{METHOD_PREFIX}}`、`{{CONNECTION_TYPE}}`、`{{GO_MODULE}}`、`{{PACKAGE_COMMAND}}`、`{{RUST_SDK_DEPENDENCY}}`、`{{GO_SDK_REPLACE}}`、`{{TEMPLATE}}`、`{{TEMPLATE_LABEL}}`、`{{LANGUAGE_LABEL}}`、`{{GO_VERSION}}`、`{{RUST_TOOLCHAIN}}`、`{{PUBLISHER}}`、`{{DESCRIPTION}}` 之外，值映射还定义了 `PLUGIN_NAME`、`PLUGIN_NAME_XML`、`PLUGIN_NAME_RUST`、`PLUGIN_NAME_GO`、`DESCRIPTION_JSON`、`PUBLISHER_JSON`。**这一点必须显式记住**：rust/go 模板真正消费的是代码安全变体（`{{PLUGIN_NAME_RUST}}` 见 plugins/sdk/cli/templates/rust/backend/src/main.rs:26，`{{PLUGIN_NAME_GO}}` 见 plugins/sdk/cli/templates/go/backend/main.go:29），只照着 20 个键去改模板会漏掉它们。

**依赖装配**（`plugins/sdk/cli/src/lib.rs:1312` `fn rust_sdk_dependency(...)`）：Rust 模板把 `dbx-plugin-sdk` 钉在 `{ version = "0.1.0" }`，用了 `--sdk-root` 时改成 `{ path = "<sdk>" }`；Go 模板生成 module `github.com/<publisher>/<slug>`，`require github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk v0.1.0`，并可选追加指向检出目录的 `replace`。常量 `SDK_VERSION = "0.1.0"`（plugins/sdk/cli/src/lib.rs:17），Go replace 目标字面量同样为 `github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk`（plugins/sdk/cli/src/lib.rs:1332）。

### 7.3 `dbx-plugin package` 与打包前校验

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbx-plugin package` | `dbx-plugin package [project] [--target TARGET] [--output-dir DIR] [--artifact-url URL] [-h\|--help]` | 把工程打成 `<id>-<version>-<target>.dbxp` 加同目录 `.artifact.json`。读取 `dbx-plugin.toml` + `manifest.json`，按声明构建 Rust/Go 后端，只暂存声明过的 include 路径，最后调用 packager 库。默认输出到 `dist/` | n/a | 无 | plugins/sdk/cli/src/lib.rs:405（`"--target" => target = Some(value_after(&arguments, &mut index)?.to_string()),`） |
| `--key-id`（已被 package 拒绝） | `error: "--key-id is no longer supported by dbx-plugin package; build an unsigned candidate, then let the repository operator sign it after review"` | `package` 遇到 `--key-id` 直接失败，且有单元测试断言该文案。工作流被刻意拆开：作者只产**未签名候选**，仓库方负责签名 | n/a | 无 | plugins/sdk/cli/src/lib.rs:408 |
| `dbx-plugin.toml` | `schema_version = 1`；`[backend]` {language, directory, binary}；`[package]` {include = [...]}；`[dev]` {ui_build = [...], ui_watch = [...]} | CLI 读取的构建/开发配置。`schema_version` 必需，`[backend]` 可选，`[package]` 必需，`[dev]` 可选；最小前端形态只声明 `schema_version` 和 `[package].include` | declarative | 无 | plugins/sdk/cli/templates/frontend/dbx-plugin.toml:3（`[package]`） |
| `dbx-plugin.toml` 的解析与严格性 | 解析进 `ProjectConfig`（plugins/sdk/cli/src/lib.rs:197）与 `DevConfig`（带 `#[serde(deny_unknown_fields)]`，plugins/sdk/cli/src/dev.rs:11） | `deny_unknown_fields` 意味着 `[dev]` 里写错一个键名是硬错误，不会静默忽略 | declarative | 无 | plugins/sdk/cli/src/dev.rs:11 |
| `dbx-plugin.toml` 与 `manifest.json` 的关系 | `ProjectConfig{ schema_version, backend?, package.include, dev? }` ↔ `Manifest{ manifest_version, id, name, version, publisher, engines.host_api, entrypoints.backend? }` | **两者都是作者手写的源**：`manifest.json` 承载身份、engines、permissions、entrypoints、contributions、localizations；`dbx-plugin.toml` 是构建配置。但 `.dbxp` **内部的那份 `manifest.json` 是生成物**：打包器会把 `entrypoints.backend.executable` 重写成带 target 的路径并剥掉过时键 | declarative | 无 | plugins/sdk/cli/src/lib.rs:905（`if manifest.entrypoints.backend.is_some() != config.backend.is_some() {`；两侧都声明或都不声明，否则报错，文案见 lib.rs:906） |
| `reject_unknown_manifest_fields` | `error: "manifest.json contains unknown top-level field(s): ..."` | CLI 拒绝 allowlist 之外的任何顶层键，manifest 无法夹带字段蒙混过打包；打包时对交给 packager 的 manifest 也会跑一遍 | declarative | 无 | plugins/sdk/cli/src/lib.rs:1034（allowlist：`$schema, manifest_version, id, name, icon, version, publisher, description, source, homepage, engines, permissions, entrypoints, contributions, localizations`） |
| `package_manifest` 归一化 | `entrypoints.backend.executable := "bin/{target}/{executable_name}"`；删除 `entrypoints.ui.kind`、`entrypoints.backend.binaries`、`entrypoints.backend.protocol`、`protocol_versions == [1]`、`transport == "stdio-jsonl"` | 打包时归一化暂存 manifest：先删过时键，再写带 target 的 `executable`。**旧的多二进制 manifest 是硬拒绝，不做迁移** | declarative | 无 | plugins/sdk/cli/src/lib.rs:1001（`if backend_entrypoint.contains_key("binaries") {`）；错误文案：`"entrypoints.backend.binaries is obsolete; package one target and declare executable"`、`"entrypoints.backend.protocol is obsolete; DBX manifest v1 uses the DBX JSON-RPC protocol"`、`"entrypoints.ui.kind is obsolete; DBX plugin UI is always sandboxed"` |
| `validate_manifest_assets` / `validate_packaged_asset` | 检查 `manifest.icon` 与 `entrypoints.ui.entry`（必须 `starts_with` `entrypoints.ui.root`，root 默认 `"ui"`），两者须为安全相对路径且都被 `[package].include` 覆盖 | 暂存之前校验图标、UI 入口和 UI 根目录确实存在、路径安全、`entry` 在 `root` 内、且各自被 include 覆盖；缺覆盖直接中止打包 | declarative | 无 | plugins/sdk/cli/src/lib.rs:1060；错误文案 `"{label} '{value}' is not covered by [package].include"` |
| `build_rust_backend` | `cargo build --release --manifest-path <backend>/Cargo.toml [--locked] [--config patch.crates-io.dbx-plugin-sdk.path=<sdk>]`，环境变量 `CARGO_TARGET_DIR=<stage build dir>` | Rust 后端构建；存在 `Cargo.lock` 时加 `--locked`；`DBX_PLUGIN_SDK_ROOT` 指向检出时加 patch config。产物 release 二进制被拷成 `bin/<target>/<binary>[.exe]` | n/a | 无 | plugins/sdk/cli/src/lib.rs:1097；跨架构构建遵循 `CARGO_BUILD_TARGET`，先查 `<target-dir>/<triple>/release` 再查 `<target-dir>/release`（lib.rs:1156） |
| `build_go_backend` | `go build -trimpath -o <staged executable> .`（可加 `-modfile <build/go.mod>`），环境 `GOWORK=off` | Go 后端构建。设置 `DBX_PLUGIN_SDK_ROOT` 时把 go.mod/go.sum 拷进私有 build 目录，用 `go mod edit -replace=github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk=<sdk>` 改写副本，再以 `GOWORK=off -modfile <copy>` 构建 | n/a | 无 | plugins/sdk/cli/src/lib.rs:1166；Windows 路径经 `go_work_path` 归一为斜杠（lib.rs:1208） |
| `current_target` / `DBX_PLUGIN_TARGET` | `darwin-arm64` \| `darwin-x64` \| `linux-arm64` \| `linux-x64` \| `windows-arm64` \| `windows-x64` \| `universal` | 原生插件默认取当前宿主 OS+arch，可用 `--target` 或 `DBX_PLUGIN_TARGET` 覆盖；**请求的 target 与构建宿主不一致时被拒绝**。纯前端工程默认 `universal` | n/a | 无 | plugins/sdk/cli/src/lib.rs:913；错误文案 `"Native plugin target '{target}' does not match build host '{detected_target}'; run this package command on the target platform"`（lib.rs:919） |
| `DBX_PLUGIN_SDK_ROOT` | `DBX_PLUGIN_SDK_ROOT=<path to a DBX checkout>` | 只被 `sdk_root_from_environment()` 读取，而该函数仅由 `build_rust_backend`、`build_go_backend` 和 `dev.rs` 调用（证据：plugins/sdk/cli/src/lib.rs:1348）。npm 启动器把它自动指向自带的 `sdk-root/`，所以常规安装无需手动设置。**更正：它并不会「覆盖 `create --sdk-root`」——`create_project` 只认 CLI 的 `--sdk-root`（`options.sdk_root`），因此设了 `DBX_PLUGIN_SDK_ROOT` 也不会让 `dbx-plugin create --template rust` 使用检出/自带 SDK，生成的 Cargo.toml / go.mod 仍然钉 crates.io 版本，除非显式传 `--sdk-root`** | n/a | 无 | plugins/sdk/cli/src/lib.rs:1348 |
| 路径必须解到 | 目录需含 `plugins/sdk/rust/dbx-plugin-sdk/Cargo.toml` 和/或 `plugins/sdk/go/dbx-plugin-sdk/go.mod` | SDK root 不是任意目录，必须能定位到两套 SDK | n/a | 无 | plugins/sdk/cli/src/lib.rs:1348（notes） |
| `copy_path` / `CleanupDirectory` | 拒绝：路径中出现 `.dbx-dev` 组件、符号链接、不支持的文件类型 | 暂存只拷 `[package].include` 条目，沿途拒绝 `.dbx-dev`、symlink 与非文件/目录输入；stage 与后端 build 目录用 RAII 清理，成功失败都不留 `.stage-*`/`.build-*` 残留 | n/a | 无 | plugins/sdk/cli/src/lib.rs:1223（`if source.file_name().is_some_and(\|name\| name == ".dbx-dev") {`）；测试 `package_validation_and_failures_leave_no_temporary_directories`（lib.rs:1829） |
| `.dbx-dev` / `--data-dir` | `.dbx-dev/connections.json`（明文）、`.dbx-dev/settings.json`（autoReload）、`.dbx-dev/ui-storage.json`（`host.storage` 镜像） | 本地 `dbx-plugin dev` 会把开发用连接配置**含凭据**以明文 JSON 写在 `.dbx-dev/` 下，目录/文件权限在支持的平台为 0700/0600；生成的 `.gitignore` 排除 `/dist/`、`/.dbx-dev/` 与 `.dbx-repository-signing-key.env` | n/a | 无 | plugins/sdk/cli/templates/common/gitignore:2（`/.dbx-dev/`） |
| `.dbx-dev` 的双重防护 | 打包拒绝（plugins/sdk/cli/src/lib.rs:883）＋ dev host 拒绝数据目录落在 UI 资源根内（plugins/sdk/dev-host/README.md:39） | 明文凭据目录不会被误打进包，也不会被 dev host 当成静态资源暴露 | n/a | 无 | plugins/sdk/cli/src/lib.rs:883 |
| `templates/common/gitignore`（共享模板） | `/dist/`、`/.dbx-dev/`、`.dbx-repository-signing-key.env`、`.DS_Store`、`*.log` | 每个模板都会被写入；它是「生成工程不会误提交 `keygen` 默认写出的私钥文件」的唯一保障 | n/a | 无 | plugins/sdk/cli/templates/common/gitignore:3；CLI 测试断言生成物含该条目（plugins/sdk/cli/src/lib.rs:1916-1918） |

### 7.4 `keygen` 与签名

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbx-plugin keygen` | `dbx-plugin keygen [KEY_ID] [--key-id ID] [-o\|--output FILE] [--force] [-h\|--help]` | 生成新的 Ed25519 签名种子，校验 key id，写出一个 env 文件，含 `export DBX_PLUGIN_SIGNING_KEY=...`、`DBX_PLUGIN_SIGNING_KEY_ID=...`、`DBX_PLUGIN_SIGNING_PUBLIC_KEY=...`；不加 `--force` 拒绝覆盖；Unix 上权限 0600 | n/a | 无 | plugins/sdk/cli/src/lib.rs:492（`pub fn generate_signing_key_file(`） |
| `keygen` 默认输出 | `.dbx-repository-signing-key.env` | 面向自建/私有仓库运维者，不是官方商店作者的常规流程 | n/a | 无 | plugins/sdk/cli/src/lib.rs:492（notes） |
| `validate_key_id` | `[A-Za-z0-9._:-]{1,128}` | key id 非空、≤128 字符、仅 ASCII 字母数字加 `.` `-` `_` `:`；同一条规则适用于 `keygen`、packager 的 `--key-id` 与 `sign` | n/a | 无 | plugins/sdk/packager/src/main.rs:587（`pub fn validate_key_id(key_id: &str) -> Result<(), String> {`） |
| `DBX_PLUGIN_SIGNING_KEY` / `_KEY_ID` / `_PUBLIC_KEY` | `(None,None)` → 不签名；`(Some,None)` → `".DBX_PLUGIN_SIGNING_KEY is required when --key-id is provided"`；`(None,Some)` → `".--key-id is required when DBX_PLUGIN_SIGNING_KEY is set"` | 签名读 `DBX_PLUGIN_SIGNING_KEY`（base64 编码的 32 字节 Ed25519 seed），且必须与 `--key-id` 成对出现。若同时设置了 `DBX_PLUGIN_SIGNING_PUBLIC_KEY`，packager 会验证私钥种子确实派生出该公钥，否则中止 | n/a | 无 | plugins/sdk/packager/src/main.rs:544；不匹配错误 `"DBX_PLUGIN_SIGNING_KEY does not match DBX_PLUGIN_SIGNING_PUBLIC_KEY"`（main.rs:575） |
| 签名文件 `signature.json` | `{ "algorithm": "ed25519", "key_id": "<key id>", "signature": "<base64 64-byte signature>" }` | 签名是对 `checksums.json` **精确字节**的分离式 Ed25519 签名（不是对整个 zip）。因此同一目录树重新 zip 是安全的，但任何文件改动都会使其失效。以 Deflate 压缩、`unix_permissions` 0o644 写入包内 | declarative | 无 | plugins/sdk/packager/src/main.rs:168（打包路径的 `"algorithm": "ed25519",` 成员在第 168 行，169 行是 `"key_id": key_id,`；sign 路径另有一份副本在 main.rs:257） |
| `validate_unsigned_candidate` | 返回即将被签名的原始 `checksums.json` 字节；拒绝目录条目、重复名、符号链接、已存在的 `signature.json`、以及任何 checksum 覆盖不一致 | `sign` 会重新打开已构建的候选包，除非它是干净的未签名包否则拒签：不得有目录条目、不得有重复名、不得有 symlink、不得已有 `signature.json`，且 `checksums.json` 必须精确覆盖其余每个条目且 SHA-256 匹配 | n/a | 无 | plugins/sdk/packager/src/main.rs:316；错误 `"Candidate package is already signed; official signing requires an unsigned package"`（main.rs:348） |
| `dbx-plugin-packager sign` | `dbx-plugin-packager sign <unsigned.dbxp> <signed.dbxp> --key-id ID [...]` | 与 package 同属一个二进制的第二个 CLI；`run_cli_silent` 是 `dbx-plugin package` 实际调用的入口，好让外层 CLI 掌控输出 | n/a | 无 | plugins/sdk/packager/src/main.rs:74（`if arguments.first().map(String::as_str) == Some("sign") {`） |
| `dbx-plugin-packager` 标识 | 库名 `dbx_plugin_packager`，二进制 `dbx-plugin-packager` | 更正：库名在 plugins/sdk/packager/Cargo.toml:12（第 11 行是 `[lib]`）；二进制锚点 :16 正确 | n/a | 无 | plugins/sdk/packager/Cargo.toml:12、:16 |

### 7.5 `.dbxp` 包格式与打包器

`.dbxp` 是一个确定性的 Deflate ZIP（`plugins/sdk/packager/src/main.rs:163` 起）。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `write_package` / `checksums.json` | `{ "algorithm": "sha256", "files": { "manifest.json": "<sha256hex>", "bin/darwin-arm64/plugin": "<sha256hex>", ... } }` | 除 `checksums.json`/`signature.json` 外的每个常规文件都会有一条 SHA-256；`checksums.json` 最后写入、覆盖所有文件；签名时 `signature.json` 追加在其后。条目按路径排序输出，哈希在流式写入时重算，以便发现构建中途被改动的源文件。更正：`"algorithm": "sha256",` 成员在 plugins/sdk/packager/src/main.rs:162（163 行是 `"files": checksums`） | n/a | 无 | plugins/sdk/packager/src/main.rs:162 |
| 源树中的同名文件 | `checksums.json` / `signature.json` 被跳过 | 源目录里字面叫这两个名字的文件不会被收进包，避免自指的是校验环 | n/a | 无 | plugins/sdk/packager/src/main.rs:139 |
| 内部结构 | `manifest.json`（已归一化）、`checksums.json`、可选 `signature.json`、`ui/`（由 `entrypoints.ui.root` 决定，默认 `ui`）、`bin/<target>/<executable>` | `.dbxp` 无隐藏的包裹层：打包器是把暂存目录里的文件按路径直接写进 zip 的根。后端入口固定落在 `bin/<target>/<binary>[.exe]`，正是 `package_manifest` 重写 `entrypoints.backend.executable` 时写入的那条路径 | n/a | 无 | plugins/sdk/cli/src/lib.rs:1001（`package_manifest`）；plugins/sdk/packager/src/main.rs:162（checksums 覆盖对象以 `manifest.json`、`bin/darwin-arm64/plugin` 为例） |
| 打包器硬上限 | `MAX_PACKAGE_BYTES=512MiB`、`MAX_UNCOMPRESSED_BYTES=1GiB`、`MAX_FILE_BYTES=256MiB`、`MAX_ARCHIVE_ENTRIES=10000` | 遍历源目录时与写最终归档时都会检查；同时拒绝符号链接，并要求输出位于源目录之外 | n/a | 无 | plugins/sdk/packager/src/main.rs:13（`const MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;`） |
| 打包器前置守卫 | 输出扩展名必须是 `.dbxp`；源必须含 `manifest.json`；输出不得 `starts_with` 源目录；sign 的输入/输出必须不同且都是 `.dbxp` | 手写打包脚本（如 hello-workbench/package.mjs）必须满足这些硬前置条件；「输出必须在源树之外」是示例都要先暂存到临时目录的原因 | n/a | 无 | plugins/sdk/packager/src/main.rs:105；源外检查在 main.rs:118（`if output.starts_with(&source)`）；sign 侧检查在 main.rs:244-249 与 :268 |
| `executable_permissions`（Windows 打包） | 父目录名含 `-` → 0o755，否则 0o644 | 非 Unix 宿主上打包器靠暂存路径推断可执行位：`bin/<target>/` 下的文件（target 含连字符）在 zip 里标 0755，其余 0644。Unix 打包保留真实 mode & 0o777 | n/a | 无 | plugins/sdk/packager/src/main.rs:667 |
| `<id>-<version>-<target>.artifact.json` | `{ "target": "darwin-arm64", "url": "<url or filename>", "sha256": "<hex>", "size": <bytes>, "signingKeyId": "<optional>" }` | 伴随每个 `.dbxp` 的 artifact 元数据，是 catalog 与发版聚合消费的对象。packager 原子地写在包旁边；只有提供了仓库 key id 时才出现 `signingKeyId` | n/a | 无 | plugins/sdk/packager/src/main.rs:451；`--artifact-url` 默认取包文件名（main.rs:447） |

### 7.6 宿主安装时的校验

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `PluginPackageInstaller::install_bytes` | `extract_package` → 读 `checksums.json` → `verify_package_checksums` → `verify_package_signature` → 解析 manifest → `validate_plugin_id`/`version` → `manifest.compatibility` → `validate_package_expectation` → `make_backend_executable` | 宿主把包解到暂存目录，要求 `checksums.json` 与 `manifest.json` 存在，逐条校验 checksum，然后按安装策略与信任库校验签名，最后才解析 manifest 并校验身份/引擎兼容性。**更正：方向不是 plugin→host。`install_bytes` 是宿主侧入口（DBX 安装用户选择的包或市场下载的包），插件永远不会调用它** | host 内部（非插件调用） | 无 | crates/dbx-plugin-runtime/src/plugins/installer.rs:464 |
| 安装侧同名上限 | 与 packager 相同的尺寸上限（installer.rs:22-25）；未知 signing key id 被拒（installer.rs:315） | 打包器接受的包不会在安装时因为体积被二次拒绝；但签名 key id 必须在信任库中已知 | n/a | 无 | crates/dbx-plugin-runtime/src/plugins/installer.rs:22-25 |
| `PLUGIN_CHECKSUMS_FILE` / `PLUGIN_SIGNATURE_FILE` | `checksums.json` \| `signature.json`；`MAX_PLUGIN_PACKAGE_BYTES=512MiB`、`MAX_UNCOMPRESSED_BYTES=1GiB`、`MAX_FILE_BYTES=256MiB`、`MAX_ARCHIVE_ENTRIES=10000` | 运行时声明了面向打包器的文件名常量，并施加与打包器一致的尺寸上限。512 MiB 的包上限在 plugins/README.md:70 与 4 MiB 的 catalog 上限并列记载 | n/a | 无 | crates/dbx-plugin-runtime/src/plugins/installer.rs:19 |
| `PluginInstallPolicy` | `LocalDevelopment` \| `LocalSigned`（外加市场路径） | 未签名包只在 `LocalDevelopment` 下被接受，得到 `PluginSignatureStatus::Unsigned`；`LocalSigned` 要求可信 Ed25519 签名，未签名包被拒。市场安装还会跨更新比对 source/publisher/signing-key 来源。更正：引用的 `LocalSigned` 拒绝分支在 installer.rs:812；811 行是 `PluginInstallPolicy::LocalDevelopment => Ok(PluginSignatureStatus::Unsigned),` | n/a | 无 | crates/dbx-plugin-runtime/src/plugins/installer.rs:812；枚举定义在 installer.rs:34；`LocalDevelopment` 会跳过更新连续性检查（installer.rs:502） |

### 7.7 Rust SDK（`dbx-plugin-sdk`）

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `PluginHandler` | `fn handle(&self, context: RequestContext, method: &str, params: Value, emitter: &PluginEmitter) -> Result<Value, PluginError>`；`fn handle_binary(&self, channel: &str, data: Vec<u8>, emitter: &PluginEmitter) -> Result<(), PluginError>` | 后端实现 `handle` 处理 JSON-RPC 方法，可选实现 `handle_binary` 处理带帧的 host→plugin 消息。这就是 SDK 对插件的**全部** trait 面 | host→plugin | 无 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:72；默认 `handle_binary` 返回 -32601 `"Binary input is not supported"`（lib.rs:82） |
| `PluginServer` | `PluginServer::new(metadata: PluginMetadata, handler: H)`；`.transport(PluginTransport)`；`.worker_threads(usize)`；`.work_queue_capacity(usize)`；`.serve() -> io::Result<()>` | 拥有 stdin 读循环、JSON-RPC 校验、`plugin/initialize` 协商、worker 池分派与响应写出。工作队列默认 256，线程数默认 `available_parallelism().clamp(2,16)` | host→plugin | 无 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:437 |
| `PluginServer` 的零值钳制 | worker 与 queue 的 0 会被钳到 1；host client 在开始服务前安装，因此第一个请求就能回调宿主 | 更正：worker 钳制在 lib.rs:462、queue 钳制在 lib.rs:467（463 行是 `self` 的结束），host client 安装在 lib.rs:476 | host→plugin | 无 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:462、:467、:476 |
| `PluginMetadata` | `PluginMetadata::new(id, version).with_capability("connections")` → `{ "protocolVersion": 1, "capabilities": [...], "plugin": { "id", "version" } }` | 握手时向宿主报告的身份：id、version 与可选能力列表。**id/version 必须与 `manifest.json` 完全一致**，否则 DBX 会在初始化阶段拒绝该后端 | plugin→host | 无 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:30；该要求文档化在 plugins/sdk/rust/dbx-plugin-sdk/README.md:53 |
| `PluginEmitter` | `emitter.event(method: &str, params: Value)`；`emitter.binary(channel: &str, data: &[u8])` | 交给每次 handler 调用的出站汇。`.event` 发 JSON-RPC 通知；`.binary` 发带帧二进制消息，**仅在 framed 传输下有效**。JSON 载荷上限 8 MiB，二进制上限 64 MiB，channel 名上限 65535 字节 | plugin→host | `host.binary`（UI 投递二进制帧所需） | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:93 |
| `PluginEmitter` 的上限生效顺序 | 在 JSONL 上调用 `.binary` 会先报 -32000 `"Binary messages require framed transport"` | 更正/澄清：Rust 里传输检查在尺寸检查之前，因此 8 MiB/64 MiB 上限实际只在 framed 模式下才会触及；`host.binary` 权限串本身正确，且由宿主侧强制执行 | plugin→host | `host.binary` | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:93（notes 与更正） |
| `HostClient` | `host_client() -> Option<HostClient>`；`.host_api_version() -> Option<String>`；`.supports(method) -> bool`；`.request(method, params)`；`.request_with_timeout(method, params, Duration)`；`.request_user_input(&UserInputPrompt)` | 后端在 handler 内部调用 Host API 的客户端。`request` 会阻塞当前 worker 直到宿主答复（默认超时 330 s）；`supports`/`host_api_version` 依据 `plugin/initialize` 广播的内容对可选调用做门控 | plugin→host | 无 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:302；请求用字符串 id `plugin-N`，使得只认数字 id 的宿主会忽略它们；响应从同一条 stdin 流上路由回来（lib.rs:383） |
| `UserInputPrompt` / `UserInputAnswer` | `UserInputPrompt{ prompt, title?, echo, default?, options[<=8], timeoutSecs? }` → `UserInputAnswer{ action: "submit"\|"cancel"\|"timeout", value? }`；`.submitted()` / `.is_cancelled()` / `.is_timeout()` | `host/requestUserInput`（Host API 1.1）的类型化封装：掩码密钥、可见文本、带 title/default/timeout 的多选题构造器。**答案必须按 fail-closed 处理——只有 `action == "submit"` 才带值** | plugin→host | 通过 `host.features` 广播；无 manifest 权限串 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:194；方法常量 `HOST_REQUEST_USER_INPUT_METHOD = "host/requestUserInput"`（lib.rs:22）；便捷封装 `request_user_input(prompt)` 在 lib.rs:430 |
| `PluginError` | `{ "code": i32, "message": String, "data"?: Value }` | 直接序列化为 JSON-RPC 错误对象。`PluginError::method_not_found(method)` 产出 -32601，这正是所有生成后端对未知方法的返回 | plugin→host | 无 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:67 |
| `validate_protocol_name` | `len in 1..=256 && no char::is_whitespace` | 方法名与 channel 名在写出或分派前校验：非空、≤256 字节、不含空白。这是 SDK 侧的协议混淆防护 | n/a | 无 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:674 |
| 协议常量（Rust 与 Go 共享） | `PROTOCOL_VERSION=1`；`MAX_JSON_BYTES=8MiB`；`MAX_BINARY_BYTES=64MiB`；帧类型 0(json)/1(binary)；`DEFAULT_HOST_REQUEST_TIMEOUT=330s` | 两套 SDK 共享的常量：协议版本 1、8 MiB JSON 上限、64 MiB 二进制上限、5 字节帧头、帧类型 0/1。Rust SDK 另外把 plugin→host 请求默认超时定为 330 s，以覆盖一次用户提示加余量 | n/a | 无 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:11 |
| `plugin/initialize` 处理 | 请求 `{ host: { protocolVersions: [1] } }` → `{ protocolVersion: 1, capabilities: [...], plugin: { id, version } }` | SDK 自己应答 `plugin/initialize`（handler 永远看不到它），回以 protocolVersion/capabilities/plugin 身份；宿主 `protocolVersions` 不含 1 时回错误 -32001。同时记录 `hostApiVersion` 与 `features` 供 HostClient 门控 | host→plugin | 无 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:549；Go 对应实现见 plugins/sdk/go/dbx-plugin-sdk/sdk.go:343 |
| `stdio-framed` 帧布局 | `kind:u8(0\|1)` \| `payload_length:u32` big-endian \| `payload`；kind 1 的 payload = `channel_length:u16` big-endian \| `channel` \| `data` | 帧写为 5 字节头加载荷；二进制载荷带 u16 channel 长度、UTF-8 channel、再跟字节。**超长或未知 kind 对读循环是致命错误** | plugin→host | 无 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:513（`let maximum = if kind == FRAME_KIND_JSON { MAX_JSON_BYTES } else { MAX_BINARY_BYTES + 1024 };`） |

### 7.8 Go SDK（`dbxpluginsdk`）

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `NewServer` / `Server.Serve` | `func NewServer(metadata Metadata, handler Handler) *Server`；`(*Server).WithIO(input io.Reader, output io.Writer, errorsWriter io.Writer)`；`(*Server).WithTransport(Transport)`；`(*Server).Serve() error` | Rust server 的 Go 对应物。`NewServer` 默认 `os.Stdin`/`os.Stdout`/`os.Stderr`；`WithIO` 与 `WithTransport(TransportFramed)` 用于配置；`Serve()` 跑循环并为每个请求起独立 goroutine 分派 | host→plugin | 无 | plugins/sdk/go/dbx-plugin-sdk/sdk.go:190；Metadata 为 `{ID, Version, Capabilities}`（sdk.go:28）；JSONL 扫描缓冲初值 64 KiB、上限 8 MiB（sdk.go:202） |
| `Handler` / `BinaryHandler` / `HandlerFunc` | `Handle(context RequestContext, method string, params json.RawMessage, emitter *Emitter) (any, *PluginError)`；`HandleBinary(channel string, data []byte, emitter *Emitter) *PluginError` | Go 端 handler 契约：`Handler` 处理 JSON-RPC 方法，可选的 `BinaryHandler` 由类型断言探测以接收带帧的 host→plugin 消息；`HandlerFunc` 把普通函数适配成 `Handler` | host→plugin | 无 | plugins/sdk/go/dbx-plugin-sdk/sdk.go:53；未实现 `BinaryHandler` 时二进制帧得到 -32601 `"Binary input is not supported"`（sdk.go:338） |
| `Emitter` | `(*Emitter).Event(method string, params any) *PluginError`；`(*Emitter).Binary(channel string, data []byte) *PluginError` | 镜像 `PluginEmitter` 的 Go 发射器：`Event` 发 JSON-RPC 通知，`Binary` 写带帧二进制消息（仅 framed）。两者都校验名称与尺寸。**注意 Go 的 `Emitter` 没有公开的 respond 方法——响应由 server 循环写出** | plugin→host | 无 | plugins/sdk/go/dbx-plugin-sdk/sdk.go:78 |
| `DataDirEnvVar` / `DataDir` / `EnsureDataDir` | `DBX_PLUGIN_DATA_DIR=<abs path>`；`DataDir() string`；`EnsureDataDir() (string, error)` | 宿主在每个 sidecar 上设置 `DBX_PLUGIN_DATA_DIR`，指向插件的持久数据目录。`DataDir()` 读取它（独立运行时为空串），`EnsureDataDir()` 以 0700 创建，宿主要没提供则报错。这是**批量插件数据的官方去处**，与 `host.storage` 相对。Rust SDK 没有等价封装——Rust 后端自己读该变量 | host→plugin | 无 | plugins/sdk/go/dbx-plugin-sdk/sdk.go:415 |
| `validProtocolName`（Go） | `[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}` | Go 侧方法名校验：首字符为字母数字，后续还可含 `.` `_` `:` `/` `-`，长度 1..256。对请求方法与二进制 channel 都生效 | n/a | 无 | plugins/sdk/go/dbx-plugin-sdk/sdk.go:392 |
| Go 侧协议常量 | `ProtocolVersion = 1`、`maxJSONBytes = 8 * 1024 * 1024`、`maxBinaryBytes = 64 * 1024 * 1024`、`frameHeaderBytes = 5` | 与 Rust SDK 一一对应 | n/a | 无 | plugins/sdk/go/dbx-plugin-sdk/sdk.go:15-19 |

### 7.9 Rust SDK 与 Go SDK 的能力差异（必须显式掌握）

| 差异点 | Rust 侧 | Go 侧 | 影响 | 证据 |
| --- | --- | --- | --- | --- |
| 名称校验规则不同（上限/字符集） | `validate_protocol_name`：非空、**≤256 字节、只要不含空白字符即可** | `validProtocolName`：正则 `[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}`，**额外要求首字符为字母数字，且后续字符限定在给定集合内** | 两套规则并不等价：Rust 的「任意非空白 ≤256 字节」在字符集上是 Go 规则的超集，因此**Go 侧实际更严格**（例如含 `$`、`#`、空格的名称 Rust 通过、Go 拒绝；而 Go 允许的名称 Rust 全都接受）。条目里的 notes 把它描述为「Go 只多允许 `. _ : / -`、比 Rust 更宽松」，按两条签名逐字推演并不成立——评审时以签名/正则本身为准 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:674；plugins/sdk/go/dbx-plugin-sdk/sdk.go:392 |
| 数据目录辅助 | 无包装：Rust 后端须自行 `env::var("DBX_PLUGIN_DATA_DIR")` | 有 `DataDir()` / `EnsureDataDir()`，后者自动 0700 创建并在缺失时报错 | Rust 作者的「宿主没给目录」这一分支是自己写的，容易漏掉 0700 与必填校验 | plugins/sdk/go/dbx-plugin-sdk/sdk.go:415 |
| 二进制入站帧的接口形态 | trait 方法 `handle_binary`，默认实现返回 -32601 | 独立的 `BinaryHandler` 接口，由类型断言探测，未实现时同样 -32601 | 语义一致，接线方式不同 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:82；plugins/sdk/go/dbx-plugin-sdk/sdk.go:338 |
| 并发模型 | 自带 worker 池：`worker_threads` / `work_queue_capacity`，默认 256 队列、`available_parallelism().clamp(2,16)` 线程 | `Serve()` 对每个请求起一个 goroutine，无显式队列配置 | Rust 侧可调并发上限，Go 侧不可；两边的背压行为因此不同 | plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:437；plugins/sdk/go/dbx-plugin-sdk/sdk.go:190 |
| 响应写出 | handler 通过返回 `Result<Value, PluginError>` 让 server 写响应 | `Emitter` 无公开 respond 方法，响应一律由 server 循环写出 | 相同心智模型，Go 侧不可能从 handler 里越权写响应 | plugins/sdk/go/dbx-plugin-sdk/sdk.go:78 |

### 7.10 `dbx-plugin dev` 与 dev-host

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `dbx-plugin dev` | `dbx-plugin dev [--path DIR] [--port PORT] [--data-dir DIR]` | 让插件对着本地浏览器开发宿主运行，**不启动 DBX**。默认 path `.`、port 5190（被占则退回到空闲端口；`0` 表示任意空闲端口）、data dir `<project>/.dbx-dev`。要求 Node.js 22+ | n/a | 无 | plugins/sdk/cli/src/dev.rs:27（`let mut options = Options { path: PathBuf::from("."), port: 5190, data_dir: None };`） |
| dev 的进程分工 | Rust CLI 只构建启动描述符；真正的宿主是 Node | host 位于 `DBX_PLUGIN_DEV_RUNTIME`（默认 `../dev-host/dist/runtime.mjs`） | n/a | 无 | plugins/sdk/cli/src/dev.rs:27（notes） |
| `DBX_PLUGIN_DEV_RUNTIME` / `DBX_PLUGIN_NODE` | `DBX_PLUGIN_DEV_RUNTIME=<path to runtime.mjs>`；`DBX_PLUGIN_NODE=<node executable>`；要求 major ≥ 22 | `dev` 从 `DBX_PLUGIN_DEV_RUNTIME` 定位 Node 运行时（默认相对 CLI 源的 `../dev-host/dist/runtime.mjs`），用 `DBX_PLUGIN_NODE`（默认 `node`）选 Node，并解析 `node --version` 强制 22+ | n/a | 无 | plugins/sdk/cli/src/dev.rs:173 |
| 运行时缺失时的提示 | 提示执行 `npm ci --prefix plugins/sdk/dev-host && npm run build` 并设置 `DBX_PLUGIN_DEV_RUNTIME`；Unix 上 CLI 会 `exec` 进 Node，使 Ctrl+C 与信号透传 | n/a | 无 | plugins/sdk/cli/src/dev.rs:198 |
| dev 启动描述符 | `{ project, dataDir, port, commands: { ui: string[], watch: string[], backend?: {command,args,cwd,goWorkspace?} }, backend?: path, backendWatch?: path }` | CLI 通过 `--config` 把 JSON 描述符交给 Node 运行时：project、dataDir、port、来自 `[dev]` 的 `commands.ui`/`commands.watch`、可选的编译后 `commands.backend` 规格、解析出的后端二进制路径与后端 watch 目录 | n/a | 无 | plugins/sdk/cli/src/dev.rs:84 |
| `[dev] ui_build` / `ui_watch` | `ui_build = ["npm","run","build"]`；`ui_watch = ["npm","run","build:watch"]`；必需的 stdout marker：`DBX_UI_BUILD_SUCCESS` | `ui_build` 是启动时执行一次的命令数组，`ui_watch` 是 watch 模式数组；两者都以可执行文件/参数数组形式执行、**不经 shell**。**只有当 watch 命令在构建完全写完之后打印独占一行的 `DBX_UI_BUILD_SUCCESS` 时，运行时才会自动重载 UI** | n/a | 无 | plugins/sdk/cli/src/dev.rs:12 |
| 无 `ui_watch` 时的回退 | 静态 UI 文件走去抖的文件系统监听 | `deny_unknown_fields` 意味着意外的 `[dev]` 键是解析错误 | n/a | 无 | plugins/sdk/cli/src/dev.rs:12（notes） |
| dev 后端的构建目录 | Rust 后端构建进 `<dataDir>/rust-target/debug`；Go 后端进 `<dataDir>/bin` | 与 `package` 的 release 目录分离，互不污染 | n/a | 无 | plugins/sdk/cli/src/dev.rs:107、dev.rs:143 |
| `createMockHost` | `manifest_version` 必须为 1；`engines.host_api` 必须满足 1.0.0；backend transport 属于 `{stdio-jsonl, stdio-framed}`；`entrypoints.ui.entry` 必须在 root 下可读 | dev host 在 Node 里搭一个 mock DBX 宿主：校验 `manifest_version` 与 `engines.host_api`，解析声明的 UI root/entry，启动连接存储与类型化 sidecar，并**拒绝嵌套在 UI 资源根内的 dev 数据目录** | n/a | 无 | plugins/sdk/dev-host/server.mjs:42 |
| mock host 的桥接上限 | Bridge payload 2 MiB、UI binary 8 MiB、storage value 256 KiB、storage total 1 MiB | 与宿主基线一致（plugins/sdk/dev-host/server.mjs:13-16） | n/a | 无 | plugins/sdk/dev-host/server.mjs:13-16 |
| `GET /api/diagnostics` | `GET /api/diagnostics?after=<id>&limit=<1-500>&level=debug\|info\|error&instanceId=<id>` | dev host 暴露一个只读、面向 agent 的诊断 HTTP API，**无需浏览器会话**，返回 `entries`、`nextAfter`、`hasMore`、`instanceId`、`reset`、`truncated`、`oldestId`、`latestId`、`plugin`、`backendState`、`port`。内存中只保留最近 500 条；对 password/token/credential 及 manifest 声明的 secret 字段做脱敏；**不能调用插件操作**；只支持 GET，Host/Origin 校验保持开启且不启用 CORS | n/a | 无 | plugins/sdk/dev-host/README.md:99 |
| `go.work` 物化（dev host） | 写出 `<dataDir>/go.work`，内容是 `go <version>` 加 `use ( ... )`，取自 `commands.backend.goWorkspace`，然后给构建命令导出 `GOWORK` | 当 CLI 的启动描述符带了 Go 后端与 `goWorkspace`（项目目录 + `DBX_PLUGIN_SDK_ROOT` 的 Go SDK）时，Node 运行时在 dev 数据目录里写一份私有 `go.work` 并把 `GOWORK` 指过去，让 sidecar 对着本地 Go SDK 构建而**不改动项目的 go.mod**。`go` 指令取所列模块 `go` 指令的最大值（`resolveGoWorkVersion`） | n/a | 无 | plugins/sdk/dev-host/runtime.mjs:56；`resolveGoWorkVersion` 在 runtime.mjs:28 |
| `@dbx-app/plugin-dev-host-source` | `{ private: true, type: module, engines.node >=22, scripts.build = node build.mjs }` | dev host 是**未发布**的源码包；`build.mjs` 用 esbuild（platform node、target node22）打包 `runtime.mjs`，用 vite + vite-plugin-singlefile 打包 Vue/Tailwind 外壳，产出到 `dist/`，再由 `stage-dev.mjs` 拷到 `packages/plugin-cli/dev-runtime/` | n/a | 无 | plugins/sdk/dev-host/package.json:2（`private:true` 在第 3 行，`engines.node ">=22"` 在第 13 行） |

### 7.11 npm 分发链

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `@dbx-app/plugin-cli` | `{ "bin": { "dbx-plugin": "bin/dbx-plugin.js" }, "files": ["bin","README.md","sdk-root","dev-runtime"], "type": "module", "engines": { "node": ">=18.18.0" } }` | 启动器包，随包附带 SDK 源码与预构建 dev 运行时；六个 `optionalDependencies` 平台包意味着安装时**不做任何编译**。版本 0.1.9 | n/a | 无 | packages/plugin-cli/package.json:19；可选依赖钉在同一 0.1.9 版本（package.json:36-43） |
| `@dbx-app/plugin-cli-<platform>` | `darwin-arm64` \| `darwin-x64` \| `linux-arm64` \| `linux-x64` \| `win32-arm64` \| `win32-x64` | 平台二进制分布在六个可选包里，每包对应一组 OS/arch 并约束 `os`/`cpu`，使 npm 只装匹配的那一个。**更正：六个真实包名在 Linux 上带 `-gnu` 后缀（`@dbx-app/plugin-cli-linux-x64-gnu`、`...-linux-arm64-gnu`），且每个包把自己的 bin 声明为别名 `dbx-plugin-native` 而不是 `dbx-plugin`——按条目原始签名里的名字是装不上的** | n/a | 无 | packages/plugin-cli/bin/dbx-plugin.js:11 |
| `dbx-plugin-native`（bin 别名） | `"bin": { "dbx-plugin-native": "bin/dbx-plugin" }`（win32 为 `"bin/dbx-plugin.exe"`） | 六个可选平台包暴露的是别名 `dbx-plugin-native`；启动器自己用 `require.resolve(pkg/package.json)` + `join(dirname, 'bin', 'dbx-plugin[.exe]')` 定位文件，所以该别名从不被程序使用。Linux 包名为 `@dbx-app/plugin-cli-{linux-x64,linux-arm64}-gnu` | n/a | 无 | packages/plugin-cli-darwin-arm64/package.json:18；packages/plugin-cli-linux-x64-gnu/package.json:21 |
| `bin/dbx-plugin.js` 环境契约 | 环境覆盖：`DBX_PLUGIN_CLI_BINARY`、`DBX_PLUGIN_SDK_ROOT`、`DBX_PLUGIN_DEV_RUNTIME`、`DBX_PLUGIN_NODE`；特殊开关 `--verify-platform` | 启动器解析平台二进制（可用 `DBX_PLUGIN_CLI_BINARY` 覆盖），对 `dev` 特殊处理：要求 Node 22+ 并导出 `DBX_PLUGIN_NODE=process.execPath` 与 `DBX_PLUGIN_DEV_RUNTIME=<pkg>/dev-runtime/runtime.mjs`；当自带 SDK 存在时设置 `DBX_PLUGIN_SDK_ROOT=<pkg>/sdk-root`。显式的 `DBX_PLUGIN_SDK_ROOT` 或 `DBX_PLUGIN_DEV_RUNTIME` 总是优先于自带默认值（bin/dbx-plugin.js:75-78） | n/a | 无 | packages/plugin-cli/bin/dbx-plugin.js:71 |
| 缺平台包时的提示 | 提示在没有 `--no-optional` 的情况下重装 | 由 launcher 给出，而不是 npm 的原始错误 | n/a | 无 | packages/plugin-cli/bin/dbx-plugin.js:11（notes） |
| `scripts/stage-sdk.mjs` / `stage-dev.mjs` | `node scripts/stage-sdk.mjs [--clean]`；`node scripts/stage-dev.mjs [--clean]` | `prepack` 时 stage-sdk 把 Rust/Go SDK 源码拷进 `packages/plugin-cli/sdk-root/plugins/sdk/{rust,go}/dbx-plugin-sdk`（排除 `target/`、`Cargo.lock`、`.gitignore`、`.DS_Store`）并断言 npm 包版本等于 CLI 的 Cargo.toml 版本；stage-dev 构建 `plugins/sdk/dev-host` 并把 `dist/` 拷到 `packages/plugin-cli/dev-runtime/`；`postpack` 清理两者 | n/a | 无 | packages/plugin-cli/scripts/stage-sdk.mjs:17；stage-dev 要求 Node 22+ 且 `plugins/sdk/dev-host` 下有 `node_modules/vite`（scripts/stage-dev.mjs:11-12） |
| 启动器单元测试 | `node --test tests/*.test.mjs`；用 `DBX_PLUGIN_CLI_BINARY=process.execPath` 打桩二进制 | 启动器的 env 契约由测试钉死：转发参数、导出暂存的自带 SDK root、保留显式 `DBX_PLUGIN_SDK_ROOT`、在缺 `DBX_PLUGIN_CLI_BINARY` 时报错、以及 `dev` 注入自带 `dev-runtime/runtime.mjs` 与 `process.execPath`（除非被覆盖） | n/a | 无 | packages/plugin-cli/tests/dev-launcher.test.mjs:9；由 `npm --prefix packages/plugin-cli test` 运行，并在 plugin-cli-release 的 prepare 作业中再跑一次（.github/workflows/plugin-cli-release.yml:149） |
| `verify-plugin-cli-package.mjs` | `DBX_PLUGIN_CLI_VERIFY_NATIVE=1 node scripts/verify-plugin-cli-package.mjs` | 构建 Rust CLI，用真二进制暂存一个平台包，对两者 `npm pack`，在临时目录里以 `--ignore-scripts` 安装，断言 `dbx-plugin --version` 输出，然后对每个模板跑 `create --yes` + `package`，并启动打包进去的 dev 运行时通过 HTTP 演练 workbench、连接与一次后端 RPC | n/a | 无 | scripts/verify-plugin-cli-package.mjs:89；Rust/Go 模板只在 `DBX_PLUGIN_CLI_VERIFY_NATIVE=1` 时被演练；它从 `ui/index.html` 里读 starter 自己的 `invoke("...")` 去调后端，所以模板的 ping 方法本身也在被测 |
| `plugin-cli-release.yml` | `on: push tags ["plugin-cli-v*"]`；作业：`prepare` → `refresh-lockfile` / `publish-platforms`[6] → `publish-launcher` → `verify` | 由 `plugin-cli-v*` tag 触发：校验 tag 与 CLI/npm 版本一致，跑 Rust CLI 测试、dev 运行时构建、npm 启动器测试与打包安装验证器，然后发布六个平台包加启动器，最后再验证一次干净的 npm 安装。**更正：验证作业的 id 是 `verify-published-package`，不是 `verify`** | n/a | 无 | .github/workflows/plugin-cli-release.yml:255；Linux 二进制用 `cargo zigbuild --target <triple>.2.31` 做 glibc 兼容构建（plugin-cli-release.yml:316）；发布用 `npm publish --provenance` |

### 7.12 UI 模板

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `common/ui/index.html`（vanilla 模板） | `window.dbxPlugin.ready`；`.locale`；`.context`；`.invoke("<prefix>/ping", { connectionId })` | vanilla 脚手架是一个自包含的 `ui/index.html`：等待 `window.dbxPlugin.ready`，按 `window.dbxPlugin.locale` 取 en/zh 文案，按钮上调用 `window.dbxPlugin.invoke("{{METHOD_PREFIX}}/ping", { connectionId })`——最小的端到端 Host Bridge 演示。样式使用 `Canvas`/`CanvasText` 与 `color-mix`，无外部资源、无框架。**更正：早前「同一文件用普通 CSS 记录了 DBX 组件套件类名」的说法不成立——`plugins/sdk/cli/templates` 下没有任何文件提到组件套件，`common/ui/index.html` 是一个 56 行、只有内联样式的自包含页面** | ui→host | 无 | plugins/sdk/cli/templates/common/ui/index.html:36 |
| `svelte/vite.config.js` | `plugins: [svelte(), dbx-build-signal]`；`build: { outDir: "ui", emptyOutDir: true }` | Svelte 模板用 Vite 把 `src/` 编译进 `ui/`，并注入 `dbx-build-signal` 插件，其 `closeBundle` 打印字面量 `DBX_UI_BUILD_SUCCESS`——正是 dev host 监听用于自动重载的那一行 | n/a | 无 | plugins/sdk/cli/templates/svelte/vite.config.js:7；输出目录 `ui` 与 `entrypoints.ui.root` 一致，由 CLI 测试断言（plugins/sdk/cli/src/lib.rs:1944） |
| `svelte/package.json` | `scripts: { "build": "vite build", "build:watch": "vite build --watch" }`；`devDependencies: svelte ^5.38.7, @sveltejs/vite-plugin-svelte ^6.2.1, vite ^7.1.5` | 生成的 Svelte 工程钉 svelte 5.38 / vite-plugin-svelte 6.2 / vite 7.1，并带两个被 svelte 模板 `[dev]` 的 `ui_build`/`ui_watch` 引用的脚本 | n/a | 无 | plugins/sdk/cli/templates/svelte/package.json:7 |
| Svelte 包名与可见性 | 包名 `{{PLUGIN_ID}}-ui`，且 `private: true` | 因此该 UI 包永不会被发布 | n/a | 无 | plugins/sdk/cli/templates/svelte/package.json:7（notes） |

### 7.13 后端模板

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `templates/rust/backend/src/main.rs` | `match method { "connection/test" \| "connection/connect" \| "connection/disconnect" \| "{{METHOD_PREFIX}}/ping" => ..., _ => Err(PluginError::method_not_found(method)) }` | 生成的 Rust 后端是一个能跑的 sidecar：`Plugin` 结构体实现 `PluginHandler`，用 `HashSet` 保存连接注册表，应答 test/connect/disconnect 以及模板特有的 `<prefix>/ping`（回显 plugin id、language 与 connectionId） | host→plugin | 无 | plugins/sdk/cli/templates/rust/backend/src/main.rs:12；`main()` 构造 `PluginMetadata::new("{{PLUGIN_ID}}", env!("CARGO_PKG_VERSION")).with_capability("connections")` 并调用 `.serve()`（main.rs:67-70） |
| `templates/go/backend/main.go` | `func (plugin *plugin) Handle(_ dbxpluginsdk.RequestContext, method string, params json.RawMessage, _ *dbxpluginsdk.Emitter) (any, *dbxpluginsdk.PluginError)` | 生成的 Go 后端镜像 Rust 版：互斥锁保护的 `map[string]struct{}` 注册表，同样四个方法，兜底 `dbxpluginsdk.MethodNotFound(method)` | host→plugin | 无 | plugins/sdk/cli/templates/go/backend/main.go:16；`main()` 构造 `Metadata{ID, Version, Capabilities: []string{"connections"}}` 并调用 `server.Serve()`（main.go:64-74） |
| `templates/rust/backend/Cargo.toml` | `[profile.release] strip = true; lto = true; codegen-units = 1` | 生成的 Rust 后端带一个为 sidecar 体积调优的 release profile，并显式注释 panic 保持 `unwind` 以便协议能把 panic 报成错误；空 `[workspace]` 用于脱离任何父 workspace | n/a | 无 | plugins/sdk/cli/templates/rust/backend/Cargo.toml:17；依赖是 `dbx-plugin-sdk` 加 `serde_json = "1"`（第 10-11 行） |

### 7.14 生成 manifest 与 contribution

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 模板生成的 contributions | `[ {type:"connection-provider", id, label, icon, database_type, description, fields[], workbench, capabilities[]}, {type:"workbench", id, label, description, icon} ]` + `localizations["zh-CN"]` | rust/go 模板的 manifest 声明一个 connection-provider（`database_type`，fields 为 `display_name`/`host`/`port` 绑定到 `name`/`host`/`port`，带 workbench 链接，capabilities 为 test/connect/disconnect）加一个 workbench contribution，并附 zh-CN localizations 翻译两者。frontend/svelte 的 manifest 只声明 workbench | declarative | 无 | plugins/sdk/cli/templates/common/manifest.json:25 |
| 生成的 engines 与 `$schema` | `engines: { dbx: ">=0.5.68", host_api: "1" }` | 三个模板一致；`$schema` 指向 `plugin-sdk-v1` 分支 | declarative | 无 | plugins/sdk/cli/templates/common/manifest.json:25（notes） |
| `permissions[]` | `host.events` \| `host.binary` \| `host.workbench` \| `host.filesystem` \| `host.plans:read` \| `host.storage` \| `host.ai` \| `host.network:https://<host>[:port]` | manifest 的 `permissions` 数组接受七个具名桥接权限加一个受约束的 network origin 字符串形式；其它任何值都过不了 schema 校验。每个需要特权的 `window.dbxPlugin` 调用映射到其中之一 | declarative | 同上（自身即权限声明） | plugins/manifest.schema.json:33；network 形式正则 `^host\.network:https://[A-Za-z0-9._-]+(:[0-9]+)?$`——仅 https、仅 host[:port]、不允许路径（manifest.schema.json:34） |
| contribution 类型枚举 | `connection-provider` \| `workbench` \| `context-menu` \| `result-view` \| `filesystem-provider` | schema 固定了 v1 的五种 contribution 类型及各自必填字段，CLI 模板与打包器校验都以此为前提。`filesystem-provider` 要求 `schemes` 与匹配 `^[a-z0-9._-]+:.+$` 的 `root_uri`，capabilities 取自 read/write/delete/rename/mkdir | declarative | 无 | plugins/manifest.schema.json:348；`context-menu.menu` 是枚举 `["connection","table"]`（manifest.schema.json:328），`connection-provider.capabilities` 的项是枚举 test/connect/disconnect（manifest.schema.json:285） |
| frontend 模板的打包结果 | `dist/<id>-<version>-universal.dbxp` + `dist/<id>-<version>-universal.artifact.json` | `frontend`（非 Svelte）模板产出且仅产出 universal 包、不带后端：没有 `backend/` 目录、manifest 没有 `entrypoints.backend`、TOML 没有 `[backend]`，生成的 workflow 传 `"target":"universal"` | n/a | 无 | plugins/sdk/cli/src/lib.rs:1938（`assert!(manifest["entrypoints"].get("backend").is_none());`）；文件名断言在 lib.rs:1991 = `"com.example.frontend-package-1.2.3-universal.dbxp"` |

### 7.15 CI 发版链路与参考插件

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `.github/workflows/plugin-release.yml`（模板生成） | `on: release[published]`；`uses: t8y2/dbx/.github/workflows/plugin-release-reusable.yml@plugin-cli-v<ver>`，with: `release-tag, package-command, package-path, metadata-path, plugin-cli-version, go-version, rust-toolchain` | 生成的工程自带一个发版工作流，委派给钉在 `plugin-cli-v<CLI_VERSION>` 的可复用工作流，传入 release tag、package/metadata glob、匹配的 plugin-cli-version，以及模板特有的 go-version/rust-toolchain（空串跳过对应工具链） | n/a | 无 | plugins/sdk/cli/templates/common/github/plugin-release.yml:12 |
| `build-matrix: universal` 输入 | `build-matrix: '{"include":[{"runner":"ubuntu-24.04","target":"universal"}]}'` | **更正：前面漏掉了 frontend 与 svelte 生成的 workflow 总会传的 `build-matrix` 输入——不传它，可复用工作流就会跑五目标原生矩阵**。这条输入正是前端包名为 `<id>-<version>-universal.dbxp` 的原因；原生模板不传该输入，因此继承可复用工作流的五组 runner/target | n/a | 无 | plugins/sdk/cli/templates/frontend/github/plugin-release.yml:21（frontend/svelte 用的是 `templates/frontend/github/plugin-release.yml`，而不是上面那条 common 原生变体） |
| 生成 workflow 不含签名机密 | CLI 测试断言生成物既无 `signing-key-id` 也无 `DBX_PLUGIN_SIGNING_KEY` | 作者侧的发版流水线只产未签名候选 | n/a | 无 | plugins/sdk/cli/src/lib.rs:1925 |
| `plugin-release-reusable.yml` | `workflow_call` 输入：`release-tag`(必填)、`package-command`(必填)、`working-directory`、`package-path="dist/*.dbxp"`、`metadata-path="dist/*.artifact.json"`、`node-version="22"`、`go-version="1.22.x"`、`rust-toolchain="stable"`、`sdk-ref="plugin-sdk-v1"`、`plugin-cli-version`、`install-plugin-cli`、`install-plugin-cli-from-source`、`build-matrix` | 可复用工作流在**真实 runner** 上跨五个原生 target 矩阵构建未签名候选，并为纯前端插件做一次 universal 构建。它要么装预编译的 npm CLI，要么从钉住的 `sdk-ref` 执行 `cargo install --locked --path .dbx-plugin-sdk/plugins/sdk/cli` | n/a | 无 | .github/workflows/plugin-release-reusable.yml:66（矩阵为 `ubuntu-24.04/linux-x64`、`ubuntu-24.04-arm/linux-arm64`、`windows-2022/windows-x64`、`macos-15-intel/darwin-x64`、`macos-15/darwin-arm64`）；从矩阵设 `DBX_PLUGIN_TARGET`，`DBX_PLUGIN_SDK_ROOT` 只在源码构建 CLI 时设置（plugin-release-reusable.yml:158-162） |
| `release-candidates.json` 聚合 | `{ "plugin": { id, name, description, publisher, version, permissions[] }, "artifacts": [ {target,url,sha256,size} ] }` | publish 作业在上传前校验每个候选：拒绝重复包文件名；要求 sha256 是 64 位十六进制且 size 与实际字节数一致；拒绝候选元数据里声明了 `signingKeyId`；拒绝任何含有 `signature.json` 的包；要求所有 target 共享同一套 manifest 身份 | n/a | 无 | .github/workflows/plugin-release-reusable.yml:230；产出 `release-candidates.json`（:248），并把所有 `.dbxp` 加该文件以 `--clobber` 上传到 release |
| `plugins/sdk/templates/github/plugin-release.yml`（手抄模板） | `uses: ...plugin-release-reusable.yml@plugin-sdk-v1`；`plugin-cli-version: 0.1.2`；注释里的 `build-matrix` universal 示例 | 第二份**手工复制**的发版工作流，RELEASING.md 让作者抄它而不是用脚手架。与生成模板不同，它把可复用工作流钉在分支 `@plugin-sdk-v1`、`plugin-cli-version` 为 0.1.2，**两处都是陈旧的** | n/a | 无 | plugins/sdk/templates/github/plugin-release.yml:12；RELEASING.md:65 指名这条路径；而 CLI 自己的测试断言生成的 workflow 不得含 `@plugin-sdk-v1`（plugins/sdk/cli/src/lib.rs:1929），也就是说这条手抄路径悄悄制造了测试所禁止的钉法 |
| `plugins/examples/hello-workbench` | 文件：`manifest.json`、`assets/`、`backend/`、`ui/index.html`、`package.mjs`、`repository-sign.mjs`、`repository-smoke.mjs`、`smoke.mjs` | 一个把整条契约都跑通的参考插件：原生 Rust sidecar、带 common/config/secret 绑定的 connection-provider、test/connect/disconnect 生命周期、按连接分组的注册表、异步事件、沙箱 workbench、workbench→sidecar RPC，以及一个由 DBX 自带文件管理器渲染的只读 filesystem contribution | n/a | 无 | plugins/examples/hello-workbench/README.md:3；可复用的 smoke 可执行文件在 `crates/dbx-core/examples/plugin_package_smoke.rs`（README.md:30） |
| `hello-workbench/package.mjs` | `node plugins/examples/hello-workbench/package.mjs [DBX_PLUGIN_OUTPUT_DIR=...] [DBX_PLUGIN_TARGET=...]` | 存在签名环境变量时**拒绝运行**，用 `cargo build --locked --release` 构建 Rust 后端，把 `bin/<target>/<exe>` + 重写后的 manifest + assets + ui 暂存进临时目录，再以 `--artifact-metadata`、`--target`、`--artifact-url` 调 packager | n/a | 无 | plugins/examples/hello-workbench/package.mjs:21；`DBX_PLUGIN_TARGET` 必须等于原生构建宿主否则脚本拒绝；暂存目录在 `finally` 中清理 |
| `hello-workbench/repository-sign.mjs` | `node plugins/examples/hello-workbench/repository-sign.mjs [candidate.dbxp] [signed.dbxp]` | 演示仓库运维方流程：要求 `DBX_PLUGIN_SIGNING_KEY` 与 `DBX_PLUGIN_SIGNING_KEY_ID`，对候选包执行 `dbx-plugin-packager sign`（带 `--artifact-metadata --target --artifact-url`），然后就地更新 `catalog.example.json`（新增 artifact 或替换同 target 条目，按 target 排序） | n/a | 无 | plugins/examples/hello-workbench/repository-sign.mjs:23；设 `DBX_PLUGIN_SKIP_EXAMPLE_CATALOG=1` 可只签名不动示例 catalog |
| `hello-workbench/smoke.mjs` / `repository-smoke.mjs` | `node plugins/examples/hello-workbench/smoke.mjs [package.dbxp] [DBX_PLUGIN_SMOKE_TRUSTED_KEYS_JSON='{"key-id":"<base64>"}']` | 打包 → 装进临时插件 store → 校验 manifest 兼容性与图标资产 → 启动并初始化 sidecar → 测试/连接一条已保存连接 → 调用插件方法 → 通过类型化 filesystem host API 列出与预览文件 → 观察连接与进度事件 → 断开 → 停 sidecar → 卸载 | n/a | 无 | plugins/examples/hello-workbench/README.md:67；`repository-smoke.mjs` 跑同一流程，但用工作区外生成的临时仓库密钥，在严格签名策略下签名并安装 |

### 7.16 本章涉及的版本门槛与注意事项汇总

- `dbx-plugin-cli` / `@dbx-app/plugin-cli` / 六个平台包当前统一为 **0.1.9**（plugins/sdk/cli/Cargo.toml:11；packages/plugin-cli/package.json:19、:36-43）。
- `SDK_VERSION = "0.1.0"`：`create` 生成的 Rust 依赖与 Go `require` 都钉这个版本（plugins/sdk/cli/src/lib.rs:17）。
- `dbx-plugin dev` 与 dev-host 源码包都要求 **Node.js 22+**；npm 启动器本身的 `engines.node` 只是 `>=18.18.0`（packages/plugin-cli/package.json:19），两者不是同一个门槛。
- 模板生成的 manifest 声明 `engines: { dbx: ">=0.5.68", host_api: "1" }`（plugins/sdk/cli/templates/common/manifest.json:25）；dev host 的 `createMockHost` 则要求 `manifest_version == 1` 且 `engines.host_api` 满足 `1.0.0`（plugins/sdk/dev-host/server.mjs:42）。
- 作者侧**不能**签名：`create --signing-key-id` 与 `package --key-id` 都是硬错误（plugins/sdk/cli/src/lib.rs:363、:408）；签名由仓库运维方用 `dbx-plugin-packager sign` 加 `DBX_PLUGIN_SIGNING_KEY`/`_KEY_ID` 完成（plugins/sdk/packager/src/main.rs:74、:544）。
- `LocalDevelopment` 策略接受未签名包，`LocalSigned` 拒绝；官方/市场路径还要求来源与 publisher 跨更新一致（crates/dbx-plugin-runtime/src/plugins/installer.rs:812、:502）。
- 打包器与安装器的尺寸上限是同一组数字（512 MiB / 1 GiB / 256 MiB / 10000 条），改一边不会自动同步另一边（plugins/sdk/packager/src/main.rs:13；crates/dbx-plugin-runtime/src/plugins/installer.rs:19、:22-25）。
- 文档与实现的已知不一致：`create_usage()` 漏掉 svelte（plugins/sdk/cli/src/lib.rs:1614）、`plugins/README.md` 漏掉 dev/keygen（plugins/README.md:23）、`plugins/sdk/templates/github/plugin-release.yml` 被 RELEASING.md 推荐却又与 CLI 测试相冲突（plugins/sdk/templates/github/plugin-release.yml:12 对比 plugins/sdk/cli/src/lib.rs:1929）。

## 8. 集成点

本章按「宿主暴露给谁」分层：先列桌面壳对前端开放的 Tauri 命令面（`ui->host` IPC），再列宿主主动发给 webview 的事件（`host->ui`），然后是宿主与 sidecar 之间的 JSON-RPC 契约（`host->plugin` / `plugin->host`），最后是贡献点如何真正接进连接对话框、SQL 编辑器、结果网格、文件浏览和各个宿主（desktop / web / cli / 无头 MCP）。

> 方向约定：本章 Tauri 命令一律标为 `ui->host`（前端经 IPC 调宿主）。原始审计条目中不少命令的 `direction` 字段写的是 `host->plugin`，那指的是「这条命令属于插件功能面」而非调用方向，实际调用方始终是前端。真正的 `host->plugin` 只出现在 sidecar JSON-RPC 一节。

### 8.1 插件管理命令（Tauri，`src-tauri/src/commands/plugins.rs`，全部注册在 `lib.rs` 的 `invoke_handler`）

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `list_plugins` | `list_plugins() -> Vec<InstalledPluginInfo>` | 返回每个已安装插件的 manifest + compatibility + 来源信息 | ui->host | none | `src-tauri/src/commands/plugins.rs:23-24` |
| `list_plugin_trusted_keys` / `save_plugin_trusted_key` / `remove_plugin_trusted_key` | `save_plugin_trusted_key(keyId: string, publicKey: string) -> Vec<PluginTrustedKey>` | Ed25519 信任库 CRUD，安装时包签名校验的依据 | ui->host | none | `src-tauri/src/commands/plugins.rs:42-44` |
| `list_plugin_repositories` / `save_plugin_repository` / `remove_plugin_repository` | `save_plugin_repository(repository: PluginRepository) -> Vec<PluginRepository>` | 市场仓库列表管理，经 `PluginMarketplace::new(root_dir, app_version)` | ui->host | none | `src-tauri/src/commands/plugins.rs:80-83` |
| `fetch_plugin_marketplace_catalogs` | `fetch_plugin_marketplace_catalogs() -> Vec<PluginRepositoryCatalogResult>` | 拉取所有已启用仓库目录；单个仓库失败以 in-band 错误返回，不整体失败 | ui->host | none | `src-tauri/src/commands/plugins.rs:108-113` |
| `install_marketplace_plugin` | `install_marketplace_plugin(request: PluginMarketplaceInstallRequest) -> PluginInstallResponse` | 从目录条目安装，随后停掉被替换的 runtime 并发出 `plugin-runtime-replaced`，让已打开的 workbench 标签重载 | ui->host | none | `src-tauri/src/commands/plugins.rs:117-128` |
| `install_plugin_package` | `install_plugin_package(path: String, allowUnsigned: bool) -> PluginInstallResponse` | 本地 `.dbxp` 安装；`allowUnsigned` 决定 `PluginInstallPolicy::LocalDevelopment` 还是 `LocalSigned` | ui->host | none | `src-tauri/src/commands/plugins.rs:195` |
| `install_plugin_package_from_url` | `install_plugin_package_from_url(url: String, allowUnsigned: bool) -> PluginInstallResponse` | URL 安装，下载进度以 `plugin-url-download-progress` 事件流式上报 | ui->host | none | `src-tauri/src/commands/plugins.rs:222-228` |
| `rollback_plugin` | `rollback_plugin(pluginId: String) -> PluginRollbackResponse` | 回退到上一个已安装版本目录 | ui->host | none | `src-tauri/src/commands/plugins.rs:237-241` |
| `uninstall_plugin` | `uninstall_plugin(pluginId: String) -> Vec<InstalledPluginInfo>` | 只要有已保存连接绑定该插件就拒绝卸载；否则清理连接池、sidecar、外部驱动池后删包 | ui->host | none | `src-tauri/src/commands/plugins.rs:271-276` |
| `activate_plugin` / `list_active_plugins` / `stop_plugin` | `activate_plugin(pluginId) -> Vec<ActivePluginSession>`；`list_active_plugins() -> Vec<ActivePluginSession>`；`stop_plugin(pluginId) -> ()` | 基于 `PluginHost` 的会话生命周期：activate 启动或复用 sidecar，list 返回 `{pluginId, processId, state}`，stop 关闭 sidecar | ui->host | none | `src-tauri/src/commands/plugins.rs:293-300` |
| `jdbc_plugin_status` / `install_jdbc_plugin` / `install_jdbc_plugin_local` / `uninstall_jdbc_plugin` + `install/list/delete_jdbc_*`（drivers、maven bundles、local bundles） | 例：`install_jdbc_driver_from_maven(request: JdbcMavenInstallRequest) -> Vec<JdbcDriverInfo>` | 内置 JDBC 驱动本身就是一个插件包，装在同一个插件根下；安装/升级前先丢外部驱动池，避免活跃 JDBC 池指向已被移除的驱动 | ui->host | none | `src-tauri/src/commands/plugins.rs:543-552` |

`rollback_plugin` 的说明必须按更正版写：它**不会重启 runtime**。它只回退版本目录、停掉被替换的 runtime 并发出 `plugin-runtime-replaced`；sidecar 要等下一次 invoke/connect 才会被惰性重新激活（更正意见，原描述「restarts the runtime」不成立）。

### 8.2 调用、文件与 UI 资源命令（Tauri）

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `invoke_plugin` | `invoke_plugin(pluginId: string, method: string, params: JSON, timeoutMs?: number) -> JSON` | 通用 sidecar RPC 代理；timeout 被夹在 `1..120000` ms | ui->host | none（见备注） | `src-tauri/src/commands/plugins.rs:321-322` |
| `invoke_plugin_connection_action` | `invoke_plugin_connection_action(config: ConnectionConfig, actionId: string) -> PluginConnectionActionResult` | 执行 provider 声明的自定义 action（`connection/action`），先解析 runtime endpoint 与可选 SOCKS5 路由 | ui->host | none | `src-tauri/src/commands/plugins.rs:326-331` |
| `notify_plugin` / `send_plugin_binary` | `notify_plugin(pluginId, method, params) -> ()`；`send_plugin_binary(pluginId, channel, dataBase64) -> ()` | fire-and-forget 通知与二进制帧推送；base64 在宿主侧解码 | ui->host | none | `src-tauri/src/commands/plugins.rs:351-354` |
| `list_plugin_filesystem_entries` | `list_plugin_filesystem_entries(pluginId, providerId, connectionId?, uri?, cursor?, limit?) -> PluginFilesystemListResult` | provider 无关的目录列举；宿主侧把 `limit` 夹到 `1..1000`，默认 200 | ui->host | none | `src-tauri/src/commands/plugins.rs:357-377` |
| `read_plugin_filesystem_file` / `write_plugin_filesystem_file` | `read(...uri, maxBytes?) -> PluginFilesystemReadResult`；`write(..., dataBase64, create, overwrite, etag?) -> PluginFilesystemMutationResult` | 读取预览字节（上限 4 MiB，默认 256 KiB）；写入以 `etag` 做条件内联写 | ui->host | none | `src-tauri/src/commands/plugins.rs:392-417` |
| `create_plugin_filesystem_directory` / `delete_plugin_filesystem_entry` / `rename_plugin_filesystem_entry` | `create(..., uri)`；`delete(..., uri, recursive)`；`rename(..., sourceUri, targetUri, overwrite)` | 变更三件套，分别映射 `filesystem/createDirectory`、`filesystem/delete`、`filesystem/rename` | ui->host | none | `src-tauri/src/commands/plugins.rs:452-462` |
| `read_plugin_ui_entry` / `read_plugin_asset` / `read_plugin_ui_asset` | `readPluginUiEntry(pluginId) -> { contentType, dataBase64, etag }`；另两者为 `(pluginId, path)` | 把 workbench HTML 入口与资源以 base64 经 IPC 送出；同一注册表也支撑 `dbx-plugin://` scheme | ui->host | none | `src-tauri/src/commands/plugins.rs:503-508` |
| `plugin_file_open` / `plugin_file_read` / `plugin_file_write` / `plugin_file_close` | `open(pluginId, path, write?) -> {handleId, name, size, contentType, write}`；`read(pluginId, handleId, offset, length?)`；`write(pluginId, handleId, offset, dataBase64)`；`close(pluginId, handleId)` | 给无法直接访问文件系统的沙箱 UI 用的流式本地文件访问；`handleId` 是不透明的 UUID **字符串**（2026-09-22 起不再是 u64——JS 侧 double 解析在大 id 上丢精度会弄坏每一次读写）、校验属主 | ui->host | none | `src-tauri/src/commands/plugin_file.rs:116-130` |
| `plugin_ui_storage_get` / `_set` / `_delete` | `get(pluginId, key) -> unknown \| null`；`set(pluginId, key, value)`；`delete(pluginId, key)` | 按插件隔离的 JSON KV，落盘 `plugin-data/<id>/ui-storage.json`；沙箱是 opaque origin，`localStorage` 在那里不可用 | ui->host | `host.storage` | `src-tauri/src/commands/plugin_storage.rs:26-31` |
| `download_plugin_file` | `download_plugin_file(pluginId, downloadId, fileName, params, onProgress: Channel<Value>) -> string \| null` | 原生保存对话框 + 由插件自己的 `filesystem/download/open\|read\|close` 驱动的分块传输；插件只看到进度，永远看不到用户选择的目标路径 | ui->host | none | `src-tauri/src/commands/plugin_download.rs:78-89` |
| `cancel_plugin_download` | `cancel_plugin_download(pluginId, downloadId) -> ()` | 通过键为 `pluginId:downloadId` 的 `CancellationToken` 注册表取消进行中的流式下载 | ui->host | none | `src-tauri/src/commands/plugin_download.rs:16-22` |
| `get_plugin_plan_capabilities` | `get_plugin_plan_capabilities(connectionId: string) -> PluginPlanCapabilities` | 报告已打开连接的 `dbType`、`dbVersion`、`supports.estimatedPlan` 与 limits，不执行任何语句 | ui->host | `host.plans:read`（仅 TS 侧，见下） | `src-tauri/src/commands/query.rs:983-987` |
| `get_plugin_estimated_plan` | `get_plugin_estimated_plan(request: PluginPlanRequest) -> PluginPlanResult` | 宿主侧 EXPLAIN 获取：插件提交自己的 SQL，宿主在自己的 pool 上构造并执行 EXPLAIN。**只有 `mode="estimated"` 会被服务** | ui->host | `host.plans:read`（仅 TS 侧，见下） | `src-tauri/src/commands/query.rs:993-997` |

限制与更正，必须显式写清：

- `invoke_plugin` 以 `None` 作为 required_permission 传入，**命令本身绕过了 manifest 权限闸门**，权限检查只发生在 TS bridge 层（`src-tauri/src/commands/plugins.rs:321-322`）。
- `plugin_file_*`：`MAX_OPEN_HANDLES = 64`（`src-tauri/src/commands/plugin_file.rs:32`），`MAX_CHUNK_BYTES = 8 MiB`（`src-tauri/src/commands/plugin_file.rs:26`）。
- `download_plugin_file`：单块上限 1 MiB（`src-tauri/src/commands/plugin_download.rs:91-93`），最多 8 个并发下载（`src-tauri/src/commands/plugin_download.rs:57`）。
- `plugin_ui_storage_*`：单值上限 256 KiB、整库上限 1 MiB、键数上限 1024（`src-tauri/src/commands/plugin_storage.rs:26-31`）。`host.storage` 权限在 TS bridge 里检查（`apps/desktop/src/lib/plugins/pluginHostBridge.ts:471`），**不在这些命令里**。
- 两个 plan 命令的 `host.plans:read` 是 **误标**：Rust 侧没有任何代码强制该权限，`plugin_plan.rs` 不含权限检查，Tauri/web 的 plan 命令只是直接调进去。强制只发生在 TS bridge，所以这两行「权限」列应理解为「bridge 层门槛」，不是宿主层门槛。

### 8.3 宿主 → webview 事件（Tauri event）

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `dbx-plugin-event` | `{ pluginId, method, params }` | 把每个 sidecar `PluginEvent` 转发到 webview；TS bridge 按 `pluginId` 和 `host.events` 过滤后才送进 iframe | host->ui | `host.events` | `src-tauri/src/commands/plugins.rs:152-155` |
| `dbx-plugin-binary` | `{ pluginId, channel, dataBase64 }` | 同一条中继的二进制侧；bridge 里重新解码成 `ArrayBuffer` 并以零拷贝转移进 iframe | host->ui | `host.binary` | `src-tauri/src/commands/plugins.rs:170-175` |
| `plugin-runtime-replaced` | `{ pluginId, version }` | 安装/回退/URL 安装后发出，让已打开的 workbench 标签重载新 UI，而不是继续显示旧版本 | host->ui | none | `src-tauri/src/commands/plugins.rs:514-521` |
| `plugin-url-download-progress` | `{ downloaded: number, total: number }` | `install_plugin_package_from_url` 的进度流，每个 chunk 回调一次，供插件中心画进度条 | host->ui | none | `src-tauri/src/commands/plugins.rs:222-223` |
| `dbx-open-plugin-install-links` | `string[]`（`dbx://plugins/install` 链接） | 深链安装：`dbx://plugins/install` 参数在启动时与单实例激活时解析，先入队到 `AppState` 再发给 UI | host->ui | none | 见下更正 |
| `mcp-open-connection-workbench` | `{ connection_id }` | 仅当被转发的插件工具调用确实会路由进可见终端时才由 MCP bridge 发出，静默的隐藏通道调用不会抢焦点 | host->ui | none | `src-tauri/src/commands/mcp_bridge.rs:1398-1400` |

`dbx-open-plugin-install-links` 的锚点必须更正：`src-tauri/src/commands/deep_link.rs:6` 只定义了 `dbx://plugins/install` 前缀常量，既不发射也不命名任何事件；该事件真实存在，但发射点在 `lib.rs`，不在被引用的文件里。

### 8.4 宿主 ↔ sidecar 的 JSON-RPC 契约

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `plugin/initialize` | `{ host: { dbxVersion, hostApiVersion, protocolVersions, features[] }, plugin: { id, version }, permissions[] }` | 每个 sidecar 会话的第一帧。插件必须回 `protocolVersion`；宿主对不匹配直接拒绝（`SUPPORTED_PLUGIN_PROTOCOL_VERSION = 1`） | host->plugin | none | `crates/dbx-plugin-runtime/src/plugins/runtime.rs:385-388` |
| `connection/test` / `connection/connect` / `connection/disconnect` / `connection/action` | `connection/test(params) -> {success, message} \| string \| null`；`connection/action` 的 params 携带 `{ provider, connection, runtime, operationId, action: {id} }` | 插件自有连接的生命周期 RPC 面；provider 声明的 capabilities 决定 connect/disconnect 到底会不会被调用 | host->plugin | none | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:20-23` |
| `filesystem/list` / `read` / `write` / `createDirectory` / `delete` / `rename` | `filesystem/list -> { entries[], nextCursor? }`；`read -> { dataBase64, size? }`；mutation -> `{ etag? }` | filesystem-provider 契约。六个方法都经 `PluginHost` 调用并在宿主侧做校验/归一（分页、预览大小、内联写上限） | host->plugin | none | `crates/dbx-plugin-runtime/src/plugins/filesystem.rs:8-13` |
| `filesystem/download/open` / `read` / `close` | `open(params) -> { size }`；`read({downloadId, connectionId, providerId}) -> { dataBase64, done }`；`close(control)` | `download_plugin_file` 使用的流式下载协议；与 `filesystem/read` 不同，它分块且带显式 `done` 标志，从不整体缓冲 | host->plugin | none | `src-tauri/src/commands/plugin_download.rs:87-95` |
| `mcp/tools` / `mcp/call` | `mcp/tools({}) -> { tools: [...] }`；`mcp/call({ tool, arguments, lifecycle? }) -> tool result` | 插件自声明的 MCP 工具面。`mcp/tools` 在发现期以 30s 超时调用，`mcp/call` 为 300s（MCP backend）或最高 600s（桌面 bridge） | host->plugin | none | `crates/dbx-mcp/src/backend.rs:742` |
| `contextMenu/<contributionId>` | `invoke_plugin(pluginId, "contextMenu/${id}", { connection: { id, dbType, name, database } } \| { table: { connectionId, database?, schema?, table } }) -> { message? }` | 原生侧边栏右键菜单项直接打到插件后端；返回的 message 字符串会被 toast | ui->host | none | `apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue:6745-6748` |
| `host/requestUserInput` | 插件发起、带 string id 的请求；params 为 prompt/options spec；超时默认 300s、最大 600s | 插件后端唯一可以回调 DBX 的方法（Host API 1.1）。用 string id 区分插件发起的帧，旧宿主会直接丢弃而不是报错 | plugin->host | none | `crates/dbx-plugin-runtime/src/plugins/runtime.rs:26` |
| `host.stream.chunk` / `host.stream.end` / `host.stream.error` + `filesystem/stream/close` | `window.dbxPlugin.stream(method, params, { streamId?, closeMethod? = 'filesystem/stream/close', timeoutMs? }) -> { stream: ReadableStream, metadata }` | SDK 里唯一的流式原语：先带 `streamId` 发一次普通 `backend.invoke`，再消费 `host.stream.chunk/end/error` 事件（携带 `dataBase64`），取消（`ReadableStream.cancel`）时调 close 方法。这是 `plugin->host` 流事件唯一定义处 | plugin->host | none | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:752`（close 默认值见 `:732`） |

`mcp/call` 会附加 `lifecycle = plugin_host.connection_params_standalone(config)`，凭据始终由宿主管理（`crates/dbx-mcp/src/backend.rs:777`）。

#### 8.4.1 协议与生命周期细节

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `PluginHost` 会话注册表 | `sessions: RwLock<HashMap<pluginId, Arc<PluginSidecarSession>>>` + `activation_lock: Mutex<()>` | 每个 plugin id 一个 sidecar 进程，被该插件的所有 workbench 标签和所有连接共享。`activation()` 持锁并二次检查 `running_session`，并发激活不会起两个进程 | n/a | none | `crates/dbx-plugin-runtime/src/plugins/host.rs:124-128` |
| `PluginConnectionHandle` | `PoolKind::PluginConnection(PluginConnectionHandle{pluginId, providerId, connectionId, session?, disconnect, params, _activity})` | 插件连接在 DBX 连接池注册表里的形态：带 sidecar handle 与一个 usage guard，使连接存活期间插件无法被更新。`connect_connection` 是幂等 upsert，刻意跳过 pool teardown | n/a | none | `crates/dbx-core/src/connection/mod.rs:132` |
| `proxy_route` | `provider.proxy_route: bool -> runtime.proxy = { type: "socks5", host, port, username?, password? }` | 多端点 provider（Kafka bootstrap + advertised listeners）改用宿主托管的 SOCKS5 拨号器而不是静态隧道；逻辑 host:port 仍会下发以便元数据发现。**没有该标志、又没有 host/port 字段的 provider 会在静态隧道路径上显式报错** | host->plugin | none | `crates/dbx-core/src/connection/mod.rs:3363-3366` |
| `wants_proxy_route` | `async fn wants_proxy_route(&self, config: &ConnectionConfig) -> bool` | 解析不出的 config 返回 false，让调用方退回静态隧道路径而不是报错 | n/a | none | `crates/dbx-plugin-runtime/src/plugins/host.rs:202-207` |
| `connection_params_standalone` | `fn connection_params_standalone(&self, config: &ConnectionConfig) -> Result<Value, String>` | 用 config 端点作为 runtime endpoint 构造生命周期负载（不走桌面隧道）；MCP 路径靠它让无头 agent 驱动插件连接 | n/a | none | `crates/dbx-plugin-runtime/src/plugins/host.rs:192-195` |
| plugin 连接生命周期负载 | `{ provider: {id, databaseType}, connection: ConnectionConfig, runtime: { host, port, proxy? }, operationId: uuid }` | 每个 `connection/*` 与 `filesystem/*` 调用收到的统一形状。凭据随序列化后的 `ConnectionConfig` 走加密生命周期通道，插件被明确要求不得记录日志 | host->plugin | none | `crates/dbx-plugin-runtime/src/plugins/host.rs:461-469` |
| connect 超时跟随插件自身字段 | `connect_timeout_secs`（`external_config` 值优先于 manifest 默认）夹在 `1..300` s | 宿主的 `connection/test`/`connection/connect` RPC deadline 绝不能早于插件自己的握手超时，因此声明的 `connect_timeout_secs` 覆盖通用回退值 | n/a | none | `crates/dbx-plugin-runtime/src/plugins/host.rs:438-444` |
| 字段条件（`visible_when` / `required_when`）宿主侧镜像 | `PluginFieldCondition = Field{field, one_of} \| AllOf \| AnyOf \| Not` | 必填校验是条件感知的（Host API 1.1），使非对话框写入路径（MCP、导入）不会误拒那些协议字段本来就不可见的连接。Rust 求值器镜像前端 `pluginFieldConditions` 语义，含级联可见性与环路保护 | n/a | none | `crates/dbx-plugin-runtime/src/plugins/host.rs:534-538` |
| sidecar 进程环境变量 | `DBX_PLUGIN_ID`、`DBX_PLUGIN_VERSION`、`DBX_APP_VERSION`、`DBX_HOST_API_VERSION`、`DBX_PLUGIN_PROTOCOL_VERSION`、`DBX_PLUGIN_DATA_DIR`（JDBC 驱动另有 `DBX_JAVA_BIN`） | 每个 sidecar 都带版本号与插件私有数据目录启动，绝不回落到 OS 临时目录。`PluginRuntimeEnv` 允许调用方追加变量 | host->plugin | none | `crates/dbx-plugin-runtime/src/plugins/runtime.rs:1062-1069` |
| `plugin-data` 目录 | `<data dir>/plugin-data/<id>` | 持久、与版本无关的按插件数据目录，是安装器管理的 `plugins/` 树的兄弟目录；sidecar（`DBX_PLUGIN_DATA_DIR`）与 UI KV 存储共用 | n/a | none | `crates/dbx-plugin-runtime/src/plugins.rs:187-188` |
| 并发事件中继 | `PluginHost::subscribe_events` / `subscribe_binary` -> broadcast channel（512 events / 128 binary messages） | 激活时把每个 session 的 broadcast 流转发进宿主级 broadcast，多个 workbench 标签与 MCP/web 消费者观察到同一批事件，无需直连 sidecar 管道 | host->ui | none | `crates/dbx-plugin-runtime/src/plugins/host.rs:85-86` |
| 插件生命周期锁 | `PluginLifecycle::begin_operation` / `begin_connection` / `begin_update` | 每个宿主操作都取 usage guard，活跃插件连接持有一个：更新会被拒并指名占用它的已保存连接；纯 UI 连接在 disconnect 后不持 guard | n/a | none | `crates/dbx-plugin-runtime/src/plugins/host.rs:119` |

关于 `PluginConnectionHandle` 的一个实现注释：`src-tauri/src/commands/connection.rs:1717-1723` 解释了为什么重连路径不能整体 close——那会连带杀掉同插件其它标签的会话。

### 8.5 权限串

`SUPPORTED_PLUGIN_PERMISSIONS` 是固定的七项非网络权限集合：`host.events`、`host.binary`、`host.workbench`、`host.filesystem`、`host.plans:read`、`host.storage`、`host.ai`（`crates/dbx-plugin-runtime/src/plugins/manifest.rs:24-25`）。

| 权限 | 取值 | 说明 | 判定位置 | 证据 |
|---|---|---|---|---|
| `host.events` | `"host.events"` | bridge 把 sidecar 事件转发进 iframe 的前提 | TS bridge | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:282` |
| `host.binary` | `"host.binary"` | 双向二进制帧转发的闸门 | TS bridge | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:287` |
| `host.workbench` | `"host.workbench"` | 调 `host.openWorkbench` 的前提 | TS bridge | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:372` |
| `host.filesystem` | `"host.filesystem"` | 调 `host.openFilesystem` 的前提 | TS bridge | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:385` |
| `host.storage` | `"host.storage"` | `host.storageGet/Set/Delete` 的前提；运行时以 `capabilities.storage` 对外宣告 | TS bridge | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:471` |
| `host.plans:read` | `"host.plans:read"` | `host.getPlanCapabilities` 与 `host.explainPlan` 的前提 | **仅 TS bridge**（更正） | `apps/desktop/src/types/pluginPlan.ts:17` |
| `host.ai` | `"host.ai"` | `ai.openConversation`（打开内置 AI 面板的插件数据会话）的前提；运行时以 `capabilities.ai` 对外宣告。插件得不到模型输出、模型配置或执行能力 | **仅 TS bridge**（与 `host.plans:read` 同一模式） | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:338` |
| `host.network:<origin>` | `"host.network:https://example.com[:port]"`，最多 8 个 origin | 唯一能扩展沙箱 CSP `connect-src` 的权限；只有无 path/query/fragment 的 https origin 能解析成功；Rust 与 TS 两侧解析器必须保持同步 | Rust 解析 + TS 镜像 | 见下更正 |

两条必须写的更正：

- `host.plans:read` 原条目称「validated host-side by the `PluginHost::invoke` permission gate as well as the bridge」是**假的**。Rust 没有任何代码强制该权限（`plugin_plan.rs` 无权限检查，Tauri/web plan 命令只是转发）。因此 8.2 节两个 plan 命令的权限列 overstated 了检查位置。
- `host.network:<origin>` 原条目的锚点无效：`manifest.rs:24-25` 是 `SUPPORTED_PLUGIN_PERMISSIONS`，它**故意不含 `host.network`**（那是固定七项的集合）。真正的 parser 与「最多 8 个」规则在别处，本数据集未提供其位置——此处如实标注为「锚点缺失」，不做推断。

### 8.6 贡献点

| 贡献点 | 签名/取值 | 说明 | 证据 |
|---|---|---|---|
| `connection-provider` | `{ type: "connection-provider", id, label?, database_type, fields[], workbench?, filesystem_provider?, capabilities[]: [test\|connect\|disconnect], actions[], proxy_route? }` | 声明插件自有连接类型。在连接对话框里选中它会把 `db_type="plugin"` 加 `plugin_id`/`plugin_connection_provider`/`plugin_connection_type` 写进 `ConnectionConfig` | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:547-573` |
| `workbench` | `{ type: "workbench", id, label, description?, icon? }` | 在持久 DBX 标签里打开插件 UI 入口；也可经 connection-provider 的 `workbench` 字段触达，这正是侧边栏点插件连接时的解析路径 | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:641-648` |
| `result-view` | `{ type: "result-view", id, label, description?, icon? }` | 在结果网格旁加一个工具栏按钮；点击打开插件标签，上下文携带受限的结果快照。仅显示元数据，自身没有 UI id | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:667-678` |
| `filesystem-provider` | `{ type: "filesystem-provider", id, label, schemes[], capabilities[], root_uri? }` | 支撑应用的插件文件浏览器：可从插件中心 Browse 按钮打开 `mode="plugin-filesystem"` 的文件系统标签，也在 connection provider 无 workbench 时作为回退 | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:682-694` |
| `context-menu` | `{ type: "context-menu", id, label, description?, icon?, menu: "connection" \| "table" }` | 在已保存连接或表节点的侧边栏菜单里原生渲染（不走 iframe）；点击以 `contextMenu/<id>` 调插件后端。**两个 surface 都已实现（connection 自始、table 自 2026-09-22）** | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:650-665` |
| `PluginFilesystemCapability` | `"read" \| "write" \| "delete" \| "rename" \| "mkdir"` | filesystem-provider 可声明的能力值；宿主只路由 provider 宣誓过的变更操作，只读 provider 可以省掉 `write`/`delete`/`rename`/`mkdir` | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:704-710` |
| `PluginFormFieldType` / `PluginFormFieldBinding` | type：`"text"`｜`"password"`｜`"number"`｜`"boolean"`｜`"select"`｜`"radio"`｜`"textarea"`；binding：`"config"`｜`"secret"`｜`"name"`｜`"host"`｜`"port"`｜`"username"`｜`"password"`｜`"database"` | 每个 connection-provider 字段背后的两个枚举。`binding` 决定值落到哪：`config` 进 `external_config`，`secret` 进 `connection_secrets`，其余映射到 `ConnectionConfig` 的强类型列（对话框的 `buildPluginConnectionConfig` 与之镜像） | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:487-508` |

`result-view` 的一个硬上限：结果网格旁**最多渲染 4 个** result-view 按钮（`QueryResultToolbarActions.vue:37`）。

### 8.7 连接类型如何流入对话框、编辑器与查询执行

| 环节 | 形状 | 行为 | 证据 |
|---|---|---|---|
| 对话框 | 选项值 `plugin-provider:<encodedPluginId>/<encodedProviderId>`；`buildPluginConnectionConfig()` | 对话框把已安装 provider 列为 `"plugins"` 分类，用 manifest 默认值播种表单，把 binding（`name`/`host`/`port`/`username`/`password`/`database`/`secret`/`config`）映射到强类型 config，并把 config 绑定的 `connect_timeout_secs` 镜像进强类型字段 | `apps/desktop/src/lib/plugins/frontendPlugin.ts:206-213`；选项编码见 `frontendPlugin.ts:21,98` |
| SQL 编辑器 | `quickConnectionOpenTarget(connection) -> { kind: "plugin-workbench" }`（`db_type === "plugin"`） | **刻意不打开**：插件连接永远不从侧边栏开 SQL 查询标签，而是解析 provider 声明的 workbench（或它的 filesystem provider，或报错） | `apps/desktop/src/lib/connection/connectionOpenTarget.ts:13-15` |
| 查询执行 | `PoolKind::PluginConnection(_) => Err("SQL execution is not supported for plugin connections")` | DBX 自己的 SQL 执行器没有插件路径：对插件连接执行 SQL 必定报错。所有插件查询工作都发生在插件自己的 sidecar 内，经 `backend.invoke` 完成 | `crates/dbx-core/src/query/mod.rs:2229` |
| 打开连接 | `openPluginConnection(connectionId)`：解析 provider -> `workbench` 字段（或 `filesystem_provider` 回退）-> `openPluginWorkbench`/`openPluginFilesystem` | 先确保宿主侧已连接，再开 workbench 标签，context 为 `{connectionId, providerId, connectionType, workbenchId, connection:{...}}`；没有 workbench 时回退到声明的 filesystem provider，并把标签命名为 `<name> · SFTP` | `apps/desktop/src/stores/queryStore.ts:3603-3627` |
| `proxy_route` 路径 | `provider.proxy_route=true` 时 `ConnectionEndpoint { host, port, proxy: Some(proxy) }` | 多端点 provider 走宿主托管的 SOCKS5。路由构造在 `crates/dbx-core/src/connection/mod.rs:3397-3452`：最后一跳 SSH 用 `start_transport_layers_with_final_ssh_socks5`；单个 socks5 Proxy 层原样透传；HTTP 隧道链回退为 `None` | `crates/dbx-core/src/connection/mod.rs:3363-3366`、`:3356-3411` |
| 外部驱动插件（JDBC）进入 SQL 引擎 | `external_driver_pool(driverId, config)`，经 `PluginRegistry::start_driver_session_for_connection`；驱动按 `manifest.drivers[].id` 或 `.database_type` 查找 | manifest 里一条 `drivers[]` 就让插件成为 DBX 驱动：`DatabaseType::Jdbc`（以及 PrestoSql、GaussDB-M via JDBC）走 `PluginDriverSession` 而不是原生驱动，JDBC 插件额外收到 `DBX_JAVA_BIN` | `crates/dbx-core/src/connection/mod.rs:3073-3080` |
| 卸载/替换清理 | `stop_replaced_plugin_runtime` + `stop_external_driver_pools`（install/rollback/URL install/uninstall 都会走） | 安装路径在重启 sidecar 前丢掉该插件的连接池与外部驱动池，保证没有活跃 pool 指向已被替换的二进制 | `src-tauri/src/commands/plugins.rs:524-534` |
| MCP 执行路径未前置拒绝 | `ensure_mcp_execute_and_show_supported(db_type) = supports_sql_query(db_type)` | `supports_sql_query()` 是黑名单实现且**没有列 `DatabaseType::Plugin`**，所以对插件连接发 MCP `execute_query` 会通过早期闸门，直到 pool 分发器才以 `SQL execution is not supported for plugin connections` 失败 | `crates/dbx-sql/src/query_execution_sql.rs:196-212` |

### 8.8 workbench 贡献如何开成标签页，以及沙箱

| 名称 | 签名/取值 | 说明 | 证据 |
|---|---|---|---|
| `openPluginWorkbench` 标签身份与复用 | `openPluginWorkbench(pluginId, contributionId, { title?, connectionId?, database?, context?, forceNew? }) -> tabId` | 标签键为 `(mode=plugin-workbench, pluginId, contributionId, connectionId)`；重开会聚焦既有标签且**不更新 context**（代码注释说明：替换 context 会深重载插件 webview，整屏闪烁并丢掉旧 workbench id 上的 sidecar 会话绑定）。标题用 Termius 风格的 `" (n)"` 后缀区分同级 | `apps/desktop/src/stores/queryStore.ts:3509-3520` |
| workbench UI 沙箱 | `pluginSandboxDocument(html, permissions, theme, { baseUrl })` 注入 CSP meta + `<base>` + SDK script；iframe `sandbox="allow-scripts"` | workbench 文档是 opaque-origin 的 `srcdoc` iframe：`default-src 'none'`、`script-src 'unsafe-inline' blob:` + 插件资源 origin、`connect-src` 只放开已声明的 `host.network` origin，且 SDK 在用户代码之前注入 | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:548-550` |
| `dbx-plugin://` 资源 scheme | `dbx-plugin://localhost/<plugin-id>/<asset-path>`（WebView2 另外映射 `http://dbx-plugin.localhost/...`） | 在 IPC 之外服务插件 UI 的 code-split chunk；做穿越校验，`CORS *`，并且 `no-store`，使被替换的插件永远不会送出旧 chunk | `src-tauri/src/plugin_ui_protocol.rs:100-101` |
| `PluginWorkbenchHost` 桥接面 | `PluginHostBridgeApi { invoke, notify, sendBinary, readAsset, openAiConversation?, openWorkbench, openFilesystem, reopenConnection, getPlanCapabilities, explainPlan, closeTab, saveFile, downloadFile?, cancelDownload?, copyText, pickFiles, readFileChunk, beginFileSave, writeFileChunk, finishFileSave, closeFileHandle, storageGet/Set/Delete }` | 宿主能力接 Tauri 命令的唯一位置。`downloadFile`/`cancelDownload` **明确仅 Tauri 有**，其余都有 web 回退或空实现；`openAiConversation` 由 App.vue 注入、仅在内置 AI 面板可用时存在（2026-09-22 新增） | `apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:388-389` |
| `window.dbxPlugin` SDK 面 | `ready, context, locale, theme, capabilities, request, ai{openConversation}, invoke, stream, notify, sendBinary, readAsset, readAssetUrl, openWorkbench, openFilesystem, reopenConnection, getPlanCapabilities, explainPlan, saveFile, copy, storage{get,set,delete}, fileTransfer{pick,read,beginSave,write,finish,cancel,onDragState,onDrop}, onEvent, onBinary, onContext, onInit, decodeBase64, encodeBase64, downloadFile, cancelDownload` | 冻结的全局对象（另有 document 级 `dbx-plugin-init/context/env/event/binary/filedrop/dragstate` CustomEvent）。`stream()` 在 `host.stream.chunk/end/error` 之上实现 `ReadableStream`，close 默认走 `filesystem/stream/close`。**更正：`downloadFile` 与 `cancelDownload` 是冻结全局上的成员**（原签名列表漏了，尽管其证据引文里就有）；`fileTransfer` 里只有 `onDrop`/`onDragState` 是监听器形态的成员；`ai` 是 2026-09-22 新增的第三个冻结子对象 | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:790-814` |
| init 消息 capabilities | `{ downloadFile: boolean, planApi: boolean, storage: boolean, ai: boolean }` | 加性能力宣告：缺失即视为不支持，插件被要求据此 gate 而不是探测。同消息还带 `pluginId`、`contributionId`、`locale`、`theme`、`permissions` 与 workbench context | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:247-254` |
| 桥接负载上限 | `MAX_BRIDGE_PAYLOAD_BYTES = 2 MiB`；`MAX_BRIDGE_BINARY_BYTES = 8 MiB`；`MAX_BRIDGE_SAVE_BYTES = 512 MiB`；plan SQL 200k 字符；plan 4 MiB；plan 超时 60s | 在负载抵达宿主之前由 TS bridge 强制，Rust 侧镜像 | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:8-11` |
| `host.getContext` | `request('host.getContext') -> PluginWorkbenchContext` 快照 | 返回受限的 workbench 上下文；**result-view 标签的结果快照就是从这里到达插件** | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:343` |
| `backend.invoke` / `notify` / `sendBinary` | `invoke(method, params, {timeoutMs?})`；`notify(method, params)`；`sendBinary(channel, data)` | 通用 sidecar 调用面；bridge 里 `timeoutMs` 夹到 120s，二进制帧上限 8 MiB 且零拷贝转移 | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:344-349` |
| `host.saveFile` / `fileTransfer.*` / `host.copy` | `saveFile({fileName?, contentType?}, data)`；`fileTransfer.pick/read/beginSave/write/finish/cancel/onDrop/onDragState`；`copy(text)` | 这些桌面路径存在的原因：沙箱 iframe 不能触发下载（WKWebView 会取消 blob 导航）、不能读本地路径、也没有剪贴板权限。**`handleId` 在 SDK 里是不透明字符串；`plugin_file_*` 自 2026-09-22 起也用 UUID 字符串 id**（此前 Rust 注册表用 `u64`，大 id 经 JS double 会静默损坏） | `apps/desktop/src/lib/plugins/pluginHostBridge.ts:404-413` |

### 8.9 result-view 如何挂到查询结果上（含宿主版本门槛）

| 环节 | 形状 | 行为 | 证据 |
|---|---|---|---|
| 工具栏 -> 结果视图 | `ContentArea.openPluginResultView(pluginId, contributionId, label)` | 工具栏发 `openResultView`；`ContentArea` 把快照**截到 500 行**，再以 `context.result = { columns, rows (≤500), truncated }` 加上 `sql`/`connectionId`/`database` 打开插件标签 | `apps/desktop/src/components/layout/ContentArea.vue:1063-1072` |
| 贡献 id 解析 | `findUiContribution(pluginId, contributionId) = [...listWorkbenches(), ...listResultViews()].find(...)` | 标签渲染器把贡献 id 同时对照 workbench 与 result-view 解析。`PluginWorkbenchTab` 里的注释说明：只查 workbench 的旧实现永远解析不出 result-view id | `apps/desktop/src/lib/plugins/frontendPlugin.ts:77-83` |
| 宿主版本门槛 | 门槛版本 **0.6.18** | 在 `findUiContribution` 这个解析改动发布之前，旧宿主上该按钮**必然失败**：标签会打开并显示 `workbenchUnavailable`，插件 UI 根本不会加载。**重要：宿主侧不存在任何版本闸门字符串**，可用性纯粹由这次解析改动的发布时点决定；错误出口是 `PluginWorkbenchTab.vue:49` -> `t("pluginPlatform.workbenchUnavailable")` | `apps/desktop/src/lib/plugins/frontendPlugin.ts:77-83`；错误出口 `PluginWorkbenchTab.vue:49` |

对插件作者的直接推论：`result-view` 的快照最多 500 行且可能 `truncated`，需要完整结果集必须通过插件自己的后端重新查询；而 `openPluginWorkbench` 的「重开不更新 context」语义意味着对同一标签第二次「open in canvas」会保留旧结果。

### 8.10 filesystem-provider 如何接入应用文件浏览

| 环节 | 形状 | 行为 | 证据 |
|---|---|---|---|
| 文件浏览器 | `PluginFilesystemTab` -> `PluginFileManager`；标签 mode `"plugin-filesystem"` 带 `pluginFilesystem {pluginId, providerId, rootUri, currentUri}` | 插件文件浏览器完全跑在 `list/read/write/createDirectory/delete/rename` 这六个 RPC 上；会先确保连接已建立，并可通过通用刷新路径刷新 | `apps/desktop/src/components/layout/ContentArea.vue:1010-1013` |
| 打开入口 | 插件中心 Browse 按钮，或 connection provider 无 workbench 时的回退 | 见 8.7 的 `openPluginConnection` 小节 | `apps/desktop/src/stores/queryStore.ts:3603-3627` |
| 能力裁剪 | `PluginFilesystemCapability` | 只路由 provider 宣誓的能力，只读 provider 无需实现写/删/改名/建目录 | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:704-710` |

### 8.11 MCP server 与插件的关系

| 名称 | 签名/取值 | 说明 | 证据 |
|---|---|---|---|
| 桌面 MCP 桥（独立 agent） | `POST /call-plugin-tool { connection_id, tool, arguments?, plugin_id?, timeout_ms? }`；`POST /list-plugin-connections { plugin_id }` | 桌面 MCP bridge 把插件工具暴露给独立的 stdio agent，走 `<data-dir>/mcp-bridge-port` 公布的 loopback 端口。**凭据从不跨界**：生命周期负载由已保存 config 在宿主侧构造，连接列表是硬字段白名单。请求结构在 `mcp_bridge.rs:1318-1325`，超时默认 300s / 上限 600s 在 `:1415` | `src-tauri/src/commands/mcp_bridge.rs:1401-1412` |
| `dbx-mcp` 库内助手 | `LocalBackend::list_plugin_tools() -> Vec<{pluginId, tools}>`；`LocalBackend::call_plugin_tool(pluginId, tool, connectionId?, arguments)` | Rust MCP crate 可以进程内枚举并调用插件 MCP 工具，按插件分组以便调用方选对 sidecar；凭据由宿主管理（lifecycle 由 config 构造，从不传入） | `crates/dbx-mcp/src/backend.rs:760-784` |
| **注意** | — | **没有任何 MCP server 工具注册这两个方法**：当前只有 `examples/verify_plugin_store.rs` 与 `tests/plugin_tools_bridge.rs` 调用它们，属于库能力而非已上线的 server 工具 | `crates/dbx-mcp/src/backend.rs:760-784` |
| 焦点保护事件 | `mcp-open-connection-workbench` | 只有会被路由进可见终端的插件工具调用才发，隐藏通道的静默调用不会抢焦点 | `src-tauri/src/commands/mcp_bridge.rs:1398-1400` |
| 插件侧工具契约 | `mcp/tools` / `mcp/call` | 见 8.4 | `crates/dbx-mcp/src/backend.rs:742` |

### 8.12 各宿主之间的能力缺口（desktop / web / cli / 无头）

| 宿主 | 形状 | 能力与缺口 | 证据 |
|---|---|---|---|
| dbx-web（完整路由对等，传输不同） | `/api/plugins/*` REST + SSE；`/api/query/plugin-plan-capabilities`；`/api/query/plugin-estimated-plan` | 无头 web 宿主暴露与桌面 Tauri 命令相同的插件注册表、市场、filesystem、invoke/notify/binary 与 plan 路由，插件事件走 SSE 而非 Tauri 事件。前端 endpoint 映射在 `apps/desktop/src/lib/backend/http.ts:556-706` | `crates/dbx-web/src/main.rs:423-436` |
| dbx-web 资源/UI 路由 | `GET /api/plugins/{pluginId}/ui`、`/ui/{*path}`、`/assets/{*path}`、`GET /api/plugins/events`（SSE） | 与桌面 `dbx-plugin://` 同一注册表读取，但以 HTTP 提供，CSP 走响应头而非注入 meta | `crates/dbx-web/src/routes/plugins.rs:592-597` |
| dbx-web 插件连接 | `/api/connection/test\|connect`：先解析 `plugin_connection_endpoint`，再调 `plugin_host.test_connection`/`connect_connection` | web 模式驱动同一个 `PluginHost`；endpoint 解析（含 `proxy_route`）与桌面共用，所以 web 部署同样能打开插件连接 | `crates/dbx-web/src/routes/connection.rs:276-277` |
| dbx-cli | `crates/dbx-cli/src/main.rs`（该 crate 唯一源文件）只 import `dbx_core`、`dbx_mcp`、`dbx_types`，**完全不 import `dbx_plugin_runtime`** | **CLI 没有任何插件面**：不能安装、激活、调用或列出插件，也没有插件连接路径——整个 crate 里没有一处插件模块引用 | `crates/dbx-cli/src/main.rs:3-12` |
| 无头 MCP / 独立二进制 | `LocalBackend::open(path) => open_with_app_version(path, "")` | 独立 MCP 二进制**刻意传空 app version**，从而跳过插件 `engines.dbx` 检查（独立版本号的二进制不应冒充应用版本）。代码注释举了被拒的例子：`DBX >= 0.5.68` 会对 `0.4.90` 判不兼容 | `crates/dbx-mcp/src/backend.rs:686-688` |
| 桌面 vs web 的 UI 差异 | `downloadFile` / `cancelDownload` 仅 Tauri | `PluginWorkbenchHost` 里这两个键在非 Tauri 运行时为 `undefined`；`init` 消息用 `capabilities.downloadFile` 把这个缺口告知插件，插件必须据此 gate | `apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:388-389`、`apps/desktop/src/lib/plugins/pluginHostBridge.ts:247-254` |
| 桌面专属 UI 承载 | `dbx-plugin://` scheme、`srcdoc` iframe 沙箱 | web 用 HTTP + CSP 头替代；两边的 CSP `connect-src` 都只放开 `host.network` 声明的 origin | `src-tauri/src/plugin_ui_protocol.rs:100-101`、`apps/desktop/src/lib/plugins/pluginHostBridge.ts:548-550` |

### 8.13 工具链与 manifest 门槛（集成前置条件）

| 名称 | 签名/取值 | 说明 | 证据 |
|---|---|---|---|
| `dbx-plugin` CLI | `dbx-plugin create \| package \| dev \| keygen`（二进制名来自 Cargo.toml `[[bin]] name = "dbx-plugin"`） | 随源码树发布的插件创作 CLI，位于 `plugins/sdk/cli`：脚手架（create）、构建 `.dbxp` + artifact 元数据（package）、本地开发宿主（dev）、Ed25519 仓库签名密钥（keygen）。浏览器侧 dev 宿主带 `window.dbxPlugin` shim，在 `plugins/sdk/dev-host/browser-bridge.mjs:103` | `plugins/sdk/cli/src/lib.rs:328-331` |
| manifest schema 与 engines 门槛 | `engines { dbx: "<semver range>", host_api: "<semver range>" }`；`manifest_version 1`；`entrypoints { backend { executable, transport: stdio-jsonl\|stdio-framed, protocol_versions[] }, ui { root?, entry } }` | manifest v1 **必须**声明 `engines.host_api`；宿主拿它对照 `SUPPORTED_PLUGIN_HOST_API_VERSION`（1.2.0），`engines.dbx` 对照应用版本。不支持的权限、未知贡献类型、过大的条件树在加载期就被拒 | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:817-825` |
| Host API 版本宣告 | `SUPPORTED_PLUGIN_HOST_API_VERSION = "1.2.0"`；`SUPPORTED_PLUGIN_HOST_FEATURES = &["host.requestUserInput"]` | 在 `plugin/initialize` 时向插件后端宣告的 Host API 版本与特性表；插件应据此 gate 而不是探测。**注意：实际发出的是 1.2.0，而代码注释里两处仍写 "Host API 1.1"，相对该常量已过期**。plan API 的 Host API 下限是 1.2.0（`manifest.rs:16`），运行时在 `plugin/initialize` 里宣告 `hostApiVersion` + `features`（`runtime.rs:375-377`） | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:16` |
| 官方目录 URL | `https://dl.dbxio.com/catalog/index.json`（回退 `https://raw.githubusercontent.com/t8y2/dbx-store/main/catalog/index.json`） | 未配置自定义仓库时宿主抓取的内置官方仓库；CDN 不可达时用 GitHub raw 兜底。目录以 `index.json` 提供，上限 `MAX_PLUGIN_CATALOG_BYTES` | `crates/dbx-plugin-runtime/src/plugins/marketplace.rs:29-30` |
| 内置信任锚 | `[("dbx-store-preview-2026", "VRb0VscZfWwuFa7LYfeD/wEOJeyNP8wPGND9br8Icmk="), ("dbx-store-release-2026", "6WbMG2UDx+EZ/oauMtHjdinvSD5MuFWSgXbI0n7eL+k=")]` | 每个安装开箱即信的两个目录签名密钥；用其它密钥签的包会被拒，除非先经 `save_plugin_trusted_key` 注册该 key id + 公钥。这正是 `save_plugin_trusted_key` 作为发布方密钥注册路径的原因 | `crates/dbx-plugin-runtime/src/plugins/marketplace.rs:32-35` |
| 目录版本条目形状 | `{ version, releasedAt?, releaseNotes?, artifacts: [{ target, url, sha256, signingKeyId, size? }] }` | 发布方为上架必须产出的每版本目录条目；架构无关包 `target` 为 `"universal"`，`signingKeyId` 必须在信任库里能解析，否则安装被拒 | `crates/dbx-plugin-runtime/src/plugins/marketplace.rs:79-86` |
| 目录常量 | `SUPPORTED_PLUGIN_CATALOG_VERSION = 1`、`MAX_PLUGIN_CATALOG_BYTES = 4 MiB`、`OFFICIAL_PLUGIN_REPOSITORY_ID = "dbx-official"`、`UNIVERSAL_PLUGIN_TARGET = "universal"` | 上架校验会用到的固定值 | `crates/dbx-plugin-runtime/src/plugins/marketplace.rs:22-25` |

### 8.14 集成层的已知缺陷与数据稀薄处

- **MCP 执行路径未前置拒绝插件连接**（8.7 最后一行）：提前闸门放过，错误延后到 pool 分发器才以固定字符串报出。评审插件与 MCP 集成时应把这条当作已知行为而不是 bug 报告。
- **权限判定位置不一致**：`host.plans:read` 只在 TS bridge 强制（Rust 无检查）；`invoke_plugin` 本身以 `None` 绕过 manifest 权限闸门；`plugin_ui_storage_*` 命令里也没有权限检查，只有在 bridge。命令层不能视为安全边界。
- **`host.network:<origin>` 的解析实现位置在本数据集中没有任何有效锚点**：原锚点指向的 `SUPPORTED_PLUGIN_PERMISSIONS` 恰恰不含该权限。「最多 8 个 origin」这一规则因此只能标为「来源未定位」，读者若要引用应自行在 `dbx-plugin-runtime` 中重新定位 parser。
- **CLI 侧数据稀薄**：只有「`dbx-cli` 不 import 任何插件模块」这一条否定性证据，没有更细的 CLI 行为描述。
- **web 宿主侧数据中等**：路由清单与连接路径有锚点，但 web 下的市场安装、UI 资源 CSP 细节、SSE 事件的字段形状都没有条目覆盖。
- **版本门槛只有一处、且不是代码闸门**：`result-view` 的 0.6.18 是发布时点而非判定逻辑；除此之外本章没有任何其它宿主版本门槛条目。若需按宿主版本做能力协商，当前唯一可用的机制是 `plugin/initialize` 的 `hostApiVersion`/`features` 与 init 消息的 `capabilities` 三个布尔值。

## 9. 实践参考：真实插件用到了什么

本章把三份数据源对齐来看：本仓库的参考插件 `dbx-plugin-excalidraw`、DBX 源码树内的唯一完整示例 `dbx/plugins/examples/hello-workbench`、以及 `dbx-store` 里 17 个已上架插件条目。目的不是罗列 schema，而是回答两个工程问题：**哪些能力已经被真实插件跑通过**，以及**哪些能力只是 schema 里存在**。

### 9.1 Excalidraw 参考插件

#### 9.1.1 贡献点：只用了三个

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `io.dbx.excalidraw.workbench` | `{ "type": "workbench", "id": "io.dbx.excalidraw.workbench", "label": "Excalidraw Studio", "description": "...", "icon": "assets/plugin.svg" }` | 声明本插件唯一 UI 入口可被宿主托进普通 workbench 标签页；只带展示元数据，不指向单独文档 | declarative | 无 | `dbx-plugin-excalidraw/manifest.json:29` |
| `io.dbx.excalidraw.result-view` | `{ "type": "result-view", "id": "io.dbx.excalidraw.result-view", "label": "Sketch on canvas", ... }` | 在查询结果工具栏加按钮，用当前结果集作为有界上下文打开插件标签页 | declarative | 无 | `dbx-plugin-excalidraw/manifest.json:37` |
| `io.dbx.excalidraw.documents` | `{ "type": "filesystem-provider", "id": "io.dbx.excalidraw.documents", "schemes": ["excalidraw"], "root_uri": "excalidraw:/", "capabilities": ["read", "write", "delete", "rename"] }` | 把插件文档库挂在 `excalidraw:` scheme 下，交给宿主自有的文件管理器浏览；**故意不声明 `mkdir`**，因为布局是扁平的 `documents/` + `exports/` | declarative | 无（`host.filesystem` 只用于插件主动发起 `host.openFilesystem`） | `dbx-plugin-excalidraw/manifest.json:46-57` |

`result-view` 有明确的版本门槛，这一条必须写进评审清单：`README.md:44`（兼容表 `:133`）说明必须使用包含 `4f3be8ccf fix(plugin): resolve result-view by UI contribution`（2026-09-20）的 DBX 构建，否则工具栏按钮会打开一个以 `workbenchUnavailable` 失败的标签页；`engines.dbx` 被**刻意**没有抬高。当前宿主树里解析确实走 `findUiContribution`（`apps/desktop/src/components/plugins/PluginWorkbenchTab.vue:39`）。

#### 9.1.2 声明的权限：两个，且都没被真正调用

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `host.workbench` | `"host.workbench"` | 只给插件主动发起的 `host.openWorkbench` / `host.openFilesystem` 放行。Excalidraw 声明了却两个都不调用——**声明了但没跑过的权限** | n/a | `host.workbench` | `dbx-plugin-excalidraw/manifest.json:15`；执行点 `apps/desktop/src/lib/plugins/pluginHostBridge.ts:372` |
| `host.filesystem` | `"host.filesystem"` | 给 `host.openFilesystem` 放行（让沙箱 UI 请 DBX 打开自己的 filesystem provider）。注意：**声明 `filesystem-provider` 贡献点本身不需要任何权限** | n/a | `host.filesystem` | `dbx-plugin-excalidraw/manifest.json:16`；执行点 `pluginHostBridge.ts:385` |

Excalidraw **没有**声明 `host.events`（它没有任何后端到 UI 的事件），也**没有**声明 `host.binary`（它用 JSON 参数里的 base64 分块）。

`host.workbench` 在商店侧有 6/17 采纳：`io.dbx.files`、`io.dbx.kafka`、`io.dbx.ldap`、`io.dbx.ssh`、`com.yiqiui.leetcode-cn`、`io.github.summery-yk.portainer`。`host.filesystem` 只有 `io.dbx.files` 和 `io.dbx.ssh` 两家。

#### 9.1.3 Host API：实际调用了什么

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `window.dbxPlugin.invoke` | `invoke<T>(method, params?, { timeoutMs? }): Promise<T>` | 所有非平凡插件都会用的那一个：把 JSON-RPC 请求经桥接发到自己的 sidecar，失败时 reject `Error(message)`。Excalidraw 包了一层 `call()`，从 `CATEGORY: message` 约定里重新推导错误类别 | ui->host | 无 | `dbx-plugin-excalidraw/frontend/src/api.ts:21` |
| `window.dbxPlugin.readAsset` / `readAssetUrl` | 见下方更正说明 | 读取 `.dbxp` 内的文件，让 CSP 只允许 `data:`/`blob:` 的沙箱也能加载它们。Excalidraw 用它离线内置 Excalidraw 字体：`readAsset` 取 manifest，`readAssetUrl` 把每个字体变成 blob URL | ui->host | 无 | `dbx-plugin-excalidraw/frontend/src/fonts.ts:72` |
| `window.dbxPlugin.ready` / `context` / `locale` / `theme` | `ready: Promise<void>; context: unknown; locale: string; theme: { appearance: "light"\|"dark", tokens: Record<string,string>, editor?: {...} }` | 桥接的启动面。`ready` 在宿主 init 消息后 resolve，`context` 缓存启动载荷，`locale` 与解析后的设计 token 实时推送，插件 UI 无需自身逻辑即可跟随 DBX 明暗与调色板 | host->ui | 无 | `pluginHostBridge.ts:790-795` |
| `host.saveFile` / `fileTransfer.*` / `host.copy` / `host.downloadFile` | `saveFile(options, data): Promise<{path}\|null>`；`fileTransfer.pick/read/beginSave/write/finish/cancel`；`copy(text)`；`downloadFile({downloadId, fileName, params})` / `cancelDownload(id)` | 沙箱 iframe 用不了的能力的宿主替身：原生保存对话框、流式文件读写句柄、系统剪贴板、宿主驱动的下载。在 Excalidraw 的桥接类型里声明为可选但**从未调用**——它的导出链路故意走 sidecar，因为 `<a download>` 在沙箱里被静默吞掉 | ui->host | 无（`host.saveFile`/`host.copy`/`host.pickFiles` 没有 manifest 门禁；`host.storage` 与 `host.binary` 有） | `dbx-plugin-excalidraw/frontend/src/export.ts:66-69` |
| `window.dbxPlugin.stream` / `sendBinary` / `onBinary` | `stream(method, params, {streamId?, closeMethod?}) => { stream: ReadableStream, metadata }`；`sendBinary(channel, data)`；`onBinary(listener)` | 二进制推拉管线。**参考插件未用**：Excalidraw 两个权限都不声明，改用普通 `invoke` 参数里的 512 KiB base64 分块 | 混合方向（见下） | `host.binary`（仅 `sendBinary`/`onBinary`） | `pluginHostBridge.ts:772`；分块 `export.ts:11` |

上限与更正：

- `invoke` 的 `options.timeoutMs` 会被宿主夹到 120000 ms（`pluginHostBridge.ts:930`）。
- `readAsset` 路径必须是相对路径且不含 `..`（`pluginHostBridge.ts:1035`）。**更正**：原文给的签名在两侧都不完整——宿主 payload 类型有**三个**字段，插件自己声明的返回类型是一个包含纯 `string` 的联合类型，因此 `Promise<{dataBase64, contentType}>` 这个写法与两侧都对不上。Excalidraw `types.ts:56` 还记了一处 doc/dev-host 分歧：文档说是 text，dev host 却返回原始信封，所以 `fonts.ts` 同时兼容两种形状。
- `host.saveFile` 等方法的容量上限：save payload ≤512 MiB、二进制分块 ≤8 MiB、copy 文本 ≤2 MiB、并发下载最多 2（`pluginHostBridge.ts:13, :360, :411, :421, :318`）。
- `stream`/`sendBinary`/`onBinary` 的**方向不统一**（更正）：`stream()` 是 UI 发起的（它自己发 `backend.invoke`，只有 chunk/end/error 处理是入站），所以这一条混合了 ui->host 调用与 host->ui 监听。

#### 9.1.4 宿主事件

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `dbx-plugin-init` / `dbx-plugin-context` / `dbx-plugin-env` | `new CustomEvent("dbx-plugin-init", { detail: <整个 host init 帧> })`；`"dbx-plugin-context"` detail 为 context；`"dbx-plugin-env"` detail 为 `{ locale, theme }` | 宿主把启动身份、后续 context 变化、环境变化作为 document 级 CustomEvent 推送。因为派发在 `document` 上且不冒泡，**window 上的监听器永远不会触发**——Excalidraw 在 document 上注册并在注释里写明了这点 | host->ui | 无 | `dbx-plugin-excalidraw/frontend/src/useHostSession.ts:61` |
| `dbx-plugin-event` / `dbx-plugin-binary` / `dbx-plugin-filedrop` / `dbx-plugin-dragstate` | `...event{detail: message}`；`...binary{channel,data}`；`...filedrop{files}`；`...dragstate{active}` | sidecar 事件、二进制帧、OS 拖拽状态与投放文件句柄的转发通道。`forwardEvent` 在插件未声明 `host.events` 时静默丢弃 | host->ui | `host.events`（事件）、`host.binary`（二进制） | `pluginHostBridge.ts:283` |

**更正（`dbx-plugin-init` 的 detail）**：派发时传入的是**整个宿主 init 帧**，不是签名里那个缩减过的 `{contributionId, context, locale, theme, permissions, capabilities}` 对象——帧里还带 `source`、`version`、`type`、`pluginId`。Excalidraw 从该帧读 `detail.contributionId`/`detail.context`，所以转述无害但并非逐字。

Excalidraw 还认为 init 事件有竞态：沙箱把 bundle 当 deferred module 跑，于是它退回到 `window.dbxPlugin.context` 并推断 surface（`host.ts:79-93`）。四个转发事件它一个都不用（没有后端事件）；`hello-workbench` 只用 `onEvent`，监听 `hello/connectionChanged` 与 `hello/progress`。

#### 9.1.5 后端 sidecar 的 JSON-RPC 面

| 方法 | 签名 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `document/*` | `document/list {} -> {items:[DocumentMeta]}`；`create {name}`；`get {id} -> {document, scene\|null, corrupt}`；`saveScene {id, scene}`；`rename {id,name}`；`delete {id} -> {success}` | 图文档 CRUD，在单个 Handle switch 里按方法前缀分派。方法名是插件私有的：宿主除了协议名字符集外不强制任何命名空间 | host->plugin | 无 | `dbx-plugin-excalidraw/backend/main.go:104` |
| `asset/stat` / `asset/putChunk` / `asset/getChunk` | `stat {hash} -> {exists, asset}`；`putChunk {documentId, hash, mimeType, size, offset, dataBase64}`；`getChunk {hash, offset, length} -> {dataBase64, size, mimeType}` | 内容寻址（sha256）的图片资源库，以 512 KiB 级 base64 分块穿过 2 MiB 桥。Excalidraw 特意把 image dataURL 从场景 JSON 里剥出来，好让每次自动保存都低于桥的上限，加载时再回填 | host->plugin | 无 | `backend/main.go:229` |
| `export/write` | `{jobId, name, size, offset, dataBase64} -> {received, complete, path}` | 插件对浏览器下载的沙箱安全替代：渲染出的 PNG/SVG/.excalidraw 字节流进 sidecar，写到 `<plugin data>/exports/` 下并回传磁盘路径供 UI 显示 | host->plugin | 无 | `backend/main.go:271-273` |
| `filesystem/list\|read\|write\|delete\|rename\|createDirectory` | 每次调用都带 `providerId`（+ 可选 `connectionId`）：`list{uri,cursor,limit}->{entries,nextCursor?}`；`read{uri,maxBytes}->{dataBase64,contentType,truncated,etag}`；`write{uri,dataBase64,create,overwrite,etag}`；`delete{uri,recursive}`；`rename{sourceUri,targetUri,overwrite}`；`createDirectory{uri}` | 宿主自有文件管理器驱动的契约。Excalidraw 六个全都实现，**每次调用都重新校验 providerId**，以免过期的宿主绑定指到另一个挂载点；`createDirectory` 返回 `NOT_SUPPORTED` | host->plugin | 被服务无需权限；仅 UI 发起的 `host.openFilesystem` 需要 `host.filesystem` | `backend/main.go:90` |

限制与更正：

- `maxBase64Chunk = 2 * 1024 * 1024`（`backend/main.go:18`）；这个 2 MiB 就是 UI->host 桥的参数上限（`pluginHostBridge.ts:9`）。导出名超过 160 rune 会被拒（`dbx-plugin-excalidraw/README.md:286`），UI 侧分块 512 KiB（`export.ts:11`）。
- 后端仍有 `filesystem/createDirectory` 分支，它返回 `NOT_SUPPORTED` 而不是不存在（`backend/main.go:440-443`）。
- Excalidraw 的 `read` 从不截断：超大文档会以 `TOO_LARGE` 明确失败，而不是返回半个文件（`backend/main.go:362-366`）。
- 错误以结构化类别返回：`mapStoreError`（`backend/main.go:31-76`），用 SDK 的 `PluginError` code + message。

#### 9.1.6 协议、传输与工程文件

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `plugin/initialize` | 宿主发 `{ host: { protocolVersions: [1] }, plugin: { id, version }, permissions: [...] }`；插件答 `{ protocolVersion: 1, capabilities: [...], plugin: { id, version } }` | 强制首帧。插件必须回答 1，否则宿主以 `-32001` 拒绝；身份不匹配在会话暴露前即被拒 | host->plugin | 无 | `backend/third_party/dbx-plugin-sdk/sdk.go:364` |
| `stdio-jsonl`（默认传输） | 每行一个 JSON-RPC 2.0 值；单消息最大 8 MiB；插件事件即 JSON-RPC notification | 默认后端传输，也是 Excalidraw 用的。请求并发分派，响应用请求 id 关联；诊断走 stderr | n/a | 无 | `sdk.go:130`；`maxJSONBytes = 8 * 1024 * 1024`（`sdk.go:17`） |
| `stdio-framed` | 5 字节头 `[kind: u8][length: u32 BE]` + payload；kind 0 = JSON，kind 1 = binary（payload = u16 channel 长度 + channel + data） | 二进制通道（PTY/终端、大传输）所需的帧模式，经 `backend.transport` 声明并搭配 `host.binary` | n/a | `host.binary` | `sdk.go:100-103` |
| `PluginError "CATEGORY: message"` 约定 | `NewError(code, "<CATEGORY>: <message>")`，如 `-32000 DOCUMENT_TOO_LARGE`、`-32602 INVALID_REQUEST`、`-32601 Method not found: <m>` | 参考插件把机器可读的错误类别编码进 JSON-RPC 错误消息，前端用正则还原，UI 分支不必匹配散文；消息还要求不得泄漏 OS 路径 | plugin->host | 无 | `backend/main.go:26-29`；前端 `api.ts:27` |
| `DBX_PLUGIN_DATA_DIR` | `<持久插件目录>`；同级文档化环境变量 `DBX_PLUGIN_ID`、`DBX_APP_VERSION` | 宿主为每个 sidecar 设置的持久数据目录，升级与卸载都不清除。Excalidraw 以它为存储根并追加自己的插件 id 作为子目录，另支持用户环境变量覆盖与 config 目录兜底 | host->plugin | 无 | `dbx-plugin-excalidraw/README.md:78-84` |
| `dbx-plugin-sdk`（Go，vendored） | `NewServer(Metadata{ID, Version, Capabilities}, Handler).Serve()`；`Handler.Handle(RequestContext, method, params, *Emitter) (any, *PluginError)`；`Emitter.Event`、`Emitter.Binary` | Excalidraw 依赖的 Go sidecar SDK。仓库把它 vendor 到 `backend/third_party/dbx-plugin-sdk` 并用 `go.mod` replace 指令，使 vet/test/build/smoke 全离线可跑，无需安装 CLI 或 `go.work` | n/a | 无 | `backend/main.go:12` |
| `dbx-plugin.toml` | `schema_version = 1`；`[backend]` language/directory/binary；`[package] include = ["assets","ui"]`；`[dev] ui_build` / `ui_watch` | `dbx-plugin` CLI 消费的打包/开发文件：指明要构建的 sidecar 二进制、要进 `.dbxp` 的目录、以及 `dbx-plugin dev` 要跑并 watch 的命令 | n/a | 无 | `dbx-plugin-excalidraw/dbx-plugin.toml:11-15` |
| `check-manifest.mjs` | `CONTRIBUTIONS = { "connection-provider": [id, database_type, fields], workbench: [id,label], "filesystem-provider": [id,label,schemes], "context-menu": [id,label,menu], "result-view": [id,label] }`；`PERMISSIONS = [host.events, host.binary, host.workbench, host.filesystem, host.plans:read]`（0.2.3 起含 plans；仍缺 `host.storage` 与新加的 `host.ai`） | 参考插件自带的起飞前守卫，断言那些宿主只在安装时才报的约束：标识符形状、每种贡献点的必填字段、图标文件确实存在、本地化 key 能解析、权限在已知集合内 | n/a | 无 | `dbx-plugin-excalidraw/scripts/check-manifest.mjs:24-30`（PERMISSIONS 在 `:34`） |
| `release.mjs` + `make-store-candidate.mjs` | `node scripts/release.mjs [--prerelease]`；`node scripts/make-store-candidate.mjs <tag>` | `release.mjs` 重跑版本/manifest 守卫、拒绝脏或未同步的工作树、从 manifest 版本推导 tag，用 git 凭据创建 GitHub Release；候选脚本从 Release 的 `release-candidates.json` 重建商店 PR JSON，保证 hash 与已发布字节一致 | n/a | 无 | `scripts/make-store-candidate.mjs:8-10` |

必须写出的两处不一致与坑：

- 协议名协商的**注意**：`plugin/initialize` 里的 `capabilities` 是后端自己声明的字符串（Excalidraw 为 `["documents"]`，hello-workbench 为 connections/events/filesystem），**明确不是** manifest 权限列表。**更正**：原文把这条注释锚到 `dbx/plugins/README.md:498` 是错的——498 行讲的是 filesystem entry 字段（`name`、`uri`、`kind`）；initialize 的请求/响应形状文档在 `dbx/plugins/README.md:619-647`，498 行并不存在这样一条注释。
- `stdio-jsonl` 的宿主侧锚点**更正**：`manifest.rs:156-163` 是 `PluginBackendTransport` 枚举（那只是**默认值**的来源）；宿主的 8 MiB / 64 MiB 消息上限声明在 runtime crate 的其他位置，原文把两者混为一谈。
- `DBX_PLUGIN_DATA_DIR` 的**更正**：原文第二条锚点指错了文件。`dbx/plugins/README.md:523` 是 `host.getPlanCapabilities` JSON 示例里的一行（`"dbVersion": "15.19",`）；"宿主不预创建该目录" 这句陈述在文档树里，不在 `plugins/README.md`。hello-workbench 只读 `DBX_PLUGIN_ID` / `DBX_APP_VERSION`（`backend/src/main.rs:99-100`），不读数据目录。
- `check-manifest.mjs` 的**分歧（2026-09-23 更新）**：本插件 0.2.3 已把 `host.plans:read` 补进它的 `PERMISSIONS` 列表（`:34`），但列表仍缺 `host.storage` 与宿主新加的 `host.ai`——DBX schema 与 `crates/dbx-plugin-runtime/src/plugins/manifest.rs:25` 都接受它们，也就是说这个本地守卫仍会拒掉一份合法 manifest。
- `dbx-plugin-sdk` 的 vendored 副本必须与 CLI 自带 SDK 保持同步，smoke 脚本会在两者漂移时告警（本仓库 `README.md:192-196`）。
- `dbx-plugin.toml` **不携带**版本或身份——`manifest.json` 是声明过的唯一事实来源（本仓库 `README.md:211`）。
- 插件后端可以向宿主回调的唯一方向是 `host/requestUserInput`（见 9.1.7）。

#### 9.1.7 Host API 全量盘点：catalog 未收录但真实存在的调用面

以下条目在官方插件作者文档里没有成体系列出，只能从桥接源码读出，评审时容易被漏掉。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `window.dbxPlugin.notify` | `notify(method, params?) => request('backend.notify', { method, params })` | `invoke` 的即发即忘版：向自己的 sidecar 发 JSON-RPC notification，不等响应 | ui->host | 无 | `pluginHostBridge.ts:802`（宿主分派 `:350-354`；文档 `dbx/plugins/README.md:368`） |
| `window.dbxPlugin.reopenConnection` / `host.reopenConnection` | `reopenConnection(connectionId) => request('host.reopenConnection', { connectionId }) -> { ok: true }` | 用户显式触发的自有连接重连，跑完整生命周期（允许交互式密码提示）。桌面桥里**没有 manifest 权限门禁**，唯一前提是宿主装了实现（否则抛 `Connection reopen is unavailable`） | ui->host | 无 | `pluginHostBridge.ts:815`；宿主处理 `:378-383`；桥接声明 `:98`；dev host 亦实现（`plugins/sdk/dev-host/browser-bridge.mjs:126`） |
| `closeTab` 快捷键消息（Cmd/Ctrl+W） | `parent.postMessage({ source: 'dbx-plugin', version: 1, type: 'shortcut', shortcut: 'closeTab' }, '*')` | 注入的 SDK 装了一个捕获阶段 keydown，把沙箱内的 Cmd/Ctrl+W 变成请宿主关闭插件标签页；桥接在正常请求分派之前拦截 | plugin->host | 无 | `pluginHostBridge.ts:903-908`；宿主侧 `:177` |
| `host.getContext` | `window.dbxPlugin.request("host.getContext") -> PluginWorkbenchContext`（快照） | 返回宿主为该标签页持有的（克隆后的）启动上下文。这是官方模板读取 workbench context 的惯用法，与 init 消息/context 推送携带的是同一份快照 | ui->host | 无 | `pluginHostBridge.ts:343`；用法 `dbx/plugins/GETTING_STARTED.zh-CN.md:137` |
| `window.dbxPlugin.onContext` / `onInit` | `onContext(listener): () => void`；`onInit(listener): () => void` | document CustomEvent 的页内等价物。若 context 已知，`onInit` 会**立即**调用监听器，插件不必与 init 帧赛跑；两者都在 dev host 的 Host API 1.0 子集内 | host->ui | 无 | `pluginHostBridge.ts:853-854`；dev host 清单 `dbx/plugins/sdk/dev-host/README.md:69` |
| `host.getPlanCapabilities` / `host.explainPlan` | `getPlanCapabilities(connectionId): Promise<PluginPlanCapabilities>`；`explainPlan({connectionId, database?, schema?, sql, mode: "estimated", timeoutMs?}): Promise<PluginPlanResult>` | 只读的估算执行计划。宿主自己持有 EXPLAIN 语句，拒绝 `estimated` 以外的任何 mode，从不把凭据或执行路径交给插件 | ui->host | `host.plans:read` | `pluginHostBridge.ts:957` |
| `host.openWorkbench` | `openWorkbench(contributionId, context?, { forceNew? }): Promise<void>` | 从沙箱 UI 打开本插件自己的另一个 workbench，可强制新标签页 | ui->host | `host.workbench` | `pluginHostBridge.ts:375` |
| `host.openFilesystem` | `openFilesystem(providerId, context?): Promise<void>` | 请 DBX 为插件的某个 filesystem provider 打开宿主自有文件管理器标签页 | ui->host | `host.filesystem` | `dbx/plugins/examples/hello-workbench/ui/index.html:318` |
| `host/requestUserInput` | 插件发 `{ jsonrpc, id: "prompt-1"(string), method: "host/requestUserInput", params: { prompt(≤2000), title?, echo?, default?, options?≤8, timeoutSecs? 5-600 } }` -> `{ action: "submit", value }` \| `{ action: "cancel" }` \| `{ action: "timeout" }` | 唯一一个 plugin->host 的请求方向：插件通过 DBX 对话框问用户问题（MFA 码、host-key 确认）。字符串 id 让它可以与宿主在同一流上的数字 id 共存 | plugin->host | 无（改由宣告的 host features 门禁） | `dbx/plugins/README.md:585` |
| `plugin/initialize` 的 Host API 版本与 feature 宣告 | `SUPPORTED_PLUGIN_HOST_API_VERSION = "1.2.0"`；`SUPPORTED_PLUGIN_HOST_FEATURES = ["host.requestUserInput"]` | 宿主在握手里宣告 Host API 版本与 feature 列表；两者都是加法式演进，插件必须按它门禁而不是探测。1.1 加插件发起的用户提问，1.2 加估算计划 API | host->plugin | 无 | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:16` |
| init 帧里的 permissions + capabilities 宣告 | init 帧携带 `permissions: [...manifest.permissions]` 与 `capabilities: { downloadFile: boolean, planApi: boolean, storage: boolean }`，外加 contributionId/locale/theme/context | 沙箱 UI 被告知宿主解析出的 manifest 权限，以及哪些可选 Host API 组存在，于是插件能在运行时分支（用 `capabilities.planApi` 门禁计划调用、`capabilities.storage` 门禁存储），而不必发请求去探测 | host->ui | 无 | `pluginHostBridge.ts:246-254`；文档 `dbx/plugins/README.md:376, :546` |
| 官方 UI kit + `dbxTheme` 标记 | class：`dbx-card`、`dbx-section-title`、`dbx-btn(--primary/--danger/--ghost)`、`dbx-label`、`dbx-input`、`dbx-select`、`dbx-textarea`、`dbx-hint`、`dbx-row`、`dbx-table`、`dbx-badge`、`dbx-link`；`document.documentElement.dataset.dbxTheme = "light"\|"dark"`；预绘制 `:root` token 样式 | 每个插件 iframe 文档都会被注入宿主的组件库 CSS、SDK 与启动时主题种子，避免在暗色宿主上首帧闪白。同一套 CSS 也是插件 UI 无需自身逻辑即跟随 DBX token 的原因 | host->ui | 无 | `pluginHostBridge.ts:608, :701, :561`；文档 `dbx/plugins/README.md:394` |
| `host.download.progress` | `post({ type: 'event', method: 'host.download.progress', params: <progress> })` | 桥接**自己合成**（而非转发自 sidecar）的唯一进度通道：`host.downloadFile` 流式传输期间宿主以这个固定方法名向插件 UI 推进度 | host->ui | 无（父调用 `host.downloadFile` 本身也无门禁） | `pluginHostBridge.ts:324` |

`host.download.progress` 有一个反直觉点值得单独记住：它作为普通 `event` 帧投递，因此会同时到达 `onEvent` 与 `dbx-plugin-event` document 事件，**且不需要 `host.events`**——只有转发自 sidecar 的事件才需要该权限。

UI kit 的 class 清单已按 `pluginUiKitCss` 逐项核对，`.dbx-btn--primary/--danger/--ghost` 是唯一被生成的修饰符（`pluginHostBridge.ts:649-652`）。

`dbx-plugin-binary` / `dbx-plugin-filedrop` / `dbx-plugin-dragstate` 三个事件在上述盘点里没有可观察的消费者：Excalidraw 四个转发事件一个不用，hello-workbench 只用 `onEvent`。

`result-view` 的启动载荷形状（写 `result-view` 插件必须知道）：

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `result-view` 的 `context.result` | `{ connectionId, database, sql, result: { columns: string[], rows: unknown[][], truncated: boolean } }`，宿主把 rows 上限设到 **500**，整个 context 约 2 MiB | result-view 标签页收到的确切载荷，也是宿主侧对这一载荷唯一文档化的界。**上限 500 行**是硬约束 | host->plugin | 无 | `dbx/plugins/README.md:431`；消费方形状 `dbx-plugin-excalidraw/frontend/src/types.ts:37-46` |

它需要 UI entrypoint（`README.md:431`）。参考插件因为该形状由宿主拥有，选择了防御式重新推导（`dbx-plugin-excalidraw/frontend/src/host.ts:113-125`）。

### 9.2 `hello-workbench`：唯一的非 SQL 连接全生命周期示例

`hello-workbench` 是 DBX 树里**唯一**一个带完整生命周期的、可保存的非 SQL 插件连接示例：声明式表单字段、字段绑定、自定义对话框动作，以及同时指向自定义 workbench 与宿主管理文件系统的指针。

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| `dbx.example.hello.connection` | `{ "type": "connection-provider", "id": "dbx.example.hello.connection", "database_type": "hello", "fields": [5 个 formField 对象], "workbench": "dbx.example.hello.main", "filesystem_provider": "dbx.example.hello.files", "capabilities": ["test", "connect", "disconnect"], "actions": [{ "id": "suggest-greeting", "requires_valid_form": false }] }` | 参考示例的全部贡献点集中在这一条：字段绑定覆盖 `name`/`host`/`port`/`config`/`secret` | declarative | 无 | `dbx/plugins/examples/hello-workbench/manifest.json:28` |
| `connection/test` / `connect` / `disconnect` / `action` | `connection/test {provider, connection, runtime} -> {success, message}`；`connect`；`disconnect`；`connection/action {..., action:{id}} -> {success, message, fieldValues}` | 宿主为保存的插件连接拥有的固定生命周期；DBX 只调用这些名字，且只对 provider 声明的 capabilities 调用。自定义对话框动作可以把字段值写回表单 | host->plugin | 无 | `backend/src/main.rs:68` |
| `host.openFilesystem` 的调用点 | `await window.dbxPlugin.openFilesystem("dbx.example.hello.files", { connectionId });` | 这是所有可读插件里 `openFilesystem` 的**唯一调用点**，因此它也是"filesystem-provider 能被已有 workbench UI 驱动"的单点真实证明 | ui->host | `host.filesystem` | `ui/index.html:318` |
| 事件消费 | `onEvent` 监听 `hello/connectionChanged`、`hello/progress` | 示例用事件把 sidecar 状态变化推回 UI | host->ui | `host.events` | 见 9.1.4 事件表 |

细节与更正：

- 字段绑定实际用到的五种：`name`/`host`/`port`/`config`/`secret`（`manifest.json:40,48,56,64,70`）。`secret` 字段被文档化为落到 `connection_secrets`，**永不**进入 `config_json`（`manifest.json:71`）。
- hello-workbench 的 filesystem provider 只声明 `"capabilities": ["read"]`（`manifest.json:100`）。
- 连接生命周期方法的 payload 还携带宿主解析后的 `runtime.host/port` 端点（hello-workbench `README:127-155`）；方法名常量在宿主侧 `crates/dbx-plugin-runtime/src/plugins/manifest.rs:20-23`。
- **更正（证据锚点偏 4 行）**：原文把 `suggest-greeting` 的引用锚在 `main.rs:64`，实际在 `main.rs:68`；64 行是 `connection/disconnect` 处理器的收尾（`Ok(json!({ "success": true }))`）。条目实质正确。

### 9.3 第二个数据点：JDBC 插件清单是 legacy manifest v0

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| JDBC 插件 manifest | `{ id, name, version, protocol_version: 1, description, executable, drivers: [{ id, label, kind, database_type }] }`，**没有** `manifest_version`、`engines`、`entrypoints`、`contributions` | 树内 JDBC 插件早于 manifest v1：顶层 `executable` 加 `drivers` 列表，而不是 `entrypoints` + `contributions`。宿主刻意保留这些字段可读，正是为了让 JDBC 能独立于宿主 runtime 迁移 | declarative | 无（完全没有 `permissions` 字段） | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:95-96` |

硬守卫阻止两种形状混用：v1 manifest 若使用 `executable`/`drivers` 会以 `"Manifest v1 cannot use legacy executable or drivers fields"` 失败（`manifest.rs:802-807`），覆写 `protocol_version` 同样失败（`manifest.rs:808-810`）。对评审者的含义：看到没有 `entrypoints` 的清单不要当成漏写，这是受支持的 legacy 形态，但它也意味着**无法携带任何权限声明，也无法声明任何新式贡献点**。

### 9.4 `dbx-store` catalog：校验规则与上架门槛

#### 9.4.1 作者提交的机器可读制品

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| Store 候选文档 `candidates/<id>.json` | 必填：`schemaVersion(=1)`、`id`、`publisher`、`version`、`targets[]`；listing 字段：`name`、`description`、`icon`、`tags[]`、`permissions[]`、`source`、`homepage`、`license`、`releaseNotes`、`localizations{}` | 作者提交的唯一机器可读制品。**没有任何字段记录贡献点、入口或截图**——插件的能力面只能在 PR 散文里披露 | n/a | n/a | `dbx-store/schemas/plugin-candidate.schema.json:8` |
| 候选 target 条目 | `{ target: "^[a-z0-9-]+$", url: https URI, sha256: 64 hex, size: 1..536870912 }` | 每个平台一个**未签名** `.dbxp`，用 hash 与字节数双重钉住。签名会重新下载每个候选，hash 或 size 不符即拒，并且拒绝已经含 `signature.json` 的包 | n/a | n/a | `dbx-store/schemas/plugin-candidate.schema.json:53` |
| catalog 中观测到的 targets | `darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`、`windows-x64`，以及（仅 `io.dbx.k8s`）`windows-arm64` | 已上架插件的平台矩阵实践 | n/a | n/a | `dbx-store/schemas/plugin-candidate.schema.json:53` 邻域 |

候选 schema 与校验器都是 `additionalProperties:false`（`:7` 与 `validate.mjs:150-153`），所以未知字段是**硬失败**而不是警告。

#### 9.4.2 listing 元数据白名单与自动同步

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| listing 元数据白名单（自动同步路径） | `allowedMetadata = { name, description, icon, tags, permissions, source, homepage, license, releaseNotes, localizations }` | 对 auto-update 仓库，候选由 Release 的 `release-candidates.json` 加仓库的 `.dbx-store.json` 拼装而成，任何其他 key 都会中止同步。这正是 catalog **永远只能**携带 listing 字段、永远不会带贡献点或截图的原因 | n/a | n/a | `dbx-store/scripts/sync-release-candidate.mjs:41` |
| 仅首次上架时的必填项 | `name` 与 `license`（`sync-release-candidate.mjs:63-64`）；`name`/`source`/`license`（`validate.mjs:172-176`） | 首次登记的额外门槛 | n/a | n/a | 同上 |
| 自动更新登记表 | `automation/plugin-sources.json -> { version: 1, plugins: [{ repository, metadataPath, autoUpdate }] }` | 登记被商店**每小时轮询**的公开插件仓库；对 `autoUpdate:true` 的仓库，同步器会创建或更新候选 PR，但**从不签名、从不合并**。Excalidraw 以 `autoUpdate:true` 登记，所以其作者从不手工开商店 PR | n/a | n/a | `dbx-store/automation/plugin-sources.json:60-62` |
| `release-candidates.json` | `{ plugin: { id, name, description, publisher, version, permissions: sorted[] }, artifacts: [{ target, url, sha256, size }] }` | 由可复用的 DBX 插件发布工作流产出：解压每个构建出的候选、拒绝含 `signature.json` 的包、要求所有 target 对 manifest 身份达成一致。它是商店同步器**唯一**的机器可读输入 | n/a | n/a | `dbx/.github/workflows/plugin-release-reusable.yml:248` |

共 13 个仓库登记，只有 `Abeautifulsnow/dbx-plugin-api-studio` 是 `autoUpdate:false`（`plugin-sources.json:52`），也就是唯一需要手工提交候选的仓库。Excalidraw 的 Release 恰好发布 6 个资产：5 个 `.dbxp` 加这一个文件；身份块在 `plugin-release-reusable.yml:232-239` 构造。

#### 9.4.3 会让上架失败的门槛

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| 安装时 catalog 权限必须等于 manifest 权限 | `manifest.permissions`（排序集合）必须等于 catalog 条目的 `permissions`，否则安装以 `"Marketplace package permissions {:?} do not match catalog permissions {:?}"` 失败 | catalog 的 `permissions` 数组**不是装饰**：marketplace 安装器拿它与包 manifest 对比，任何差异都拒绝安装。这让过期的 catalog 条目成为一个版本的硬安装阻塞 | n/a | n/a | `dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:839`；期望值构造 `crates/dbx-plugin-runtime/src/plugins/marketplace.rs:441` |
| 过期条目的**活实例** | 仓库 manifest 在 0.2.1 声明 `[host.workbench, host.filesystem]`，而商店条目仍写着 `[]` | 这正是上面那条规则的实际触发场景，评审时必须核对 | n/a | n/a | 同上 |
| catalog `permissions` 的真实来源（自动路径） | `.dbx-store.json` 可携带 `"permissions": [...]`（白名单允许）；但同步器**不读** `release-candidates.json` 里的 `plugin.permissions` | 发布流水线把 manifest 的排序后权限写进 `release-candidates.json`，而商店同步只从该文件读 id/publisher/version，listing 字段全部取自 `.dbx-store.json`。因此 `.dbx-store.json` 漏写 permissions 的仓库，会发布一条声称无权限的 catalog 条目 | n/a | n/a | `dbx-store/scripts/sync-release-candidate.mjs:19-21` |
| 同一问题的**活实例** | `dbx-store/plugins/io.dbx.excalidraw.json:14` 为 `"permissions": [],`，而源仓库的 `.dbx-store.json` 根本没有 permissions 字段，manifest 却要两个 | 手工路径（`make-store-candidate.mjs:82-85`）会镜像 manifest，所以只有自动路径会丢。原文此处记录：漏写曾导致 catalog 声称插件什么都没请求 | n/a | n/a | 同上 |
| 签名密钥与吊销门槛 | `artifact.signingKeyId` 必须存在于 `signing-keys.json`，`status != "preview"` 且未被吊销；算法必须是 ed25519 + 32 字节 base64 公钥；`keys.json` 的 status ∈ `{preview, active, retired}` | 签入的 preview key 只是客户端契约夹具：校验器禁止 catalog 制品引用它。被吊销的插件版本与签名密钥都不得留在生成的 catalog 里 | n/a | n/a | `dbx-store/scripts/validate.mjs:118` |
| 当前密钥实况 | 两把：`dbx-store-preview-2026`（preview，不可用）与 `dbx-store-release-2026`（active，catalog 中每个制品都用它） | 上架时要注意别指到 preview key | n/a | n/a | `dbx-store/scripts/validate.mjs:118` 邻域 |
| 仓库形状门槛 | 任何地方都不得提交 `.dbxp`；仓库每个文件 ≤1 MiB；候选 URL 必须是 `https:` 且不得以 `https://github.com/t8y2/dbx-store/releases/` 开头 | 二进制包永不进入商店仓库；被评审的候选躺在作者自己的 Release，签名后的制品发布到对象存储。指向已签名 DBX Store 资产的候选被拒 | n/a | n/a | `dbx-store/scripts/validate.mjs:206` |
| 图标 URL 约束 | 必须是 `.svg`/`.png`，并被重写为 `https://dl.dbxio.com/plugins/<id>/<version>/icon.<ext>` | 与上一条同属仓库形状门槛 | n/a | n/a | `validate.mjs:285-297` |
| 未处理的候选必须让 CI 红 | `throw new Error("Catalog contains N open candidate(s) awaiting DBX Store signing: ...")` | 只要 `candidates/*.json` 存在，校验器就失败，直到受保护的签名工作流生成 `plugins/<id>.json`、重建 `catalog/index.json` 并删除候选文件——因此未签名的工作**永远不可能被合并** | n/a | n/a | `dbx-store/scripts/validate.mjs:70` |
| 签名触发 | 维护者在 PR 上评论 `/sign`；签名环境除 `t8y2` 外均为 `plugin-signing`，`t8y2` 用无门禁的 `plugin-signing-owner` | 上架流程的人为环节 | n/a | n/a | `dbx-store/README.md:84` |
| `verified` 标记 | `"verified": boolean`（catalog 默认 false） | 本意只由 DBX 维护者在评审时赋值。两条独立路径使它无法被作者设置：候选 schema 没有 `verified` 字段，且 finalizer 对新上架硬编码 false | n/a | n/a | `dbx-store/scripts/finalize-candidates.mjs:67` |
| `verified` 的**矛盾点** | 全部 17 个 catalog 条目都是 `verified:false`，尽管 publisher 记录 `t8y2` 与 `dbx` 的 status 是 `"verified"` | publisher status 从未传播到 `plugin.verified` | n/a | n/a | `publishers/t8y2.json`、`publishers/dbx.json` |
| Publisher 记录 | `{ id, name, status }`——恰好这三个 key；文件名必须等于 `publishers/<id>.json`；`plugin.publisher` 必须能解析到已注册 id | publisher 记录确立归属与评审责任，**明确不是**密码学信任；校验器也只接受这三个 key | n/a | n/a | `dbx-store/scripts/validate.mjs:227` |

#### 9.4.4 catalog 结构上无法记录的东西

| 名称 | 签名/取值 | 说明 | 方向 | 权限 | 证据 |
|---|---|---|---|---|---|
| catalog 插件对象键集合 | `id, name, description, publisher, verified, icon, tags, permissions, source, homepage, license, latestVersion, versions[], localizations` | 任何 catalog 或候选字段都**不记录**已发布插件声明了哪些贡献点类型，所以商店无法回答"有多少个 workbench / filesystem-provider / result-view 插件"。贡献点使用情况只能从权限与 release notes 推断 | n/a | n/a | `dbx-store/scripts/validate.mjs:80` |
| `proxy_route`（有真实生产使用的例外） | 在 connection-provider 上写 `"proxy_route": true`；宿主改为下发 `runtime.proxy = { type: "socks5", host, port, username?, password? }` 而不是静态转发 | 多端点 provider（Kafka 的 `advertised.listeners`、集群发现）声明它，使每个被发现的 broker 都能通过同一条 SOCKS5 路由拨号，而不是只能走 bootstrap 端点。Kafka 插件的 release notes 就是一次采用它的现场报告 | host->plugin | 无 | `dbx-store/plugins/io.dbx.kafka.json:110` |

`proxy_route` 文档在 `dbx/plugins/README.md:293-320` 与 `dbx/plugins/manifest.schema.json`（`"proxy_route": { "type": "boolean", "default": false }`）。**catalog 无法表达它，所以 release notes 是唯一的公开痕迹。**

另外两处口径：publisher 记录共 16 条对应 17 个插件；`dbx` 与 `ma123456mai` 已注册但没有对应 catalog 插件。Excalidraw 的 publisher 是 `{ id: "runstone", status: "unverified" }`，尽管其插件 id 被命名空间化为 `io.dbx.excalidraw`。

### 9.5 商店里出现过的贡献点类型：哪些实战验证过，哪些是新的

先把方法学说清楚：**catalog 不记录贡献点**（见 9.4.4），所以下面全部是从权限声明与 release notes 反推的**代理指标**，不是直接观测。代理指标有系统性偏差——声明 `host.workbench` 只证明该插件可能要调用 `host.openWorkbench`，并不证明它拥有 workbench 贡献点；`filesystem-provider` 同理。数据在这一点上是薄的，不要把它当成贡献点普查结果。

| 贡献点类型 | 2026 年 9 月的可观测证据 | 判定 |
|---|---|---|
| `filesystem-provider` | 商店侧 2/17 声明 `host.filesystem`（`io.dbx.files`、`io.dbx.ssh`）；示例侧 hello-workbench 声明 `dbx.example.hello.files` 且是 `openFilesystem` 的唯一调用点（`ui/index.html:318`）；参考实现侧 Excalidraw 用 `excalidraw:` scheme 全量实现六个方法 | 已有多点实战，包括被已有 workbench UI 驱动 —— 但**驱动面只有读**：`PluginFileManager.vue` 只调 `list`（`:51`）与 `read`（`:96`），四个 mutation API 零 UI 调用方，详见 §9.6 的 `mkdir` 行 |
| `workbench` | 商店侧 6/17 声明 `host.workbench`（`io.dbx.files`、`io.dbx.kafka`、`io.dbx.ldap`、`io.dbx.ssh`、`com.yiqiui.leetcode-cn`、`io.github.summery-yk.portainer`）；hello-workbench 有自定义 workbench 指针；Excalidraw 有 workbench 贡献点 | 实战验证过 |
| `connection-provider` | 只有 hello-workbench 是"可保存的非 SQL 连接 + 完整生命周期"的**唯一**工作示例；连接生命周期方法名常量在宿主侧固定 | 有示例，商店侧无法从 catalog 反推 |
| `result-view` | 只有 Excalidraw 一家，且是本仓库新加的能力；依赖宿主提交 `4f3be8ccf`（2026-09-20）才能正确解析，`engines.dbx` 未抬高 | **新**，唯一使用者在宿主门槛之下 |
| `context-menu` | 三个仓库无一使用；`menu` 枚举为 `"connection" \| "table"`（table 自 2026-09-22） | schema 有、实现有两个表面、**仍无人用** |
| `proxy_route` | Kafka 插件的 release notes 明确记录从 bootstrap-only 改为共用 SOCKS5 dialer | 有生产使用，但 catalog 无法表达，只能从 release notes 追溯 |

### 9.6 未被任何已发布插件使用的能力

这是本章最有价值的一节：schema 里定义、宿主里有实现、但在本次普查范围内**没有任何已发布插件消费**的能力。把它当作"未证明的能力"清单——用它们不是错，但你是第一个。

| 能力 | 类型 | 定义/实现位置 | 状态与证据 |
|---|---|---|---|
| `context-menu` 贡献点 | 贡献点（`menu: "connection" \| "table"`） | `dbx/plugins/manifest.schema.json:321-328` | Excalidraw、hello-workbench、17 个商店插件**无一**声明。商店插件的商店元数据本身也装不下贡献点。按**已实现但未经现场验证**对待 |
| 对应派发方法 `contextMenu/<id>` | host->plugin JSON-RPC | `dbx/plugins/README.md:446` | 文档与宿主实现都在（现在有 connection 与 table 两个表面），但没有任何插件声明该贡献点，所以这条路径**没有一个已发布调用方**。GAP：零消费者 |
| filesystem capability `mkdir` | 声明式 capability | 能力清单 `dbx/plugins/README.md:474`；门禁 `README.md:501` | 本次普查中**没有**任何插件请求它：hello-workbench 只声明 `"capabilities": ["read"]`（`manifest.json:100`），Excalidraw 声明其余四个并在运行时拒绝建目录。**更正**：原文把 `mkdir` 门禁锚到 `README.md:495` 是错的——495 行只记录 `filesystem/createDirectory` 的请求参数；门禁在 `README.md:501`，能力清单（含 `mkdir`）在 `README.md:449`。**补充（2026-09-21 复核，比"无插件请求"强得多）**：宿主侧根本**没有入口**调用它，而且不止 `mkdir` —— 整个桌面前端里，`createPluginFilesystemDirectory` / `writePluginFilesystemFile` / `deletePluginFilesystemEntry` / `renamePluginFilesystemEntry` 四个 mutation API 的**调用方数量都是 0**，只有 `listPluginFilesystemEntries` 与 `readPluginFilesystemFile` 各有一个调用方（`apps/desktop/src/components/plugins/PluginFileManager.vue:51,96`）。Tauri 命令（`src-tauri/src/commands/plugins.rs:420` 等）已注册、三套后端适配器（tauri/api/http）都已导出，但没有任何 UI 会触发它们。**结论：宿主的插件文件管理器目前是只读浏览 + 预览**；因此 `mkdir` 的用户价值支点不存在，`write`/`delete`/`rename` 三个 capability 同样无法从宿主 UI 触达（插件自己的 UI 若需要写盘，走的是自己的后端 RPC，例如本仓库的 `document/saveScene` 与 `export/write`）
| `host.plans:read` | manifest 权限 | `crates/dbx-plugin-runtime/src/plugins/manifest.rs:25` | **0/17** catalog 条目声明；hello-workbench 没有；Excalidraw 自 0.2.3 起在源码 manifest 声明（商店候选待签名合并，catalog 尚未计入）。需要宿主具备 plan API（运行时看 `capabilities.planApi`） |
| `host.getPlanCapabilities` / `host.explainPlan` | Host API 方法 | `pluginHostBridge.ts:957`（`estimated` 唯一 mode） | ~~GAP：无可观察消费者~~ **2026-09-23 更新：已有端到端消费者**——Excalidraw 0.2.3 的 result-view「Plan on canvas / 计划上画布」按钮（`dbx-plugin-excalidraw/frontend/src/plan.ts`）先查能力再取计划、把预估计划铺成可批注的 Excalidraw 树。双重门禁不变：manifest 权限（`pluginHostBridge.ts:392`）与运行时 `capabilities.planApi`（`pluginHostBridge.ts:251`） |
| `host.ai` / `ai.openConversation` | manifest 权限 + Host API 方法（2026-09-22 新增） | `pluginHostBridge.ts:337-343`、`apps/desktop/src/lib/ai/aiPluginConversation.ts` | 刚落地：**零消费者**（含参考插件）。宿主校验 title ≤200 字符、prompt ≤32000 字符、context ≤2 MiB 级快照；插件拿不到模型输出与配置 |
| `host.storage` | manifest 权限 | 执行点 `pluginHostBridge.ts:471` | GAP：**0/17** catalog 条目声明。Excalidraw 把全部持久状态放在 Go sidecar，hello-workbench 什么都不用。单值上限 256 KiB，key ≤256 字符（`pluginHostBridge.ts:87-89`）。注意这是替代 `localStorage` 的正解——插件 iframe 是不透明源，`localStorage` 会抛异常 |
| `host/requestUserInput` | plugin->host 方法（Host API 1.1） | `dbx/plugins/README.md:585` | 两个参考实现都不调用。错误码：`-32001` 无 UI、`-32602` 参数错、`-32601` 不支持；每个插件会话最多 4 个未决提问 |
| Host API 版本协商本身 | 握手字段 | `manifest.rs:16` | 两个参考实现都不消费版本：Excalidraw 钉 `engines.host_api: "1"`，hello-workbench 钉 `"^1.0"`。也就是说"必须按版本门禁而不是探测"这条建议在参考实现里并没有被实践 |
| `host.saveFile` / `fileTransfer.*` / `host.copy` / `host.downloadFile` | Host API 方法 | `pluginHostBridge.ts:13, :360, :411, :421, :318` | 在 Excalidraw 的桥接类型里声明为可选但**从未调用**：它的导出链路故意走 sidecar，因为沙箱会静默吞掉 `<a download>`（`export.ts:66-69`）。其他已发布插件是否调用无法从 catalog 判定 |
| `window.dbxPlugin.stream` / `sendBinary` / `onBinary` | Host API 方法 | `pluginHostBridge.ts:772` | Excalidraw 两个都不声明，改用普通 `invoke` 里的 512 KiB base64 分块（`export.ts:11`） |
| `stdio-framed` transport + `host.binary` | 传输 + 权限 | `sdk.go:100-103` | Excalidraw 与 hello-workbench 都不声明；商店侧只有 4/17 声明 `host.binary`（`com.yiqiui.leetcode-cn`、`io.dbx.files`、`io.dbx.ssh`、`io.github.t8y2.s3`），它们是这条路径的现场证据 |
| `dbx-plugin-binary` / `dbx-plugin-filedrop` / `dbx-plugin-dragstate` | 宿主事件 | `pluginHostBridge.ts:283` 邻域 | Excalidraw 四个转发事件一个不用（它没有任何后端事件）；hello-workbench 只用 `onEvent`。这三个通道在本次普查中**没有可观察消费者** |
| `host.openWorkbench` | Host API 方法 | `pluginHostBridge.ts:375` | Excalidraw 不调用（它的 HomePage 就地切视图），hello-workbench 也不调用。商店侧 6 个插件声明了 `host.workbench` 权限，但**没有一个可读到的调用点**——只有权限声明不足以证明调用。文档把 `host.openWorkbench` 描述为插件串联 workbench 的方式（`dbx/plugins/README.md`） |
| `closeTab` 快捷键消息、`host.getContext`、`notify`、`reopenConnection`、`onContext` / `onInit` | Host API 方法 / 消息 | `pluginHostBridge.ts:903-908, :333, :791, :804, :842-843` | 这些方法在插件作者文档里几乎没有体系化记载（`closeTab` 消息**只**能从注入 SDK 源码读出），Excalidraw 与 hello-workbench 均不调用。商店插件是否调用无法判定——这里的数据是薄的，不要把它们当成"已废弃"。其中 `host.getContext` 恰是官方 CLI 模板实际教授的读 context 惯用法（`dbx/plugins/GETTING_STARTED.zh-CN.md:137`），`onInit`/`onContext` 也在 dev host 的 Host API 1.0 子集里（`dbx/plugins/sdk/dev-host/README.md:69`） |

关于 `host.events` 的一个计数更正也放在这里，因为它直接影响"哪些插件会被投递事件"的判断：采纳数是 **8/17**，不是 9/17。这 8 个正好是 `com.jettech.httpclient`、`io.dbx.files`、`io.dbx.k8s`、`io.dbx.kafka`、`io.dbx.ldap`、`io.dbx.ssh`、`io.github.mugongliu1.terminal`、`io.github.t8y2.s3`——原文末尾那个"plus t8y2/s3"把已经在列表里的插件重复计了一次。`host.events` 仍是商店里采纳最广的权限：`forwardEvent` 在插件未声明它时直接 return（`pluginHostBridge.ts:282`）。唯一的例外是 `host.download.progress`，它由桥接自己合成，不走 `forwardEvent`，因此**无需** `host.events` 就能到达插件（见 9.1.7）。

`host.network` 的采纳面同样很窄：17 个商店插件里只有 `com.yiqiui.leetcode-cn` 声明 `host.network:https://leetcode.cn`（`dbx-store/plugins/com.yiqiui.leetcode-cn.json:16`）。它是给插件沙箱 CSP 的 `connect-src` 加白名单（`pluginHostBridge.ts:548`），**明确不是**原生 sidecar 防火墙——插件后端自己做网络请求不受它约束。上限 8 条，解析规则同样镜像在 `crates/dbx-plugin-runtime/src/plugins/manifest.rs:29` 与 `:42`。

## 10. 限制、坑与版本门槛

### (a) 尺寸上限

| 常量 | 值 | 作用域 | 锚点 |
| --- | --- | --- | --- |
| `MAX_PLUGIN_PACKAGE_BYTES` | 512 MiB | 宿主安装校验（`installer.rs:367`、`:404`）与市场下载（`marketplace.rs:433`） | `dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:22` |
| `MAX_PACKAGE_BYTES` | 512 MiB | 打包器写包时（同一数值，独立常量） | `dbx/plugins/sdk/packager/src/main.rs:13` |
| `MAX_UNCOMPRESSED_BYTES` | 1 GiB | 解压总量上限（打包器与安装器各一份） | `dbx/plugins/sdk/packager/src/main.rs:14`、`dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:23` |
| `MAX_FILE_BYTES` | 256 MiB | 包内单文件上限 | `dbx/plugins/sdk/packager/src/main.rs:15` |
| `MAX_ARCHIVE_ENTRIES` | 10 000 | 包内条目数上限 | `dbx/plugins/sdk/packager/src/main.rs:16` |
| `MAX_PLUGIN_CATALOG_BYTES` | 4 MiB | 市场目录文档下载与校验 | `dbx/crates/dbx-plugin-runtime/src/plugins/marketplace.rs:25` |
| 商店仓库单文件 | 1 MiB | `dbx-store` 内任何文件（含目录 JSON） | `dbx-store/scripts/validate.mjs:311` |
| 商店候选 artifact 尺寸 | 1 B … 512 MiB | 每个 target 条目 | `dbx-store/scripts/validate.mjs:208` |
| `MAX_JSON_MESSAGE_BYTES` | 8 MiB | 宿主**写出**的 JSON 帧；超限在写之前就报 `Plugin JSON message exceeds {n} bytes` | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:43` |
| `MAX_BINARY_MESSAGE_BYTES` | 64 MiB | 二进制帧载荷上限 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:44` |
| `MAX_JSON_LINE_BYTES` | 64 MiB（= `MAX_BINARY_MESSAGE_BYTES`） | `stdio-jsonl` 的**读入**行上限，故意比写出的 8 MiB 宽（为宽 Oracle/JDBC 页） | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:51` |
| framed 二进制帧读上限 | `MAX_BINARY_MESSAGE_BYTES + 1024` | 多出的 1024 字节是给 `u16` channel 前缀留的 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:942` |
| `MAX_BRIDGE_PAYLOAD_BYTES` | 2 MiB | UI→宿主 bridge 的普通请求（含 base64 参数，base64 形态另有 2×该值字符的上限） | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:9`、base64 判定 `:1015` |
| `MAX_BRIDGE_BINARY_BYTES` | 8 MiB | bridge 二进制帧（`sendBinary`、`writeFileChunk`） | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:10`、`:350`、`:445` |
| `MAX_BRIDGE_SAVE_BYTES` | 512 MiB | `saveFile` 整包字节数（不走 sidecar 帧，直接从 iframe 落盘） | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:13`、`:401` |
| `PLUGIN_SAVE_CHUNK_BYTES` | 1 MiB | `fileTransfer` 保存路径的分块粒度 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:80` |
| `MAX_PLUGIN_WORKBENCH_CONTEXT_BYTES` | 2 MiB | workbench/result-view context 序列化上限（与 `MAX_BRIDGE_PAYLOAD_BYTES` 同值但独立常量、独立检查） | `dbx/apps/desktop/src/lib/plugins/pluginData.ts:3`、`:22-23` |
| `MAX_PLUGIN_STORAGE_VALUE_BYTES` | 256 KiB | `host.storage` 单值 | `dbx/src-tauri/src/commands/plugin_storage.rs:28`、`pluginHostBridge.ts:87` |
| `MAX_PLUGIN_STORAGE_TOTAL_BYTES` | 1 MiB | `host.storage` 整库 | `dbx/src-tauri/src/commands/plugin_storage.rs:30` |
| `MAX_PLUGIN_STORAGE_KEYS` | 1024 | key 数上限 | `dbx/src-tauri/src/commands/plugin_storage.rs:32` |
| `MAX_PLUGIN_STORAGE_KEY_CHARS` | 256 | key 字符串长度 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:89` |
| `MAX_CHUNK_BYTES` | 8 MiB | 原生文件句柄单次读写（`plugin_file_write` 用 `×4/3+4` 估算 base64） | `dbx/src-tauri/src/commands/plugin_file.rs:26`、`:209` |
| `MAX_OPEN_HANDLES` | 64 | 同时打开的原生文件句柄数 | `dbx/src-tauri/src/commands/plugin_file.rs:32` |
| `MAX_PLUGIN_FILESYSTEM_PAGE_SIZE` | 1000（默认 200） | `filesystem/list` 的 `limit` | `dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:14-15` |
| `MAX_PLUGIN_FILESYSTEM_PREVIEW_BYTES` | 4 MiB（默认 256 KiB） | `filesystem/read` 的 `maxBytes` | `dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:16-17` |
| `MAX_PLUGIN_FILESYSTEM_INLINE_WRITE_BYTES` | 4 MiB | `filesystem/write` 的内联 base64 负载 | `dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:18` |
| `MAX_PLUGIN_PLAN_BYTES` | 4 MiB | `host.explainPlan` 序列化后的 `rawPlan`（超限截断并置 `truncated`） | `dbx/crates/dbx-core/src/query/plugin_plan.rs:46`、前端同值 `dbx/apps/desktop/src/types/pluginPlan.ts:23` |
| `PLUGIN_PLAN_MAX_ROWS` | 20 000 | 计划行数上限 | `dbx/crates/dbx-core/src/query/plugin_plan.rs:55` |
| `MAX_PLUGIN_PLAN_SQL_CHARS` | 200 000 | `explainPlan` 的 `sql` 长度 | `dbx/crates/dbx-core/src/query/plugin_plan.rs:49` |
| `MAX_PLUGIN_PLAN_NAME_CHARS` | 256 | `connectionId` / `database` / `schema` 名字长度 | `dbx/crates/dbx-core/src/query/plugin_plan.rs:51` |
| `MAX_PLUGIN_NETWORK_ORIGINS` | 8 | `host.network:` 条目数（数组内重复也会被拒） | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:29`、`:848-853` |
| `MAX_PLUGIN_FIELD_CONDITION_DEPTH` / `_NODES` | 8 / 64 | `visible_when` / `required_when` 表达式树 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:32-33` |
| `MAX_PLUGIN_PICKER_FILTERS` | 16 | picker 的 `accept` 过滤器数 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:36` |
| `USER_INPUT_MAX_PROMPT_CHARS` / `_TITLE_CHARS` / `_DEFAULT_CHARS` / `_OPTIONS` / `_OPTION_CHARS` | 2000 / 200 / 1000 / 8 / 200 | `host/requestUserInput` 参数边界 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:38-42` |
| result-view 快照行数 | ≤ 500 行 | 超出置 `truncated: true`，插件必须回后端重查全量 | `dbx/apps/desktop/src/components/layout/ContentArea.vue:1063-1072`；文档 `dbx/plugins/README.md:431` |
| 导出名长度 | ≤ 160 runes | 参考插件的 `export/write` 约定 | `dbx-plugin-excalidraw/README.md:286` |
| dev host 单流缓冲 | 16 MiB `writableLength` 后销毁流 | 仅开发宿主 | `dbx/plugins/sdk/dev-host/server.mjs:141` |

两个容易踩的组合上限：**UI 路径的写入上限是宿主上限的一半** —— `filesystem/write` 宿主允许 4 MiB，但凡经过沙箱 UI 走的请求先被 `MAX_BRIDGE_PAYLOAD_BYTES = 2 MiB` 卡住（`pluginHostBridge.ts:9` / `:1028` vs `filesystem.rs:18`）。参考插件为此把图片资产从 scene JSON 里剥出来，走 2 MiB 级 base64 分块（`dbx-plugin-excalidraw/backend/main.go:18`、`:229`）。

### (b) 超时与并发

| 项 | 值 | 锚点 |
| --- | --- | --- |
| `PLUGIN_REQUEST_TIMEOUT`（RPC 默认） | 30 s | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:22` |
| `connectionAction.timeout_ms` | 1 … 120000 ms（缺省回落 30 s） | schema `dbx/plugins/manifest.schema.json:303`；应用点 `dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:313` |
| `connection/connect` 截止时间 | `plugin_timeout` 或连接配置的 `effective_connect_timeout_secs()`，再 `clamp(1, 300)` 秒 | `dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:438-444` |
| `filesystem/*` RPC | 30 s | `dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:203`、`:313` |
| `filesystem/download/open｜read` | 120 s；`filesystem/download/close` 10 s | `dbx/src-tauri/src/commands/plugin_download.rs:79`、`:88`、`:122` |
| `mcp/tools` | 30 s | `dbx/crates/dbx-mcp/src/backend.rs:742` |
| `mcp/call` | 300 s 默认；桌面 MCP 桥 `clamp(1000, 600000)` ms | `dbx/crates/dbx-mcp/src/backend.rs:782`；`dbx/src-tauri/src/commands/mcp_bridge.rs:1415` |
| UI 侧 `options.timeoutMs` | 钳到 1 … 120 000 ms | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:930`；`dbx/src-tauri/src/commands/plugins.rs:320` |
| `host/requestUserInput` 超时 | 默认 300 s，`clamp(5, 600)` 秒 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:35-37`、`:865` |
| `MAX_PROMPT_PAUSE` | 请求被弹窗暂停的累计总时长 600 s，超时即失败 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:34`、`:474-479` |
| `MAX_PLUGIN_PROMPTS_IN_FLIGHT` | 4 个并发提示；第 5 个返回 `-32002`。**更正**：本节本行原文写 `-32001` 是错的，两个码在源码里各占一行：`-32002` = "Plugin already has 4 input prompts open"（`:717-720`），`-32001` = "The DBX host cannot ask the user for input right now"（`:731`）。§4.10 与 §5.9 那两行是对的 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:32`、`:716-720` |
| `MAX_PLUGIN_PLAN_TIMEOUT_MS` | 60 000 ms 上限（取连接超时的毫秒数与该值的最小值） | `dbx/crates/dbx-core/src/query/plugin_plan.rs:44`、`:516` |
| Rust SDK 默认调用超时 | 330 s | `dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:20` |
| Rust SDK worker 池 | `available_parallelism` 钳到 2 … 16 | `dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:652` |
| `host.downloadFile` 并发 | 每 bridge 最多 2 路，且 `downloadId` 不得重复 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:319` |
| 会话级广播容量 | 事件 256 / 二进制 64 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:225-226` |
| 宿主级广播容量 | 事件 512 / 二进制 128 | `dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:85-86` |
| 计划 API 的另一门槛 | `analyze` 恒为 `None`（只估不跑） | `dbx/crates/dbx-core/src/query/plugin_plan.rs:227` |

### (c) 协议版本与能力门槛

| 门槛 | 取值 / 语义 | 锚点 |
| --- | --- | --- |
| `manifest_version` | `const 1`；v0 是只读 legacy（JDBC 迁移用），`.dbxp` 包一律拒绝 v0 | `dbx/plugins/manifest.schema.json:10`；`dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:471-472` |
| `SUPPORTED_PLUGIN_MANIFEST_VERSION` | `1` | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:15` 附近常量区 |
| `engines.host_api` | v1 **必填**（空串即报 `Manifest v1 plugins must declare engines.host_api`）；宿主广告版本 `1.2.0`；已安装宿主版本为空时跳过该检查（`#9595`） | `dbx/plugins/manifest.schema.json:22`；`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:16`、`:817-827`、`:1019-1021` |
| Host API 递增历史 | 1.0 基线；1.1 加 `host/requestUserInput`；1.2 加 plan API（`host.getPlanCapabilities` / `host.explainPlan`） | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:10-15` |
| plan API 的版本要求 | `engines.host_api: "^1.2"` 且运行时广告 `capabilities.planApi` | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:1646`（同测试在 `:1629-1631` 拒绝 `>=1.3.0` 与 `^2.0`） |
| `SUPPORTED_PLUGIN_PROTOCOL_VERSION` | `1`；`protocol_versions` 必须包含它，否则后端被拒 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:19`、`:866-871` |
| 握手版本不匹配 | 会话直接失败（SDK 侧镜像为 `-32001`） | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:385` |
| `engines.dbx` | 模板统一写 `>=0.5.68`；独立 MCP/CLI 宿主路径用空版本号来**跳过**该检查 | `dbx/plugins/sdk/cli/templates/common/manifest.json:25` 附近；`dbx/crates/dbx-mcp/src/backend.rs:686-688` |
| manifest v0 专属 | `executable` / `protocol_version` / `drivers` 三件套（`drivers` 支撑上表那 17 个 driver 方法），且 v0 被强制走 `stdio-jsonl`、容忍 banner 行 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:742`、`:746-755`、`:802`；`dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:916-925` |
| v1 互斥硬闸 | v1 manifest 使用 `executable`/`drivers` 或覆盖 `protocol_version` 会报 `Manifest v1 cannot use legacy executable or drivers fields` | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:802-810` |
| `BRIDGE_VERSION` | `1`（postMessage 信封版本） | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:8` |
| 市场目录版本 | `SUPPORTED_PLUGIN_CATALOG_VERSION = 1`，不匹配即拒绝整份目录 | `dbx/crates/dbx-plugin-runtime/src/plugins/marketplace.rs:22`、`:594` |
| SDK 协议常量 | Rust `PROTOCOL_VERSION = 1`；Go `ProtocolVersion = 1` | `dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:11`；`dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:15-19` |
| **result-view 宿主版本门槛** | README 明确要求宿主包含提交 `4f3be8ccf`（2026-09-20）；此前宿主上工具栏按钮会打开一个报 `workbenchUnavailable` 的标签页；**`engines.dbx` 故意不抬高** | `dbx-plugin-excalidraw/README.md:44`、`:133`；解析实现 `dbx/apps/desktop/src/lib/plugins/frontendPlugin.ts:77-83`；错误面 `dbx/apps/desktop/src/components/plugins/PluginWorkbenchTab.vue:49` |
| result-view 门槛的形态 | **宿主里不存在任何版本号字符串闸门** —— 可用性纯粹是这次解析改动的发版时序。README 给的是 commit hash，不是版本号（见第 11 节） | `dbx/apps/desktop/src/lib/plugins/frontendPlugin.ts:77-83` |
| Windows 启动器特例 | 同名 `.bat` 优先于无扩展名的启动器 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:967-982` |
| 版本唯一性 | 同一 `(id, version)` 重复安装被拒；`LocalDevelopment` 策略绕过该检查 | `dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:526`、`:502` |

### (d) 实现与文档不一致

以下每条都是审计中实测到的 README / mdx / schema 与代码的偏差，逐条给出代码锚点。

| 论断 | 文档怎么说 | 代码怎么说 | 代码锚点 |
| --- | --- | --- | --- |
| `plugin/initialize` 示例版本 | README 示例写 `"hostApiVersion": "1.0.0"`，且 `:597-608` 的示例块**没有 `features` 键** | 实际广告 `1.2.0` 并在消息里带 `features: SUPPORTED_PLUGIN_HOST_FEATURES` | `dbx/plugins/README.md:625` vs `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:16`、`dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:377` |
| `host.features` 起始版本 | README:585 与 mdx:203 说"1.1.0 或更晚"才广告 `host.requestUserInput` | 常量是 `1.2.0`，文档落后两个 additive bump | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:16` |
| 单条 JSON 消息上限 | README 说"A single JSON message is limited to 8 MiB" | `stdio-jsonl` 的**行读**上限是 64 MiB（写仍为 8 MiB），且注释说明这是为宽 Oracle/JDBC 页专门放宽的 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:45-51` |
| `context-menu` 派发方 | README 写得像宿主驱动 | 调用点是前端拼字符串后走 `invoke_plugin`（connection 与 table 各一处），而该命令的 `required_permission` 硬编码 `None` | `dbx/apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue:6749`；`dbx/src-tauri/src/commands/plugins.rs:322` |
| 第四种贡献点的名字 | mdx:92 写作 `connection-menu` | 实际类型名是 `context-menu`（`menu` 的取值才是 `connection`） | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:235`；`dbx/plugins/manifest.schema.json:328` |
| result-view 的适用范围 | mdx:218 说"注册 query 或 task 结果视图" | 只接了查询结果；没有任何 task 结果面消费 `listResultViews()` | `dbx/apps/desktop/src/components/layout/ContentArea.vue:1056-1074` |
| result-view 是否开箱可用 | README:416-430 表现为装完即用，无版本提示 | 解析函数此前是 `findWorkbench`；旧宿主上按钮必然打开报错标签页 | `dbx/apps/desktop/src/lib/plugins/frontendPlugin.ts:77-83` |
| `fileTransfer` 在 web 宿主 | mdx:413 说"整个命名空间在 web 宿主是 `undefined`，用前先探测" | 注入的 SDK 无条件定义 `fileTransfer`，web 宿主还给了顶层 file input / 内存缓冲 / blob 下载兜底，功能可用 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:834`；`dbx/apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:391-396` |
| 沙箱剪贴板权限 | 代码注释称"沙箱 iframe 是不透明来源、没有剪贴板权限，脚本复制全被拒" | iframe 上明确授予了 `allow="clipboard-write"` | `dbx/apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:621` vs `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:417-418` |
| `host.storage` 上限适用范围 | mdx:435 说单值 256 KiB、整库 1 MiB | 单值上限每个宿主都查；**1 MiB 整库与 1024 key 只在原生宿主与 dev host 存在**，web 兜底（逐 key localStorage）两者都不查 | `dbx/src-tauri/src/commands/plugin_storage.rs:30-32`；`dbx/plugins/sdk/dev-host/server.mjs:16`；`dbx/apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:179-196` |
| Host API 文档表覆盖度 | mdx:302-320 与 README:363-378 的 API 表 | 表里缺 `downloadFile`、`cancelDownload`、`copy`、`reopenConnection`、`stream`、`request` 的 `transfer` 选项、`encodeBase64`/`decodeBase64`；也只字未提 `stream()` 依赖 `host.events` | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:282`、`:742` |
| `host.stream.*` 文档 | mdx 与 README 完全不记录 `host.stream.chunk｜end｜error` | SDK 已实现，dev host 亦镜像，属"事实公开 API 但无生产者文档" | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:750-777`；`dbx/plugins/sdk/dev-host/browser-bridge.mjs:38-60` |
| plan API 的发起方 | `manifest.rs:11-15` 称 1.2 加了"插件发起的"plan Host API | 后端请求 dispatcher 只认 `host/requestUserInput`，其他一律 `-32601`；plan API 只在 UI 桥实现。插件后端直接调 `host/getPlanCapabilities` 只会拿到方法不存在 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:700-703`；`dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:391-401` |
| `host.filesystem` 的真实作用 | mdx:121 说"启用 filesystem entrypoints" | 它只闸 UI 的 `host.openFilesystem` 导航；所有 `filesystem/*` RPC 都以 `required_permission = None` 发起，真正的边界是 provider 声明的 capability | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:385`；`dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:170`、`:202`、`:313` |
| `host.plans:read` 的执行层 | 权限表把它列为宿主权限 | 只在渲染层校验（`:382`、`:388`）；其背后的 Tauri 命令根本不接收 plugin id，`dbx-core` 入口也看不到调用者 —— 是 UI 层约定而非宿主强制边界 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:392`；`dbx/src-tauri/src/commands/query.rs:983-997`；`dbx/crates/dbx-core/src/query/plugin_plan.rs:142`、`:164` |
| `options_action` | `manifest.schema.json` 的 `formField` 是 `additionalProperties: false` 且不含该键，README/mdx 也只字未提 | Rust 侧解析（`manifest.rs:283`）并前端消费（`PluginConnectionFields.vue:112`）都支持它 —— 用了它的 manifest **过不了 schema 校验，却能装** | `dbx/plugins/manifest.schema.json:231-247`；`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:283` |
| `fields` 的必填性 | schema 把 `fields` 列为 `connection-provider` 必填 | Rust 侧 `#[serde(default)]`，缺省即空数组，能装不能过编辑期/CI 校验 | `dbx/plugins/manifest.schema.json:271` vs `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:556-557` |
| `context-menu.menu` 的严格性 | schema 是 `enum ["connection","table"]` 且必填（2026-09-22 起从 `const "connection"` 放宽） | Rust 是 `#[serde(default)] pub menu: String`，缺省/未知值都能先解析，之后再在贡献点校验里失败；前端类型已收紧为联合 `PluginContextMenuTarget`（曾是宽松的 `menu: string`）并按等值过滤 | `dbx/plugins/manifest.schema.json:328` vs `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:663-664`、`:1133-1138`；`dbx/apps/desktop/src/lib/plugins/frontendPlugin.ts:63` |
| `connection-provider.label` 的必填性 | 前端类型声明为必填 `string`（**`dbx/apps/desktop/src/types/database.ts:401`**；校验 agent 更正：该条原锚点 `:395-396` 差两行） | schema 与 Rust 都是可选，前端运行时也按 `provider.label → plugin.name → provider.id` 回落 | `dbx/plugins/manifest.schema.json:275`；`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:549-550`；`dbx/apps/desktop/src/lib/plugins/frontendPlugin.ts:279` |
| `connection-provider` 贡献点形状 | 审计中间稿的签名漏了两个真实可选成员 | 除 `icon` 外还有 `description`（校验 agent 更正） | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:592` |
| `host.network:` 语法宽松度 | schema pattern 与前端镜像都只允许 `https://host[:port]` | 运行时解析器把第一段冒号后全当 host、只对最后一段做数字校验，`host.network:https://a.example:8443:9000` 能解析并安装；且它的注释自称"必须与 schema 对齐"，事实相反 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:48-58` vs `dbx/plugins/manifest.schema.json:34`、`dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:527` |
| `host.network` 的开发期行为 | 生产宿主把声明的 origin 写进 `connect-src` | dev host 硬编码 `connect-src 'none'`，所以依赖网络权限的插件在开发宿主里静默失败 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:548` vs `dbx/plugins/sdk/dev-host/browser-bridge.mjs:189` |
| dev host 的 Host API 级别 | dev host README:69 自称"Host API 1.0 子集"，`server.mjs:57` 也只比 `1.0.0` | 平台文档已是 1.2（`plugins/README.md:573`）并文档化了 `storage`（`:374`）—— dev host 是子集不是对等模拟器 | `dbx/plugins/sdk/dev-host/README.md:69`；`dbx/plugins/sdk/dev-host/server.mjs:57` |
| CLI 版本 pin | `RELEASING.md:68` 与可复用 workflow 默认值都写 `0.1.2` | 实际发布版本 `0.1.9`（Cargo 与 npm 包一致），生成的工程也 pin 0.1.9 | `dbx/packages/plugin-cli/package.json:3`；`dbx/plugins/sdk/cli/Cargo.toml:3`；`dbx/plugins/RELEASING.md:68`；`dbx/.github/workflows/plugin-release-reusable.yml:50` |
| CLI 自我介绍 | usage 打印 "Create, sign, and package DBX plugins" | 签名已从 CLI 移除：`create --signing-key-id`（`:363`）与 `package --key-id`（`:408`）都会报错；只剩 `keygen`，真正签名在 `dbx-plugin-packager sign` | `dbx/plugins/sdk/cli/src/lib.rs:1530`、`:363`、`:408`；`dbx/plugins/sdk/packager/src/main.rs:74` |
| 未签名包与版本不可变 | README:133 只说"未签名包需要显式开发开关" | `GETTING_STARTED.zh-CN.md:240` 又补"本地开发包可同版本重装"，与 README:129 的"已装版本不可变"表面冲突 —— 只有知道 `PluginInstallPolicy::LocalDevelopment` 例外才自洽 | `dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:502` |
| 模板里的 `executable` | `templates/common/manifest.json:16` 声明 `"executable": "bin/{{BINARY_NAME}}"` | 打包时会改写为 `bin/<target>/<binary>`；只读源模板会误判成品布局 | `dbx/plugins/sdk/cli/src/lib.rs:1025` |
| `$schema` 的 pin 策略 | 三个模板的 `$schema` 都指向会移动的 `plugin-sdk-v1` 分支 | CLI 测试又断言生成的 workflow **不得**引用 `@plugin-sdk-v1` —— 两种 pin 策略并存但文档不解释 | `dbx/plugins/sdk/cli/templates/common/manifest.json:2` vs `dbx/plugins/sdk/cli/src/lib.rs:1929` |
| 提交路径 | `RELEASING.md:93` 仍说"作者在 `t8y2/dbx-store` 开 submission Issue" | 脚手架生成的 README 已改成"直接开一个 candidate PR，不需要 Issue"，且 CLI 测试断言了新版本文案 | `dbx/plugins/sdk/cli/templates/common/README.md:30`；`dbx/plugins/sdk/cli/src/lib.rs:1912` |
| CLI usage 与模板 | `create_usage()` 未列出 `svelte` 模板 | `ProjectTemplate` 里有它 | `dbx/plugins/sdk/cli/src/lib.rs`（usage-string inconsistency） |
| 本地 manifest 闸门比平台更严 | 宿主与 schema 接受 `host.plans:read`、`host.storage`、`host.ai` | 参考插件自带的 `check-manifest.mjs` 权限白名单 0.2.3 起有 5 个（补了 plans），仍缺 `host.storage`/`host.ai`，会拒掉一个合法 manifest | `dbx-plugin-excalidraw/scripts/check-manifest.mjs:34` |
| `host_api` 示例与文档自洽性 | README:151 的 manifest 示例写 `"host_api": "^1.0"` | 同一份文档两节之后就要求 plan API 的 `^1.2` —— 示例表达不了它旁边的能力 | `dbx/plugins/README.md:151` vs `:548` |
| 目录权限一致性（参考插件实况） | 商店条目 `dbx-store/plugins/io.dbx.excalidraw.json:14` 是 `"permissions": []` | 本仓库 `dbx-plugin-excalidraw/manifest.json:15-17` 声明了 `host.workbench`、`host.filesystem`、`host.plans:read`（0.2.3 起）；安装器要求二者相等，所以保留 `[]` 的目录条目会让新版包安装失败并报 "Marketplace package permissions … do not match catalog permissions"，上架时目录条目必须同步 | `dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:839` |
| 视频方向标注（审计自身更正） | 中间稿把 `list_plugins` 等一整套命令标为 `host->plugin` | 它们是 `#[tauri::command]`，由 DBX 桌面前端经 IPC 调用，方向是 `ui->host`（host-backend）；`host->plugin` 在目录里专指 sidecar JSON-RPC。`install_plugin_package_from_url` 被标 `host->ui` 同样是误标 —— 它是 `ui->host` 命令，只是顺带发一个 `host->ui` 进度事件 | `dbx/src-tauri/src/commands/plugins.rs:23` 起 |

### (e) 其他已知坑

| 坑 | 说明 | 锚点 |
| --- | --- | --- |
| 广播会静默丢事件 | 全链路有**三个不同容量的环**：会话 256/64、宿主 512/128。`send()` 的失败被忽略，无订阅者时帧直接消失；两级转发意味着一个事件可能经历两次独立的 lag 窗口。宿主级 lag 会打日志 `Plugin host event relay skipped {skipped} events` | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:225-226`、`:651`、`:674`；`dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:85`、`:392`、`:408` |
| web 端连 lag 通知都吞掉 | SSE 路由显式建模 `{kind:"lagged", skipped}`，TS 联合类型也声明了，但处理器只处理 `event`/`binary` —— 丢事件在 web 客户端完全无感，原生端至少还打日志 | `dbx/crates/dbx-web/src/routes/plugins.rs:571`、`:580`；`dbx/apps/desktop/src/lib/backend/http.ts:709-710` |
| web SSE 事件流不做任何过滤 | 该路由直接订宿主级广播并把每个事件与二进制帧（base64）序列化出去，**没有按插件或按权限过滤**，与 iframe 路径按 `pluginId + host.events/host.binary` 过滤的行为不同 | `dbx/crates/dbx-web/src/routes/plugins.rs:564`、`:575-578`；`dbx/crates/dbx-web/src/main.rs:433` |
| JSONL 单行限制是双刃剑 | 宿主读入容忍 64 MiB 行，但 `stdio-jsonl` 插件**没有二进制逃生通道**（二进制必须 `stdio-framed`，否则 `send_binary` 直接报错）；一行超限就整轮读循环失败、用户查询报错 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:45-51`、`:333` |
| SDK 之间常量分歧（一）：名字语法 | 宿主要求 `[A-Za-z0-9._:/-]`；Rust SDK 只拒空/超 256/含空白；Go SDK 还禁止首字符是标点。**Rust 侧本地通过的名字可能被宿主中途拒绝**；反向地，Go 插件永远发不出宿主本可接受的首字符标点名字 | 宿主 `runtime.rs:1025`；Rust `dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:675`；Go `dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:400` |
| SDK 之间常量分歧（二）：二进制帧上限 | 宿主 `MAX_BINARY_MESSAGE_BYTES + 1024`；Rust SDK `MAX_BINARY_BYTES + 1024`；Go SDK `maxBinaryBytes + 2 + 256`。三者相差 768 字节，一个落在 (64 MiB+1024, 64 MiB+1298] 的帧 Go SDK 收下、宿主拒收。宿主还把未知 frame kind 当致命错误 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:942`；`dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:513`；`dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:264` |
| SDK 之间常量分歧（三）：JSONL 读上限 | Go SDK 的输入扫描器封顶 `maxJSONBytes = 8 MiB`，于是它既读不了宿主愿意写出的 8 MiB 消息，也吃不下宿主行读限容忍的 64 MiB 行 | `dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:202`；对照 `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:51` |
| 未签名包的限制 | `PluginInstallPolicy::LocalSigned` 下缺 `signature.json` 即失败；`LocalDevelopment`（`allow_unsigned = true`）才放行并记为 `Unsigned`，且同时跳过更新连续性检查与重复安装检查。`sign` 还要求候选包"干净未签名"（无目录项、无重复、无符号链接、无既有 `signature.json`） | `dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:811-812`、`:34`、`:502`；`dbx/src-tauri/src/commands/plugins.rs:195`；`dbx/plugins/sdk/packager/src/main.rs:316`、`:348` |
| 信任与撤销不对称 | 宿主内置两把官方锚（`dbx-store-preview-2026` / `dbx-store-release-2026`），用户在文件里加 key 时若 id 撞上内置 id 但字节不同即被拒；但**撤销只是商店侧闸门**（`dbx-store/scripts/validate.mjs:98`），宿主不查撤销列表 | `dbx/crates/dbx-plugin-runtime/src/plugins/marketplace.rs:32-35`、`:772-780`（合并逻辑） |
| 宿主权限闸存在但从未生效 | `ensure_permission` 已接线，但仓内**所有**调用点传的都是 `None`（UI 的 `backend.invoke`、下载、MCP 桥、整个 `filesystem.rs`） | `dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:158`、`:171`、`:184`、`:810`；`dbx/src-tauri/src/commands/plugins.rs:322` |
| 默认免闸面很宽 | `backend.invoke`/`notify`、`host.getContext`、`ui.readAsset`、`downloadFile`/`cancelDownload`、`saveFile`、`copy`、`pickFiles`/`readFileChunk`、`beginFileSave`/`writeFileChunk`/`finishFileSave`/`closeFileHandle`、`reopenConnection` 全都不过 `requirePermission`。文件读写之所以放行，理由是"字节只在用户于原生对话框选过文件后才流动"；`reopenConnection` 不按权限但按归属校验 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:426`；归属校验 `dbx/apps/desktop/src/stores/connectionStore.ts:4749` |
| 会话状态只能拉、不能推 | `subscribe_status()` 已定义但仓内无调用者；唯一面向 UI 的面是 `list_active_plugins`，而前端 wrapper `listActivePlugins`/`activatePlugin`/`stopPlugin` 在 `apps/desktop` 里零调用点 —— "插件崩了"永远不会异步反映到 UI | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:289`；`dbx/apps/desktop/src/lib/backend/tauri.ts:2450-2458` |
| 卸载不会通知已打开的标签页 | 安装/回滚会发 `plugin-runtime-replaced` 让工作台重载，但 `uninstall_plugin` 什么都不发，已开的标签页会继续渲染一个后端已消失的 UI | `dbx/src-tauri/src/commands/plugins.rs:127`、`:204`、`:232`、`:251` vs `:255-291` |
| `filesystem/stream/close` 是空头默认值 | 它只作为 SDK `stream()` 的默认 `closeMethod` 出现在注入代码里；参考插件没有实现该 handler，所以取消流会变成 `MethodNotFound` | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:742` |
| 会话状态字段用 snake_case | 同文件其他结构体都是 camelCase，只有 `PluginSessionState` 是 `rename_all = "snake_case"`（`starting`/`running`/`stopping`/`stopped`/`exited`），手写客户端极易写错。也没有 `error` 状态：启动失败返回 Err，崩溃落在 `exited` 上带消息 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:73`；前端镜像 `dbx/apps/desktop/src/types/database.ts:665` |
| 协议级错误是致命的 | 插件输出一个既无 `id` 又无 `method` 的 JSON 消息，读循环就整个返回 Err：fail_pending 排空所有在途请求、关闭提示、必要时杀进程 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:654`、`:550-567`、`:601` |
| `jsonrpc` 字段强制 | 非 legacy 插件必须发 `"2.0"`，否则整个读循环报错 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:612-615` |
| 权限回显 ≠ 权限校验 | `plugin/initialize` 会把 manifest 的 `permissions` 原样回显给插件，但接受检查只比对 `protocol_version` 与插件 id/version，**权限在那里从不复核** | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:380`、`:385-396` |
| sidecar 不受网络/文件沙箱约束 | 只有 UI 侧有 CSP 与权限闸；原生进程的文件系统与网络访问目前无法被 DBX 完全中介（官方文档明说），全仓 grep `sandbox\|seccomp\|firewall\|restrict` 只命中关于 UI CSP 的注释 | `dbx/plugins/README.md:695` |
| 插件连接不能跑 SQL | 池分派对 `PoolKind::PluginConnection` 一律返回 `SQL execution is not supported for plugin connections` | `dbx/crates/dbx-core/src/query/mod.rs:2229` |
| MCP 对插件 SQL 的拒绝来得太晚 | MCP 桥在 `execute` 上用 `supports_sql_query(db_type)` 预筛，但 `dbx-sql` 的排除表里没有 `DatabaseType::Plugin`，所以预筛通过，错误从执行深处冒出来 | `dbx/src-tauri/src/commands/mcp_bridge.rs:1571-1578`；`dbx/crates/dbx-sql/src/query_execution_sql.rs:196-212` |
| 生命周期锁会挡住更新 | 每个宿主操作都取一个 usage guard，活着的插件连接持有它：有活跃连接时更新被拒并点名那条连接 | `dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:119` |
| 桌面与 web 的缓存策略不一致 | 同一份 `read_ui_asset`，桌面用 `cache-control: no-store`（"绝不让过期分片活得比这次安装久"），web 路由用 `no-cache` —— 替换过的插件仍可能把旧分块交给会重校验的 web 客户端 | `dbx/src-tauri/src/plugin_ui_protocol.rs:100-101` vs `dbx/crates/dbx-web/src/routes/plugins.rs:626` |
| 用户侧的权限可见性极低 | 安装 UI 只显示一个权限**数量**徽章；唯一的另一个用户可见权限产物是安装期与已审核目录集合的相等性检查 | `dbx/apps/desktop/src/components/plugins/PluginContributionsPanel.vue:1026`；`dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:839` |
| `options_action` 的 schema 空白 | 用了它的 manifest 过不了 `manifest.schema.json`（`additionalProperties: false`），但宿主解析与前端消费都支持 —— 编辑期报错、安装期通过 | `dbx/plugins/manifest.schema.json:231-247`；`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:283` |

## 11. 未验证 / 存疑

以下结论本次审计无法从源码闭环确证，逐条说明存疑理由。

1. **result-view 的"0.6.18"版本号本身不可验证。** README 只给提交号 `4f3be8ccf`（2026-09-20）与"该修复之后的构建"这一条件，宿主代码里**不存在任何版本号字符串闸门**，可用性纯粹是发版时序（`dbx/apps/desktop/src/lib/plugins/frontendPlugin.ts:77-83`、`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:16` 附近无相关常量）。"0.6.18"这个数字只出现在用户记忆（`result-view-host-version-gate.md`）与插件 README 的口径里，本次审计未能用源码把版本号钉死。同时，用户记忆里"已决定保留并接受、勿改插件代码"这一处置决定同样没有代码锚点 —— 它只是决策记录，不是可验证事实。
2. **`host.plans:read` 与 `host.storage` 在已发布插件里没有使用者。** 17 个目录条目里 0 个声明它们，hello-workbench 不用；Excalidraw 自 0.2.3 起声明 `host.plans:read` 并把 plan API 用了起来（商店候选待合并，见 9.6 节更新），`host.storage` 仍然无人用（`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:25`、`dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:392`）。对 0.2.3 之前的已发布字节而言，"有没有人用"仍只有 0/17 这个否定证据。
3. **`context-menu` 派发只有两个调用点（同一文件）。** 全仓命中的是前端拼串的 connection 与 table 两条路径（`dbx/apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue:6749` 附近），参考插件的 `context-menu` 贡献点是"声明了但没用"（`dbx-plugin-excalidraw` 的 manifest），所以该路径的端到端可用性仍没有仓内消费者证据。
4. **MCP 插件桥的 HTTP 路由只有仓外调用者。** `POST /call-plugin-tool`、`POST /list-plugin-connections` 定义在桌面壳里（`dbx/src-tauri/src/commands/mcp_bridge.rs:235-238`），但仓内没有客户端调用它们；另一处提到 `mcp/call` 的地方是 `dbx/crates/dbx-mcp/src/backend.rs:782`，走的是进程内直调而非该 HTTP 端口。这两个路由的实际使用情况取决于仓外的独立 agent，本仓库无从验证。
5. **`mcp/tools` / `mcp/call` 在 `plugins/README.md` 里没有任何记载。** 它们的形状、超时、`lifecycle` 参数都只能从 Rust 侧读出（`dbx/crates/dbx-mcp/src/backend.rs:742`、`:782`），没有面向插件作者的文档可交叉印证。
6. **`host.openWorkbench` 无使用者。** 两个参考插件都不调它（Excalidraw 的 HomePage 原地切视图，hello-workbench 不用），"链式打开工作台"这一用法只有文档（`dbx/plugins/README.md`）支撑。
7. **`filesystem-provider` 的 `mkdir` capability 无发货消费者。** 闸门值是真的（文档在 `dbx/plugins/README.md:501`，取值表在 `:449`；**校验 agent 更正：原稿引的 `:495` 只记录 `filesystem/createDirectory` 的请求参数，不是 capability 闸门**），但找不到实际声明 `mkdir` 的插件。
8. **商店侧的 `verified` 与 publisher 状态。** 全部 17 个目录条目 `verified: false`，而 `publishers/t8y2.json`、`publishers/dbx.json` 的 `status` 是 `"verified"` —— 这条只能证明"两份文件不一致"，无法证明哪个是设计意图；`finalize-candidates.mjs:67` 硬编码 `false`，validator 的字段白名单又排除该字段，所以从提交路径上根本设不了（`dbx-store/scripts/validate.mjs:150-153`）。
9. **`proxy_route` 的生产使用只有商店 JSON 一条中文 release note 佐证。** 目录 schema 表达不了它，宿主侧代码（`dbx/crates/dbx-core/src/connection/mod.rs:3363-3366`、`dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:202-207`）能证明机制存在，但"哪个插件在用"只有商店文本（`dbx-store/plugins/io.dbx.kafka.json:110`）这一份非代码证据。
10. **商店目录缺少贡献点类型记录。** 目录 schema 的字段白名单里没有 contribution 类型（`dbx-store/scripts/validate.mjs:80`），PR 模板只在自由文本里问（`dbx-store/.github/PULL_REQUEST_TEMPLATE.md:20`）且不落库。因此"哪些贡献点类型经过实战"这类统计从目录里**无法回答**，本次审计也无法给出。
11. **`secret` 输入语义没有实现。** 运行时测试夹具发 `{"prompt":..., "secret": true, "echo": true}`（`dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:1558-1567`），而 `UserInputSpec::parse` 只认 `prompt`/`title`/`default`/`echo`/`options`/`timeoutSecs`（`:804-871`）；未知键被接受并忽略。Rust SDK 里确有 `UserInputPrompt::secret()` 构造器（`dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:194`），但它在协议层到底映射成哪个字段、遮蔽语义由谁执行，本次审计没能闭环 —— 照抄测试夹具的插件会**静默丢掉**遮蔽语义。
12. **`dbx-cli` 没有插件面**这条是"不存在"证明（`dbx/crates/dbx-cli/src/main.rs:3-12` 的 import 列表里没有任何插件模块）。"不存在"类结论天然只能靠 grep 零命中，永远弱于正面证据。
13. **`PluginHost` 的权限闸"接了线但没用"** 同样是全仓 grep 得出的（所有调用点传 `None`）。若仓外还有别的 `invoke` 调用者（比如某个未纳入审计树的 crate），该结论会变形。
14. **`host.download.progress` 的权限归属存在内部不一致。** 它以普通 `event` 帧投递，因此能到达 `onEvent` 与 `dbx-plugin-event` 文档事件而**无需** `host.events`；而 `host.events` 条目给人的印象是"每个被转发的 event 都需要该权限"（`dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:324`、`:279`）。两者能否统一，审计未给出裁定。
15. **“哪个方向”这一属性本身在源数据里就不可靠。** 校验 agent 已更正一整套 `list_plugins` 等 Tauri 命令的方向（`host->plugin` → `ui->host`），另有多条（`host.download.progress`、`window.dbxPlugin.stream`、`install_bytes`）被标为方向误标。本次手册里凡引用方向的地方都按更正后的口径写，但同一批数据中可能还残留未被发现的误标 —— 方向字段只应作参考，真正可信的是命令是不是 `#[tauri::command]`、是不是 sidecar JSON-RPC。
16. **参考插件的商店条目与源 manifest 已经漂移。** 目录条目 `permissions: []`、`latestVersion: "0.2.0"`（`dbx-store/plugins/io.dbx.excalidraw.json:14` 及同文件版本字段）对不上本仓库 `manifest.json` 的 `["host.workbench","host.filesystem"]` / `0.2.1`。这是实况，但"下一次发版会不会失败"取决于同步脚本的实际运行结果，本次审计只能指出风险（`dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:839`），无法预测。
17. **两个 store 路径的权限来源不一致。** 自动同步路径只从 `release-candidates.json` 取三个身份字段（`dbx-store/scripts/sync-release-candidate.mjs:19-21`），手工路径则镜像 manifest（`dbx-plugin-excalidraw/scripts/make-store-candidate.mjs:85`）。发布流水线其实**已经**把 permissions 写进 `release-candidates.json`（`dbx/.github/workflows/plugin-release-reusable.yml:238`），数据存在而无人消费 —— 这是"数据存在但被忽略"的推断，不是能靠单点代码断言的事实。

## 12. 补充：安装生命周期、插件市场与插件中心

本节按 GAPS 逐项补齐，所有锚点相对各自仓库根（`dbx` = E:/work/git/github/dbx）。

### 1. 插件安装 / 更新 / 回滚 / 卸载生命周期面（原文档零锚点）

根 `dbx`，文件 `crates/dbx-plugin-runtime/src/plugins/installer.rs`、`crates/dbx-plugin-runtime/src/plugins/lifecycle.rs`。

- 安装策略确实只有两种，均为 `Local*`：`installer.rs:34` `pub enum PluginInstallPolicy {`，两个变体 `installer.rs:35-36` `LocalSigned,` / `LocalDevelopment,`。
- 未签名包的准入差异在签名校验分支：`installer.rs:810` `Err(error) if error.kind() == std::io::ErrorKind::NotFound => match policy {`，`installer.rs:811` `PluginInstallPolicy::LocalDevelopment => Ok(PluginSignatureStatus::Unsigned),`，`installer.rs:812` `PluginInstallPolicy::LocalSigned => Err("Plugin package must have a trusted Ed25519 signature".to_string()),`。行为由测试固化：`installer.rs:1552-1554` `assert!(installer.install_bytes(&unsigned, PluginInstallPolicy::LocalSigned).is_err());` … `assert_eq!(installed.signature, PluginSignatureStatus::Unsigned);`。
- 更新前置校验函数：`installer.rs:204` `pub(crate) fn ensure_update_continuity(`。降级被拒：`installer.rs:216-219` `if candidate < active && !allow {` … `"Plugin downgrade to version {candidate_version} is not allowed (installed {active_version})"`。源变更被拒：`installer.rs:226-230` `if (repository_changed || publisher_changed || key_changed) && !allow {` … `"Plugin update source change requires confirmation: the offering repository, publisher, or signing key differs from the recorded install"`。
- 该前置校验有两个调用点（下载前 pre-flight 与锁内复查）：市场侧 `marketplace.rs:418-430` `if let Some(identity) = super::installer::read_install_identity(&self.root_dir, &request.plugin_id)? {` … `ensure_update_continuity(`；安装侧 `installer.rs:501-515` `if !matches!(policy, PluginInstallPolicy::LocalDevelopment) {` … `ensure_update_continuity(`。
- 准入 `allow_source_change` 由 `PluginMarketplaceInstallRequest` 携带：`marketplace.rs:160-162` `#[serde(default)] pub allow_source_change: bool,`，字段注释 `marketplace.rs:159-160` `/// Set after the user explicitly confirmed a changed update source ...`。
- 活跃连接 / 操作期间禁止更新，错误文案为稳定契约：`lifecycle.rs:4` `const UPDATE_IN_PROGRESS: &str = "Plugin update is in progress. Please try again after it finishes.";`；`lifecycle.rs:24-32` `if !self.connections.is_empty() {` … `"Plugin update blocked by active connections: {}"` … `if self.operations > 0 { return Err(OPERATIONS_ACTIVE.to_string()); }`。文案精确值由测试断言：`lifecycle.rs:130-132` `"Plugin update blocked by active connections: Production S3"`。
- `rollback` / `uninstall` 是公开 API：`installer.rs:415` `pub fn rollback(&self, plugin_id: &str) -> Result<PluginRollbackResult, String> {`，`installer.rs:425` `pub fn uninstall(&self, plugin_id: &str) -> Result<(), String> {`（`installer.rs:430` `match std::fs::remove_dir_all(&plugin_dir) {`，目录不存在视为成功 `installer.rs:432`）。
- 回滚目标只有“新激活记录指向且目录可用”的那一个版本：`installer.rs:528-542` 在写新激活记录前过滤 `previous_version`，注释 `installer.rs:537-538` `// Never record a rollback target that cannot be rolled back to: `rollback_locked` requires versions/<version>/manifest.json to have the matching identity.`，过滤谓词 `installer.rs:541` `version_dir_is_usable(&versions_dir.join(previous), &manifest.id, previous)`；判可用性 `installer.rs:687-693` `manifest.id == plugin_id && (manifest.version == version || is_legacy_storage_version(version))`。回滚执行体 `installer.rs:622-667`，缺回滚目标时 `installer.rs:630` `"Plugin '{plugin_id}' does not have a rollback version"`。
- 版本目录保留策略只留“活跃 + 回滚目标”：`installer.rs:908-925` `prune_plugin_history`，`installer.rs:910` `std::iter::once(current.version.as_str()).chain(current.previous_version.as_deref())`。

### 2. 插件市场 / 仓库 / 目录（catalog）面（原文档零锚点）

根 `dbx`，文件 `crates/dbx-plugin-runtime/src/plugins/marketplace.rs`。

- 多仓库模型与两个内置常量：官方目录主 URL `marketplace.rs:29` `const OFFICIAL_CATALOG_URL: &str = "https://dl.dbxio.com/catalog/index.json";`，GitHub raw 回退 `marketplace.rs:30` `const OFFICIAL_CATALOG_FALLBACK_URL: &str = "https://raw.githubusercontent.com/t8y2/dbx-store/main/catalog/index.json";`。回退逻辑仅对官方仓库生效：`marketplace.rs:371` `Err(primary_error) if repository.id == OFFICIAL_PLUGIN_REPOSITORY_ID => {`，两路皆失败时合并报错 `marketplace.rs:378-380`。
- 内置两把官方签名公钥：`marketplace.rs:32-35` `const BUILTIN_OFFICIAL_TRUSTED_KEYS: &[(&str, &str)] = &[` `("dbx-store-preview-2026", ...)`、`("dbx-store-release-2026", ...)`；可由构建期环境变量追加 `marketplace.rs:31` `const ADDITIONAL_OFFICIAL_TRUSTED_KEYS_JSON: Option<&str> = option_env!("DBX_PLUGIN_MARKETPLACE_TRUSTED_KEYS_JSON");`。
- 自定义仓库落盘 `.repositories.json`，官方仓库不可改：`marketplace.rs:27` `const REPOSITORIES_FILE: &str = ".repositories.json";`；`marketplace.rs:197-204` 拒绝条件 `if repository.id == OFFICIAL_PLUGIN_REPOSITORY_ID || repository.kind == PluginRepositoryKind::Official || repository.managed {` → `return Err("Managed plugin repositories cannot be modified".to_string());`。`list()` 始终把官方仓库前置：`marketplace.rs:185-187` `let mut repositories = vec![official_repository()]; repositories.extend(document.repositories);`。
- 目录校验与相对 URL 解析：`catalog_version` 必须等于 1，`marketplace.rs:594-599` `if catalog.catalog_version != SUPPORTED_PLUGIN_CATALOG_VERSION {` … `"Unsupported plugin catalog version {}; this DBX build supports version {}"`（常量 `marketplace.rs:22` `pub const SUPPORTED_PLUGIN_CATALOG_VERSION: u32 = 1;`）；repository id 必须匹配 `marketplace.rs:600-605` `if catalog.repository.id != repository.id {` … `"does not match configured repository"`；`latestVersion` 必须存在于 versions `marketplace.rs:673-678` `if !contains_latest {` … `"Plugin '{}' latestVersion '{}' is not present in versions"`；artifact 与 icon 的相对 URL 按 catalog 基址解析 `marketplace.rs:670` `artifact.url = resolve_http_url(catalog_url, &artifact.url, "Plugin artifact URL")?.to_string();`、`marketplace.rs:679-681` `plugin.icon = Some(resolve_http_url(catalog_url, icon, "Plugin icon URL")?.to_string());`。
- artifact 目标选择：精确 `target` 优先，否则回退 `universal`，`marketplace.rs:524-528` `.find(|artifact| artifact.target == target).or_else(|| version.artifacts.iter().find(|artifact| artifact.target == UNIVERSAL_PLUGIN_TARGET))`（常量 `marketplace.rs:24` `pub const UNIVERSAL_PLUGIN_TARGET: &str = "universal";`）。测试 `marketplace.rs:948-997`。
- SHA-256 校验与尺寸校验：`marketplace.rs:720-732` `verify_artifact_bytes`，`marketplace.rs:729-730` `"Plugin artifact SHA-256 mismatch: expected {}, received {actual}"`；format 校验 `marketplace.rs:713-717` `if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {`。
- 单仓库失败隔离：`fetch_catalogs` 逐仓库返回 `{catalog | error}` 而不整体失败，`marketplace.rs:344-359`（`Ok(catalog) => PluginRepositoryCatalogResult { repository, target: current_plugin_target(), catalog: Some(catalog), error: None }` / `Err(error) => ... error: Some(error)`），聚合 `marketplace.rs:360` `futures::future::join_all(futures).await`。
- 信任域按仓库种类分流：官方仓库只用内置公钥，自定义仓库只看用户信任库，`marketplace.rs:752-761` `if kind != PluginRepositoryKind::Official { return PluginTrustStore::load(root_dir); }`；测试 `marketplace.rs:1061-1067`。

### 3. 插件中心前端操作面（原文档零锚点）

根 `dbx`，目录 `apps/desktop/src/lib/plugins/`。

- 安装深链：`pluginInstallDeepLink.ts:11-13` `Parses \`dbx://plugins/install?url=<encoded package url>\` links.`；长度上限 `pluginInstallDeepLink.ts:3-4` `MAX_DEEP_LINK_LENGTH = 4096;` / `MAX_PACKAGE_URL_LENGTH = 2048;`；入口校验 `pluginInstallDeepLink.ts:16-18` `if (!trimmed || trimmed.length > MAX_DEEP_LINK_LENGTH) return null;`；仅接受 http(s) `pluginInstallDeepLink.ts:27-28` `const protocol = new URL(packageUrl).protocol; if (protocol !== "http:" && protocol !== "https:") throw new Error("Package url must be http(s)");`；host/path 精确匹配 `pluginInstallDeepLink.ts:21`。
- 图标解析：贡献点 `icon` 优先、回退 `manifest.icon`，`pluginIconResolver.ts:22` `return (contribution && "icon" in contribution ? contribution.icon : undefined) || plugin.manifest.icon;`；对 `listPlugins` 结果做进程内单飞缓存 `pluginIconResolver.ts:4-11`（`installedPluginsPromise ||= api.listPlugins().catch(...)`），清缓存 `pluginIconResolver.ts:14-16`。
- 置顶：localStorage 键 `pluginPinning.ts:3` `const PINNED_PLUGINS_STORAGE_KEY = "dbx-plugin-pinned-ids";`（注意：键名与 gap 描述中的 `dbx-plugin-pinned-ids` 一致）；稳定分区，未知 id 被忽略，`pluginPinning.ts:29-32` `const pinnedPart = definitions.filter((definition) => pinned.has(definition.plugin.manifest.id));` … `[...pinnedPart, ...definitions.filter((definition) => !pinned.has(definition.plugin.manifest.id))]`，注释 `pluginPinning.ts:26-27` `Unknown ids in the pinned list are ignored so uninstalling a plugin leaves no phantom pins.`
- 批量操作：顺序执行、逐项记录成功失败、**不回滚**，`pluginBatch.ts:23` `export async function runBatch<T>(...)`；注释 `pluginBatch.ts:18-19` `A failing item is captured and the batch continues; nothing is rolled back.`；循环与捕获 `pluginBatch.ts:26-33`。可批量选择的状态判定 `pluginBatch.ts:48-50` `return status === "install" || status === "update";`。

### 4. 本地化（manifest `localizations`）与宿主 locale 解析规则

根 `dbx`。

- manifest 侧 schema：`crates/dbx-plugin-runtime/src/plugins/manifest.rs:90-91` `#[serde(default, skip_serializing_if = "BTreeMap::is_empty")] pub localizations: BTreeMap<String, PluginManifestLocalization>,`；结构体 `manifest.rs:184-191` `pub struct PluginManifestLocalization {`（`name` / `description` / `contributions: BTreeMap<String, PluginContributionLocalization>`）。value 形状：`manifest.rs:195-204` `PluginContributionLocalization`（`label` / `description` / `fields` / `actions`），`manifest.rs:217-226` `PluginFormFieldLocalization`（含 `options: BTreeMap<String, String>`），`manifest.rs:208-213` `PluginConnectionActionLocalization`。
- 校验拒绝非法 locale 标签与空 name：`manifest.rs:930-936` `fn validate_localizations(`，`manifest.rs:932-936` `if !valid_locale_tag(locale) { errors.push(format!("Invalid plugin localization locale '{locale}'")); }` 与 `errors.push(format!("Plugin localization '{locale}' has an empty name"));`；贡献点/字段/动作的 id 与空 label 也被拒 `manifest.rs:938-962`。
- 前端解析优先级：先 `_`→`-` 并小写，先精确整串匹配，再退语言子标签，`frontendPlugin.ts:259-263` `const normalizedLocale = locale.replace("_", "-").toLowerCase();` / `const exact = Object.entries(localizations).find(([key]) => key.replace("_", "-").toLowerCase() === normalizedLocale)?.[1];` / `const language = normalizedLocale.split("-")[0];` / `return Object.entries(localizations).find(([key]) => key.replace("_", "-").toLowerCase() === language)?.[1];`。
- 逐层本地化：插件名 `frontendPlugin.ts:271` `name: localizedRequiredText(plugin.manifest.name, localization?.name),`；贡献点 label/description `frontendPlugin.ts:282-283`；connection-provider 的 fields/actions `frontendPlugin.ts:287-292`；选项 label `frontendPlugin.ts:308` `options: field.options?.map((option) => ({ ...option, label: localizedRequiredText(option.label, localization.options?.[option.value]) })),`。
- 市场目录另有一套 `localizations`（只有 name/description）：`marketplace.rs:70-75` `pub struct PluginMarketplaceLocalization {`；字段 `marketplace.rs:126` `pub localizations: BTreeMap<String, PluginMarketplaceLocalization>,`；前端同样归一小写并先精确后语言子标签 `pluginMarketplace.ts:167-169`。

### 5. Sidecar 持久数据目录 / 配置存储面

根 `dbx`，文件 `crates/dbx-plugin-runtime/src/plugins.rs`。

- 常量与环境变量用途：`plugins.rs:127` `pub const PLUGIN_DATA_DIR_ENV: &str = "DBX_PLUGIN_DATA_DIR";`，其文档注释 `plugins.rs:123-126` `/// Environment variable that tells a plugin sidecar where to keep its` `/// persistent, version-independent local data (preferences, audit logs,` `/// known hosts, ...). Injected by the registry so plugins never have to fall` `/// back to the OS temp dir, which macOS wipes on reboot.`
- 目录布局 `<data dir>/plugin-data/<id>`，与 `plugins/` 注册根同级，因此升级/回滚不丢：`plugins.rs:187-189` `pub fn plugin_data_dir(&self, plugin_id: &str) -> PathBuf { self.root_dir.parent().unwrap_or(&self.root_dir).join("plugin-data").join(plugin_id) }`；注释 `plugins.rs:183-186` `so it survives version upgrades and never collides with the installer-managed versions/ + activations/ tree.`。测试断言 `plugins.rs:447-449` `assert_eq!(registry.plugin_data_dir("io.dbx.ssh"), PathBuf::from("/data/plugin-data/io.dbx.ssh"));`
- 环境注入：注册表在拉起 sidecar 前注入 `plugins.rs:295` `let env = env.with_plugin_data_dir(&self.plugin_data_dir(&plugin.manifest.id));`；显式覆盖让位 `plugins.rs:137-141` `pub fn with_plugin_data_dir(self, data_dir: &Path) -> Self { if self.get(PLUGIN_DATA_DIR_ENV).is_some() { return self; } ... }`；应用 `plugins.rs:148-152` `command.env(key, value);`。
- 测试断言 sidecar 确实收到该变量：`plugins.rs:526-530` `assert_eq!(PathBuf::from(reported), data_dir.path().join("plugin-data").join("sample.sidecar"), "sidecar must see <data dir>/plugin-data/<id> in DBX_PLUGIN_DATA_DIR");`；Go SDK 也暴露同一变量 `plugins/sdk/go/dbx-plugin-sdk/sdk.go:415` `const DataDirEnvVar = "DBX_PLUGIN_DATA_DIR"`。
- 更新/回滚不触碰数据目录（用户态数据在版本化容器之外）：`installer.rs:1780-1788` `let data_dir = root.path().join("plugin-data").join("sample.hello");` … `assert_eq!(std::fs::read(data_dir.join("state.json")).unwrap(), b"{\"rows\":1}");`（注释 `installer.rs:1787` `Plugin user data lives outside the versioned container and must survive update + rollback.`）。

### 6. “SDK 上限分歧”那一行的锚点必须重写（且 gap 自身对 lib.rs:675 的描述有误）

先纠正 gap 描述里的一个事实错误：原 gap 称“`lib.rs:675` 只是 `    }`、该函数从 `lib.rs:672` 开始”——不成立。`fn validate_protocol_name` 实际起始于 `lib.rs:674`，而 `lib.rs:675` 正是带 `256` 上限的判断行：`plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:674-675` `fn validate_protocol_name(value: &str) -> Result<(), PluginError> {` / `    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_whitespace) {`。`lib.rs:672` 是上游 `impl` 的闭合 `}`。因此“该行掉进了 protocol-name 校验、与消息上限无关”这一结论成立（它确实是 256 字节的协议名/通道名限制），但“675 行只是 `}`”的表述有误，应改为“675 行是协议名长度上限判断”。该函数被用于方法名与二进制通道名：`lib.rs:94` `validate_protocol_name(method)?;`、`lib.rs:106` `validate_protocol_name(channel)?;`。

Go 侧同理：`sdk.go:392` `func validProtocolName(value string) bool {`，长度上限在 `sdk.go:393` `if len(value) == 0 || len(value) > 256 {`，`sdk.go:400` 是字符白名单行 `if index > 0 && (character == '.' || character == '_' || character == ':' || character == '/' || character == '-') {`，同样属协议名/通道名校验（调用点 `sdk.go:79` `if !validProtocolName(method) {`、`sdk.go:93` `if !validProtocolName(channel) {`）。所以原文档该行的两个锚点（`lib.rs:675`、`sdk.go:400`）不能支撑“消息/帧上限分歧”的结论。

真正的分歧点如下（全部为消息/帧尺寸）：

- 常量定义：Rust `lib.rs:12` `const MAX_JSON_BYTES: usize = 8 * 1024 * 1024;`、`lib.rs:13` `const MAX_BINARY_BYTES: usize = 64 * 1024 * 1024;`；Go `sdk.go:17` `const maxJSONBytes = 8 * 1024 * 1024`、`sdk.go:18` `const maxBinaryBytes = 64 * 1024 * 1024`；宿主 `plugins/runtime.rs:43` `const MAX_JSON_MESSAGE_BYTES: usize = 8 * 1024 * 1024;`、`runtime.rs:44` `const MAX_BINARY_MESSAGE_BYTES: usize = 64 * 1024 * 1024;`。
- **legacy JSONL 单行上限不一致**：宿主放宽到二进制消息尺寸 `runtime.rs:51` `const MAX_JSON_LINE_BYTES: usize = MAX_BINARY_MESSAGE_BYTES;`（读取点 `runtime.rs:906` `read_limited_line(&mut reader, MAX_JSON_LINE_BYTES)`），而 Rust SDK 的 JSONL 行仍按 JSON 上限 `lib.rs:491` `read_limited_line(&mut input, MAX_JSON_BYTES)?`，Go SDK 的 scanner 缓冲同样是 JSON 上限 `sdk.go:202` `scanner.Buffer(make([]byte, 64*1024), maxJSONBytes)`。即宿主可收 64MiB 的 JSONL 行，SDK 侧只能发/收 8MiB 的 JSONL 行。
- **framed 二进制帧头容许量不一致**：宿主 `runtime.rs:942` `let maximum = if kind == FRAME_KIND_JSON { MAX_JSON_MESSAGE_BYTES } else { MAX_BINARY_MESSAGE_BYTES + 1024 };`；Rust SDK `lib.rs:513` `let maximum = if kind == FRAME_KIND_JSON { MAX_JSON_BYTES } else { MAX_BINARY_BYTES + 1024 };`（+1024）；Go SDK `sdk.go:262-264` `maximum := maxJSONBytes` / `if kind == frameKindBinary { maximum = maxBinaryBytes + 2 + 256 }`（+258，预留 2 字节通道长度 + 至多 256 字节通道名）。
- JSON 写出上限三端一致：宿主 `runtime.rs:503` `if payload.len() > MAX_JSON_MESSAGE_BYTES {`、Rust `lib.rs:133` `if payload.len() > MAX_JSON_BYTES {`、Go `sdk.go:122` `if len(payload) > maxJSONBytes {`。二进制写出上限：Rust `lib.rs:107` `if data.len() > MAX_BINARY_BYTES {`，Go `sdk.go:97` `if len(channelBytes) > 65535 || len(data) > maxBinaryBytes {`。

结论修正建议：该行应改为“三端 JSON 消息上限一致（8MiB），分歧在 (a) legacy JSONL 行上限——宿主 64MiB vs 两侧 SDK 8MiB，与 (b) framed 二进制帧容许量——宿主/Rust +1024 vs Go +258”，并删除 `lib.rs:675` / `sdk.go:400` 这两个协议名校验锚点（保留 `lib.rs:12-13,133,491,513`、`sdk.go:17-18,122,202,262-264`、`runtime.rs:43-44,51,503,906,942`）。

## 附录：证据索引

**清单 / schema**

| 论断 | 锚点 |
| --- | --- |
| manifest 根对象对 v1 禁止未知字段（v0 容忍） | `dbx/plugins/manifest.schema.json:6` |
| `manifest_version` 固定为 `1`；v0 可读但 `.dbxp` 拒绝 | `dbx/plugins/manifest.schema.json:10`；`dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:471-472` |
| 贡献点类型是 kebab-case 的 5 种 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:229` |
| `connection-provider` 必填 `type/id/database_type/fields` | `dbx/plugins/manifest.schema.json:271` |
| `connection-provider` 的 `label` 在 schema/Rust 可选、在前端类型里必填（**更正后锚点 `:397`**） | `dbx/plugins/manifest.schema.json:275`；`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:549-550`；`dbx/apps/desktop/src/types/database.ts:401` |
| `connection-provider` 贡献点还有 `icon` 与 `description` 两个可选成员（**更正**） | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:592` |
| `workbench` 必填 `type/id/label`，需 UI 入口 | `dbx/plugins/manifest.schema.json:309` |
| `context-menu` 必填 `type/id/label/menu`，`menu` 为 `enum ["connection","table"]` | `dbx/plugins/manifest.schema.json:321`、`:328` |
| `result-view` 必填 `type/id/label`，需 UI 不需后端 | `dbx/plugins/manifest.schema.json:334`；`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:1126-1128` |
| `filesystem-provider` 必填 `type/id/label/schemes` | `dbx/plugins/manifest.schema.json:346` |
| filesystem capability 枚举 `read/write/delete/rename/mkdir` | `dbx/plugins/manifest.schema.json:358` |
| `connectionAction.timeout_ms` 限 1…120000 | `dbx/plugins/manifest.schema.json:303` |
| 条件树深度 8 / 节点 64 / picker 过滤器 16 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:32-33`、`:36` |
| `assetPath` 必须包内相对、不可逃逸 | `dbx/plugins/manifest.schema.json:72`；`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:997-1009` |
| `engines` 只有 `dbx` 与 `host_api`，后者必填 | `dbx/plugins/manifest.schema.json:22`；`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:817-827` |
| v1 与 v0 字段互斥（`executable`/`drivers`/`protocol_version`） | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:802-810` |
| `compatibility()` 复核 publisher/engines/permissions/入口包含关系/贡献点引用 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:815` |
| Windows 同名 `.bat` 优先于无扩展名启动器 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:967-982` |

**Host API（`window.dbxPlugin`）**

| 论断 | 锚点 |
| --- | --- |
| 冻结对象成员全集（29 项） | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:790-814` |
| `capabilities` = `{ downloadFile, planApi, storage }`，缺键即不支持 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:246-254` |
| `MAX_BRIDGE_PAYLOAD_BYTES` = 2 MiB | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:9` |
| `MAX_BRIDGE_BINARY_BYTES` = 8 MiB / `MAX_BRIDGE_SAVE_BYTES` = 512 MiB | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:10`、`:12` |
| `MAX_PLUGIN_WORKBENCH_CONTEXT_BYTES` = 2 MiB | `dbx/apps/desktop/src/lib/plugins/pluginData.ts:3` |
| `options.timeoutMs` 钳到 1…120000 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:930` |
| `onEvent` 只在声明 `host.events` 时转发（**更正后锚点**） | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:282`；`dbx/plugins/README.md:376` |
| `fileTransfer` 只在 `docs/content/docs/plugin-development.mdx:372` 有文档 | `dbx/docs/content/docs/plugin-development.mdx:355` |
| 复制路径无权限闸（注释给出的理由） | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:426` |
| `ui.readAsset` 路径校验（拒绝绝对路径与 `.`/`..` 段） | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:1035` |
| iframe 姿态 `sandbox="allow-scripts"` + `allow="clipboard-write"` | `dbx/apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:621` |
| CSP 的 `connect-src` 由 `host.network` 生成，无声明则 `'none'` | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:548-550` |
| 只认 `dbx-plugin:` 与 `dbx-plugin.localhost` 两种 baseUrl 才放宽资源源 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:576` |
| `dbx-plugin://` 资产协议 + `no-store` | `dbx/src-tauri/src/plugin_ui_protocol.rs:18`、`:100-101` |
| srcdoc 前把 `script[src]`/`link[stylesheet]` 内联 | `dbx/apps/desktop/src/components/plugins/PluginWorkbenchHost.vue:471` |
| UI kit 与 `data-dbx-theme` 注入 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:608`、`:691` |
| `downloadFile` 并发上限 2 且 id 不可重复 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:319` |
| 原生文件句柄 64 个上限、8 MiB 分块 | `dbx/src-tauri/src/commands/plugin_file.rs:26`、`:32` |
| 存储 256 KiB/值、1 MiB/库、1024 key | `dbx/src-tauri/src/commands/plugin_storage.rs:28`、`:30`、`:32` |

**RPC 与协议**

| 论断 | 锚点 |
| --- | --- |
| 两种传输 `stdio-jsonl` / `stdio-framed` | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:159` |
| 帧 kind 常量 `FRAME_KIND_JSON=0` / `FRAME_KIND_BINARY=1` | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:52` |
| 写出的 JSON 帧封顶 8 MiB | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:43` |
| 二进制帧封顶 64 MiB；`MAX_JSON_LINE_BYTES` 同为 64 MiB | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:44`、`:51` |
| framed 读上限 = 二进制上限 + 1024 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:942` |
| 方法名语法 `[A-Za-z0-9._:/-]`、≤256 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:1025` |
| 空 id/空 method 的帧终止会话 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:654` |
| 握手响应结构 `PluginHandshake`；`PluginHandshakeIdentity` 无 rename_all | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:97` |
| 协议版本不匹配即拒绝 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:385` |
| `plugin/initialize` 回显 permissions 但不复核 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:380` |
| `host/` 为宿主请求保留前缀 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:29` |
| `host/requestUserInput` 是唯一的插件→宿主方法 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:701` |
| 提示参数边界与超时钳制 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:811-871` |
| 弹窗暂停总时长上限 600 s / 并发 4 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:34`、`:32` |
| `connection/action` 未声明即报错，超时取 `timeout_ms` | `dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:299-307`、`:313` |
| connect 截止 `clamp(1,300)` 秒 | `dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:438-444` |
| `filesystem/*` 全部以 `required_permission = None` 发起 | `dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:170`、`:202`、`:313` |
| filesystem 分页默认 200 / 上限 1000，预览默认 256 KiB / 上限 4 MiB，内联写 4 MiB | `dbx/crates/dbx-plugin-runtime/src/plugins/filesystem.rs:14-18` |
| 二进制必须 framed 传输，否则显式报错 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:333` |
| `mcp/tools` 30 s；`mcp/call` 300 s 默认 | `dbx/crates/dbx-mcp/src/backend.rs:742`、`:782`；`dbx/src-tauri/src/commands/mcp_bridge.rs:1415` |
| 驱动方法族只在 legacy manifest v0 可用（17 个方法） | `dbx/crates/dbx-core/src/connection/mod.rs:1720`；`dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:802` |
| `workbench` / `result-view` 没有后端 RPC 方法 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:641`、`:667` |
| 会话状态枚举 snake_case（无 `error` 态） | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:73`；`dbx/apps/desktop/src/types/database.ts:665` |

**事件**

| 论断 | 锚点 |
| --- | --- |
| `PluginEvent` 是 camelCase 线格式 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:57` |
| `dbx-plugin-event` / `dbx-plugin-binary` Tauri 事件 | `dbx/src-tauri/src/commands/plugins.rs:154`、`:175` |
| `plugin-runtime-replaced` 在安装/回滚时发出 | `dbx/src-tauri/src/commands/plugins.rs:516` |
| `plugin-url-download-progress` 进度事件 | `dbx/src-tauri/src/commands/plugins.rs:223` |
| `uninstall_plugin` 不发任何事件 | `dbx/src-tauri/src/commands/plugins.rs:255-291` |
| iframe 内 document CustomEvent 由注入 SDK 派发 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:266` |
| `host.stream.chunk/end/error` 由 SDK 实现但无生产者文档 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:750-777` |
| 会话级广播 256/64，宿主级 512/128 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:225-226`；`dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:85-86` |
| 宿主级 lag 只打日志 `skipped N events` | `dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:392`、`:408` |
| web SSE 把 lag 显式建模为 `{kind:"lagged"}` | `dbx/crates/dbx-web/src/routes/plugins.rs:571`、`:580` |
| web 客户端解析 `lagged` 但什么都不做 | `dbx/apps/desktop/src/lib/backend/http.ts:709-710` |
| web SSE 事件流不按插件/权限过滤 | `dbx/crates/dbx-web/src/routes/plugins.rs:564`、`:575-578`；`dbx/crates/dbx-web/src/main.rs:433` |
| 会话状态只能拉（`list_active_plugins`），前端 wrapper 零调用 | `dbx/crates/dbx-plugin-runtime/src/plugins/runtime.rs:289`；`dbx/apps/desktop/src/lib/backend/tauri.ts:2450-2458` |

**权限与信任**

| 论断 | 锚点 |
| --- | --- |
| 6 个固定权限串（+ 参数化 `host.network:`） | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:24-25` |
| 目录 schema 的权限 enum 与常量逐字节一致（有测试断言） | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:1635` |
| `host.network:` 条目上限 8 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:29`、`:848-853` |
| 运行时解析器比 schema/前端更宽松 | `dbx/crates/dbx-plugin-runtime/src/plugins/manifest.rs:48-58` vs `dbx/plugins/manifest.schema.json:34` |
| `ensure_permission` 存在但所有调用点传 `None` | `dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:810`、`:158`、`:171`、`:184`；`dbx/src-tauri/src/commands/plugins.rs:322` |
| `host.filesystem` 只闸 `host.openFilesystem` | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:385` |
| `host.plans:read` 只在渲染层校验 | `dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts:392`、`:388`；`dbx/src-tauri/src/commands/query.rs:983-997` |
| sidecar 网络/文件不受权限中介 | `dbx/plugins/README.md:695` |
| 签名策略 `LocalSigned` / `LocalDevelopment`（布尔开关） | `dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:811-812`、`:34`；`dbx/src-tauri/src/commands/plugins.rs:195` |
| 内置两把官方信任锚 | `dbx/crates/dbx-plugin-runtime/src/plugins/marketplace.rs:32-35` |
| 更新连续性检查（仓库/发布者/签名 key） | `dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:226` |
| 撤销只在商店侧闸门 | `dbx-store/scripts/validate.mjs:98` |
| 目录权限必须等于 manifest 权限 | `dbx/crates/dbx-plugin-runtime/src/plugins/installer.rs:839` |
| dev host 硬编码 `connect-src 'none'` | `dbx/plugins/sdk/dev-host/browser-bridge.mjs:189` |
| 安装 UI 只展示权限数量 | `dbx/apps/desktop/src/components/plugins/PluginContributionsPanel.vue:1026` |

**集成**

| 论断 | 锚点 |
| --- | --- |
| 插件安装/列举命令族入口（方向为 `ui->host`，**更正后口径**） | `dbx/src-tauri/src/commands/plugins.rs:23-24` |
| `invoke_plugin` 的 `required_permission = None` 与超时钳制 | `dbx/src-tauri/src/commands/plugins.rs:320-322` |
| `install_plugin_package` 的 `allow_unsigned` 开关 | `dbx/src-tauri/src/commands/plugins.rs:195` |
| 有依赖连接时禁止卸载 | `dbx/src-tauri/src/commands/plugins.rs:271-276` |
| 生命周期锁挡住活跃连接下的更新 | `dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:119` |
| 插件连接不能执行 SQL | `dbx/crates/dbx-core/src/query/mod.rs:2229` |
| `proxy_route` → SOCKS5 运行时路由 | `dbx/crates/dbx-core/src/connection/mod.rs:3363-3366`；`dbx/crates/dbx-plugin-runtime/src/plugins/host.rs:202-207` |
| result-view 解析走 `findUiContribution`（工作台 + 结果视图） | `dbx/apps/desktop/src/lib/plugins/frontendPlugin.ts:77-83` |
| 结果快照截 500 行并置 `truncated` | `dbx/apps/desktop/src/components/layout/ContentArea.vue:1063-1072` |
| 结果视图工具栏最多渲染 4 个按钮 | `dbx/apps/desktop/src/components/plugins/QueryResultToolbarActions.vue:37` |
| 插件 MCP 桥路由在仓内无客户端 | `dbx/src-tauri/src/commands/mcp_bridge.rs:235-238` |
| box 桥的 MCP 调用超时 300 s / 上限 600 s | `dbx/src-tauri/src/commands/mcp_bridge.rs:1415` |
| `dbx-cli` 无插件面（不存在证明） | `dbx/crates/dbx-cli/src/main.rs:3-12` |
| `filesystem/download/*` 超时 120 s、close 10 s | `dbx/src-tauri/src/commands/plugin_download.rs:79`、`:88`、`:122` |
| 计划 API 的上限与"只估不跑" | `dbx/crates/dbx-core/src/query/plugin_plan.rs:44-55`、`:227` |
| MCP 执行路径对插件 SQL 的预筛漏判 | `dbx/src-tauri/src/commands/mcp_bridge.rs:1571-1578`；`dbx/crates/dbx-sql/src/query_execution_sql.rs:196-212` |

**工具链**

| 论断 | 锚点 |
| --- | --- |
| CLI 只 dispatch 5 个子命令 | `dbx/plugins/sdk/cli/src/lib.rs:327` |
| `create --signing-key-id` 已被移除（报错） | `dbx/plugins/sdk/cli/src/lib.rs:363` |
| `package --key-id` 已被移除（报错） | `dbx/plugins/sdk/cli/src/lib.rs:408` |
| `package` 在 stage 时把 `executable` 改写为 `bin/<target>/…` | `dbx/plugins/sdk/cli/src/lib.rs:1025` |
| `DBX_PLUGIN_SDK_ROOT` 不参与 `create`（**更正后口径**） | `dbx/plugins/sdk/cli/src/lib.rs:1348` |
| 打包器体积上限 512 MiB / 1 GiB / 256 MiB / 10 000 项 | `dbx/plugins/sdk/packager/src/main.rs:13-16` |
| `sign` 要求候选包干净未签名 | `dbx/plugins/sdk/packager/src/main.rs:316`、`:348` |
| `checksums.json` 用 sha256、`signature.json` 用 ed25519（**两处锚点各差一行，已在正文按更正后行号标注**） | `dbx/plugins/sdk/packager/src/main.rs:162`、`:168` |
| Rust SDK 默认调用超时 330 s、worker 池 2…16 | `dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:20`、`:652` |
| Rust SDK 的宽松名字校验 | `dbx/plugins/sdk/rust/dbx-plugin-sdk/src/lib.rs:675` |
| Go SDK 名字语法禁止首字符标点 | `dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:400` |
| Go SDK 扫描器 8 MiB 上限、帧头上限 +2+256 | `dbx/plugins/sdk/go/dbx-plugin-sdk/sdk.go:202`、`:264` |
| dev host 数据目录不得落在 UI 资源根内 | `dbx/plugins/sdk/dev-host/README.md:39` |
| `verify-plugin-cli-package.mjs` 默认只验 `frontend` 模板 | `dbx/scripts/verify-plugin-cli-package.mjs:89` |
| 本地 manifest 闸门的权限白名单缺 `host.storage`/`host.ai`（0.2.3 起已补 `host.plans:read`） | `dbx-plugin-excalidraw/scripts/check-manifest.mjs:34` |