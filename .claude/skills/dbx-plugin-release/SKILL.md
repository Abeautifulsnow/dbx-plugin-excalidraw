---
name: dbx-plugin-release
description: 发布 Excalidraw Studio（DBX 插件 io.dbx.excalidraw）新版本的完整流程：版本号同步、发布前验证（构建 ui/ + 预检 + 冒烟）、提交推送、用 scripts/release.mjs 创建 GitHub Release、确认 CI 产物与商店自动同步。当用户提到"发版 / 打版本 / 发布新版本 / 发布 / 上线 / 打包发版 / release / 打 tag / 提交到 dbx-store"，或要求把当前改动发布出去、发个版本时使用。
---

# 指针：权威内容在 .agents/skills/

本文件只是让 Claude Code 能发现该 skill 的入口。**权威且唯一的副本是**：

```
.agents/skills/dbx-plugin-release/SKILL.md
```

请立即用 Read 工具读取上面这个路径，并按其中的步骤执行发版流程。

不要在本文件里写发版步骤——两份内容会漂移。要修改流程，只改 `.agents/skills/` 下的那一份。
