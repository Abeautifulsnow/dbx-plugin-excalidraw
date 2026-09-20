---
name: dbx-plugin-release
description: 发布 Excalidraw Studio（DBX 插件 io.dbx.excalidraw）新版本的完整流程：版本号同步、发布前验证（构建 ui/ + 预检 + 冒烟）、提交推送、用 scripts/release.mjs 创建 GitHub Release、确认 CI 产物与商店自动同步。当用户提到"发版 / 打版本 / 发布新版本 / 发布 / 上线 / 打包发版 / release / 打 tag / 提交到 dbx-store"，或要求把当前改动发布出去、发个版本时使用。
---

# Excalidraw Studio 发版流程

本仓库是 DBX 插件 `io.dbx.excalidraw`（Go Sidecar + React/Excalidraw 前端）。
发布链路：**`node scripts/release.mjs` 创建 GitHub Release（published 事件）→ 仓库 Workflow
构建 5 平台候选包 → dbx-store 每小时同步自动建候选 PR → 维护者审核 → `/sign` 签名 → 合并生效**。
本 skill 覆盖你负责的前半段；后半段是自动 + 人工审核，无需作者操作。

## 铁律（先读）

1. **已发布的字节不可覆盖**：旧 Release 资产、旧 tag 不可重传/移动。任何字节变化都必须递增
   `manifest.json` 的 `version` 并走一次完整发版（`scripts/release.mjs:112-115` 会强制这一点）。
2. **不要手动打 tag / push tag**：tag 由 `scripts/release.mjs` 创建 Release 时在远端生成。
   手工先推 tag 会让脚本以 `tag v<版本> already exists` 直接退出（`release.mjs:110-115`）。
3. Release 必须是**正式**发布：`release.mjs` 默认即是；**不要加 `--prerelease`**——预发布会被
   store 同步器静默跳过（README.md:94 明确「store sync skips these」）。
4. 同步器只看**最新一个**非 draft、非 prerelease Release 的 `release-candidates.json`
   （回看最近 30 个）；Workflow 失败时静默跳过——发版后必须确认 Workflow success 且资产
   **恰好 6 个**。
5. 本机直连 github.com 不通：git/curl/API 一律走本地代理 `http://127.0.0.1:7897`
   （Clash Verge 混合端口）。git 用一次性参数 `git -c http.proxy=...`，不改仓库配置；
   **任何联网 git 命令都要带**（`fetch`/`ls-remote`/`push` 都是，裸 `git fetch` 会
   直接 `Connection was aborted`）；`scripts/release.mjs` 内置了代理兜底
   （`release.mjs:25,56`）。
   **开工前先做代理健康检查**（第 2 步第 0 条）：代理端口在监听 ≠ 能用。失败时报
   `schannel: failed to receive handshake` / `SSL_ERROR_SYSCALL`，说明代理上游断了
   ——curl、git、python 三种方式都会同样报错，是环境问题不是命令写错，先去修代理
   （换节点/更新订阅）再发版，不要在直连或重试上耗时间。
6. **凭据只进内存，绝不打印**。脚本用 git credential helper 里已有的 GitHub 凭据
   （与 push 同一份），你不需要提供 token。

## 第 1 步：版本号同步

`manifest.json` 是**唯一事实来源**（`release.mjs:102-108` 只读它，含 SemVer 校验：不接受 `+`
构建元数据）。当前版本用 `node -p "require('./manifest.json').version"` 读出（现为 `0.2.1`），
下一版本 = patch + 1（0.2.1 → 0.2.2）；修复类改动走 patch，不要跳大跨度。

确认目标 tag 未被占用（两个都必须为空；裸 `git ls-remote` 直连不通，需带代理）：

```bash
git tag -l v0.2.2
git -c http.proxy=http://127.0.0.1:7897 ls-remote --tags origin refs/tags/v0.2.2
```

然后把这个版本号同步到下表各处：

| 文件 | 字段/位置 | 说明 |
| --- | --- | --- |
| `manifest.json` | `version` | 事实来源；与包内身份不一致会被签名环节拒绝 |
| `backend/main.go` | `pluginVersion` 常量 | Sidecar 握手身份串；与 manifest 不一致会报 `Sidecar identity or protocol does not match manifest` |
| `frontend/package.json` | `version` | 一致性（不参与打包身份，但保持同步） |
| `scripts/sidecar-smoke.mjs` | 两处字面量：`128` 请求参数、`132` 断言标签 | 冒烟测试把版本作为握手参数并断言身份 |
| `.dbx-store.json` | `releaseNotes` | **不是版本号站点**（该文件没有 `version` 字段，版本更新时可不动）。它是商店展示文案，同时是 Release notes 的开头（`release.mjs:117,126-133`）；改了要随新 Release tag 才生效 |

`grep -rn "<旧版本号>" --include="*.json" --include="*.go" --include="*.mjs" .` 只作**交叉核对**，
不要当发现机制：它会命中无关噪音（如 `frontend/package-lock.json` 里的第三方版本号），
也永远找不到 `.dbx-store.json`。

## 第 2 步：发布前验证（全绿才继续）

> 用 **Bash 工具（Git Bash）** 执行，不要用 PowerShell（`VAR=value cmd` 前缀在 PowerShell 下非法）。
> 每条命令都以仓库根目录为起点、可单独重跑，不要依赖上一条的 cwd。

```bash
# 0. 代理健康检查（发版全程依赖它；端口在监听不代表能用）
curl -x http://127.0.0.1:7897 -sS -m 20 -o /dev/null https://api.github.com/rate_limit \
  && echo "proxy OK" || echo "proxy FAILED"
#    期望 `proxy OK`（exit 0）。失败时常伴随 `schannel: failed to receive handshake`
#    / `SSL_ERROR_SYSCALL` —— 那是代理上游断了：先修代理（换节点/更新订阅）再继续，
#    git/curl/python 都会同样失败，别在直连或重试上耗时间。
#    ⚠️ 不要用 `-w '%{http_code}'` 判代理死活：本机 curl 8.8.0(mingw)+Schannel 下该
#    组合对 https 会报 `curl: (43) ... bad argument` 并打印 http=000，**代理完全正常时
#    也会如此**（同一条命令去掉 -w 即 exit 0，实测 4/4 复现）——那是 curl 的 bug，
#    据此判定"代理断了"会误停一次本可成功的发版。
#    需要看响应体确认不是错误页时：`curl -x ... https://api.github.com/rate_limit | head -c 80`

# 0b. 构建前端：ui/ 是 vite 产物且被忽略（.gitignore 的 /ui/，frontend/vite.config.ts 的 outDir "../ui"），
#     新 clone 里不存在；缺了它 check-project 会报 2 个错。CI 同样是先构建再打包。
npm --prefix frontend ci          # 仅当 frontend/node_modules 不存在（新 clone）
npm --prefix frontend run build   # 以退出码 + ui/index.html 存在为准

# 1. 插件预检（manifest / dbx-plugin.toml / include 一致性）
node "C:/Users/rose/.claude/skills/dbx-plugin/scripts/check-project.mjs" .
#    该绝对路径只在本机存在；缺失时改用用户级 dbx-plugin skill 的 <skill-root>/scripts/check-project.mjs
#    若报 `[package].include 项 "ui" 在项目中不存在` → 是第 0 步产物缺失，不要去改 dbx-plugin.toml

# 2. 后端 + 静态检查（子 shell 里切目录，不污染后续命令的 cwd）
(cd backend && GOWORK=off go vet ./... && GOWORK=off go test ./...)

# 3. 前端
npm --prefix frontend test && npm --prefix frontend run typecheck

# 4. sidecar 端到端冒烟（脚本自己构建二进制并起进程；不接收任何参数）
node scripts/sidecar-smoke.mjs
```

冒烟通过的唯一判据是 stdout 末行 `[smoke] OK — all protocol assertions passed`。
注意 `identity matches manifest` 是 `sidecar-smoke.mjs:132` 的**断言标签，只在失败时出现**
（`[smoke] FAILED: smoke assertion failed: identity matches manifest`），不要用它 grep 判断成功。

## 第 3 步：提交并推送（不要打 tag）

```bash
git add manifest.json backend/main.go frontend/package.json scripts/sidecar-smoke.mjs .dbx-store.json
git commit -m "chore(release): bump version to <新版本>"
git -c http.proxy=http://127.0.0.1:7897 push origin main
```

`release.mjs` 要求工作树干净、当前在 `main`、且与 origin **完全同步**（`release.mjs:84-99`），
所以必须先提交并推送——它不会替你 commit 或 push。

## 第 4 步：创建 Release（用仓库自带的一键脚本）

```bash
node scripts/release.mjs
```

它按顺序做：worktree/branch/同步检查 → 从 `manifest.json` 取版本并派生 tag → 校验 local 与
remote 的 tag 都不存在 → 组装 notes（`.dbx-store.json` 的 `releaseNotes` + `### Changes since
<上个 tag>` + 自上个 tag 以来的 commit 标题）→ 用 git 凭据经 API 创建 Release
（`target_commitish: main`，tag 随之在远端生成）。想额外补一段文字用 `--notes "..."`。

手工兜底（脚本不可用时；本机验证过的路径）：`git credential fill`（输入 `protocol=https` +
`host=github.com`）取 `password=` 作 token，`POST https://api.github.com/repos/<owner>/<repo>/releases`，
头用 `Authorization: Bearer <token>`（fine-grained PAT 用 `token` 前缀对部分端点会 404），
body 含 `tag_name` / `target_commitish: main` / `name` / `body` / `draft: false` / `prerelease: false`；
curl 加 `-x http://127.0.0.1:7897`。**`<owner>/<repo>` 从 `git remote get-url origin` 解析，不要
手打**——`release.mjs:138` 自己硬编码了 `Abeautifulsnow`，fork 到别的 owner 时必须改那一行。
已知坑：owner 拼错返回的是 404（不是 403），先核对拼写再怀疑权限。

## 第 5 步：发布后确认（不要跳过）

两个 GET 都是公开接口，不需要 token：

```bash
# a) 工作流状态：在 workflow_runs[] 里找 name == "Release DBX plugin" 且 head_branch == v<版本> 的那条
curl -x http://127.0.0.1:7897 -sS "https://api.github.com/repos/<owner>/<repo>/actions/runs?branch=v<版本>"

# b) 资产清单：.assets[].name
curl -x http://127.0.0.1:7897 -sS "https://api.github.com/repos/<owner>/<repo>/releases/tags/v<版本>"
```

要求 `status == completed` 且 `conclusion == success`（历史耗时约 2–5 分钟），并且 `.assets[]`
**恰好 6 个**（Release 网页上的 "Source code" 压缩包是自动生成的，不要数进去）：

```
io.dbx.excalidraw-<版本>-{darwin-arm64,darwin-x64,linux-arm64,linux-x64,windows-x64}.dbxp
release-candidates.json
```

之后自动流程：store 每小时读最新 Release 的 `release-candidates.json` → 自动建/更新候选 PR
（分支 `automation/plugin-release/io.dbx.excalidraw/<version>`，标题
`feat(store): submit io.dbx.excalidraw@<version>`）→ 维护者 `/sign` → 合并后用户才能更新到。
候选 PR 的 CI 在签名前**故意保持红色**（`open candidate(s) awaiting DBX Store signing`），
这是设计，不是出错。可用 `gh` 或 API 查 `t8y2/dbx-store` 的开放 PR 确认同步已发生。

## 故障速查

| 症状 | 原因与处理 |
| --- | --- |
| curl/git 报 `schannel: failed to receive handshake` 或 `OpenSSL SSL_connect: SSL_ERROR_SYSCALL` | 代理上游断了（端口仍在监听也会这样），先修代理再继续；不是命令或凭据问题 |
| 代理健康检查打印 `http=000` 且报 `curl: (43) ... bad argument` | **不是**代理问题：是本机 mingw curl 8.8.0 + Schannel 对 https 加 `-w` 的 bug，代理正常时也复现。改用不带 `-w` 的检查（第 2 步第 0 条） |
| 裸 `git fetch` / `git push` 报 `Recv failure: Connection was aborted` | 该命令没带代理。用 `git -c http.proxy=http://127.0.0.1:7897 ...` |
| `release.mjs` 报 `GitHub API call failed` | 同上——它先直连再走代理，两条都不通时才会这样（`release.mjs:54-75`） |
| `release.mjs` 报 worktree dirty / 不在 main / 不同步 | 先 commit 并 push（第 3 步）；未跟踪文件也算 dirty |
| `release.mjs` 报 tag 已存在 | 该版本已发布过；**不可复用**，递增 `manifest.json` 版本重走全流程 |
| CI 失败或资产少于 6 个 | tag 与已发布字节不可重用，同样递增版本重新发（先看 Workflow 日志定位失败原因） |
| 商店没收到 | 确认该 Release 非 draft、非 prerelease，且 `release-candidates.json` 在资产里；同步器只看最新一个 |
| 只想改商店展示文案 | 改 `.dbx-store.json` 后仍必须走完整发版（递增版本 + Release），因为同步由 Release 驱动 |

## 相关文件

- `scripts/release.mjs` — **官方发布入口**（README.md:88-102）。前置条件：干净工作树、在 main、
  与 origin 同步、SemVer 无 `+`、tag 未占用；自动生成 notes 并用 git 凭据建 Release
- `.github/workflows/plugin-release.yml` — 触发器 `on: release: [published]`，薄封装调用
  `t8y2/dbx` 的 reusable workflow；`package-command` 先构建前端进 `ui/`（packager 只暂存已存在
  目录），`plugin-cli-version: 0.1.9` 固定可复现；注释说明 reusable ref 暂用 `@main`
- `release-candidates.json`（Release 资产）— store 同步器唯一认的机器可读清单：`plugin` 块
  （id/name/description/publisher/version/permissions）+ 5 平台 `artifacts[]`（url/sha256/size）；
  签名时会重新下载逐一核对哈希
- `.dbx-store.json` — 商店展示元数据（name/description/icon/tags/source/homepage/license/
  releaseNotes/localizations），**无版本号字段**；`releaseNotes` 同时充当 Release notes 开头
- `scripts/sidecar-smoke.mjs` / `scripts/make-store-candidate.mjs` — 身份与协议冒烟 /
  （仅在无 autoUpdate 时手工提候选）从 `release-candidates.json` 生成 store PR 所需文件
- `scripts/sidecar-smoke.mjs:132` 的断言标签、`release.mjs:112-115` 的 tag 保护是理解上述
  报错文案的来源

## 关于本 skill 的加载位置

本文件是**唯一权威副本**，位于 `.agents/skills/dbx-plugin-release/`。Claude Code 读取的是
项目内的 `.claude/skills/`，因此那里放了一个指针文件——修改内容请只改本文件，避免两份漂移。
