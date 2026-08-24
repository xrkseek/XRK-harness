# 发行说明 / Release Notes

> **读者 / Audience**：终端用户 · 维护者 / End users · Maintainers

公开线只保留两档：

The public line keeps only two releases:

| 档 / Line | 版本 / Version | 说明 / Notes |
|------|------|------|
| **正式 / Formal** | [v0.1.4](./v0.1.4.md) · [GitHub Release](https://github.com/xrkseek/XRK-harness/releases/tag/v0.1.4) | 当前推荐安装 / Current recommended install |
| **预览 / Preview** | [v0.0.11](./v0.0.11.md) · [GitHub Release](https://github.com/xrkseek/XRK-harness/releases/tag/v0.0.11) | 历史预览线唯一保留；npm tag **`preview`** / Sole retained preview; npm tag **`preview`** |

安装与发包见 [publishing.md](../publishing.md)。`0.1.0`–`0.1.3` 与中间预览号已在 npm 弃用；GitHub 仅保留上表两档 Release。

Install and publish: [publishing.md](../publishing.md). `0.1.0`–`0.1.3` and intermediate preview numbers are deprecated on npm; GitHub keeps only the two releases above.

## npm 安装速查 / npm install cheat sheet

| 用途 / Use | 命令 / Command |
|------|------|
| 正式 / Formal | `npx @xrkseek/harness-cli@0.1.4 web` 或 `npm i -g @xrkseek/harness-cli@latest` |
| 预览 / Preview | `npx @xrkseek/harness-cli@0.0.11 web` 或 `npm i -g @xrkseek/harness-cli@preview` |

发行说明正文里的文档链接使用 GitHub **blob/main** 绝对 URL，以便在 GitHub Release 页面也能点开；在本仓浏览时 `./v*.md` 相对链接同样可用。

Release-note doc links use GitHub **blob/main** absolute URLs so they work on GitHub Release pages; relative `./v*.md` links still work when browsing this repository.
