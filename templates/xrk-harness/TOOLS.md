# TOOLS（XRK Harness 工具面速查）

会话徽章 **XRK Harness**（`harness`）大致包含：

| 族 | 工具名（示意） |
|----|----------------|
| 文件系统 | `read_file` · `write_file` · `apply_edit` · `glob` · `grep` |
| Shell | `bash`（可后台 job） |
| 联网 | `web_search` · `web_fetch` |
| 语言服务 | `lsp` |
| 终端 | `terminal_open` / `send` / `read` / `signal` / `close` / `list` |
| 标准 | todo · ask_user · exit_plan_mode · skill |

**Minimal** 只有 fs + skill + std（无 bash / 联网 / lsp / PTY）。

进程插件通过 `kind: tools` 追加工具；不能覆盖同名 builtin。
