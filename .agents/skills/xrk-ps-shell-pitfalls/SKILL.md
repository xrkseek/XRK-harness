---
name: xrk-ps-shell-pitfalls
description: >-
  这台 Windows 机上 PowerShell/环境的具体陷阱：管道改写毁文件、vitest filter
  位置、无 BOM UTF-8 中文路径、GBK 显示≠文件坏。任何 bash 命令报 ParserError、
  文件读出来乱码、node 脚本异常时使用。
---

# PowerShell / Windows 环境陷阱

本仓工作区跑在 **Windows + pwsh**。以下坑都实际踩过，先读再跑命令。

## When to Use

- `bash` 工具报 `ParserError: TerminatorExpectedAtEndOfString` / 整段解析期失败（exit 1 + 一步不执行）
- 文件读出来中文乱码（PowerShell `Get-Content` 显示 ≠ 磁盘真实编码）
- node/tsc/vitest 从 `scripts/` 或包内跑报 `ERR_MODULE_NOT_FOUND`
- 改文件内容时用 shell 管道而不是编辑工具

## Procedure

### 1. 长脚本写文件，用 `-File` 执行

PowerShell 整段是解析期编译的：一行语法错 → 整段失败（exit 1 + ParserError），一步都不执行。长脚本写 `.ps1` 文件再 `-File` 执行，报错时能精确定位到行。

### 2. 改文件用编辑工具

`apply_edit` / `write_file` / `apply_patch` 按 UTF-8 写回。shell 管道 `(Get-Content -Raw) -replace ... | Set-Content` 会把 LF 压成一行、加 BOM、把 UTF-8 中文按 GBK 解码再编码（乱码）。

**但 `apply_edit` 本身会「只删不写」**：v0.6.5 连撞两次——`ruleset.ts` 那次把刚写进去的整段弄丢、
连带删掉原有的一行 `return finish(kindWide(...))`；`apps/site/releases.json` 那次删空 `version` +
`filename` 两行，**而且已经 commit + push**。工具返回 `edited …` 不代表内容真落全。
硬规矩：**每次编辑类工具返回后立刻 `git diff <file>` 回读**，确认新增行在、被删行只有预期的那些；
发现丢内容马上 `git checkout -- <file>` 回基线重做。多行 / 跨行的结构改写优先用 `apply_patch`。

### 3. 验证文件完好用 node，不用 Get-Content

`Get-Content` 默认按系统 ANSI 码页（GBK）解码 UTF-8 文件，中文会显示成乱码——**不代表文件真坏了**。验证用：
`node -e "const t=require('fs').readFileSync(p,'utf8'); console.log(t.charCodeAt(0)===0xFEFF, t.slice(0,60))"`

### 4. `.ps1` 脚本内放 ASCII 字面量

无 BOM UTF-8 `.ps1` 里中文绝对路径会被码页毁掉（Set-Location 失败）。路径用 ASCII，或从环境变量取。

### 5. vitest 从根工作区跑

`pnpm --filter <pkg> exec vitest run <file>` 会把 `<file>` 当 include 过滤器（匹配不到 → "No test files found"）且包内 spawn 可能 `ENOENT`。稳的是：
`pnpm exec vitest run packages/<pkg>/tests/<file>.test.ts`（根工作区跑，能正确匹配 include 模式）

### 6. commit message 一律写文件用 `-F`

双引号里的 `` ` `` 是 PowerShell 转义符：`git commit -m "…\`xrkh\`…"` 会把反引号吞掉甚至吃掉后续内容，
`git rebase` 一侧还会报出难读的 "corrupt"/瞬时 `unable to resolve` 假象。
长 message / 多行 message 先 `write_file` 到 `.tmp/cm-N.txt`，再 `git commit -F .tmp/cm-N.txt`。
同理 `git grep -n pat -A 5`：pwsh 把 `-A` 交给 git 当 revision，报 `unable to resolve revision: -A`
—— 取上下文用 `Select-String -Pattern pat -Context 0,5`。

### 7. `git checkout <sha> -- <path>` 会同时写 index

之后 `git status` 显示 `MM`（暂存区 + 工作区各有差异），容易误判成"文件被别人改了"。
恢复基线看行为：`git checkout <sha> -- <path>` → 测完 `git checkout HEAD -- <path>` 还原，
必要时 `git reset -- <path>` 清 index。改测试文件做调试注入（`console.log`）后**务必**
`git diff <file>` 确认干净再提交，否则 DBG 会跟着 commit 进历史。

### 8. 别在 subst 盘符路径上递归删除

`Remove-Item -Recurse -Force 'X:\.release\stage-0.6.1'` 会被拦成
`hardline: recursive force delete of drive root (PowerShell)`。路径改写成**工作区相对**
（`.release\stage-0.6.1`）即可；`subst X: /d` 单独执行不受影响。

### 9. workspace 包名解析

pnpm workspace 下裸 ESM `import '@scope/pkg'` 从 `scripts/` 或任意位置跑 → `ERR_MODULE_NOT_FOUND`。临时脚本 import 包 `dist/index.js` 的**相对/绝对路径**，或用包内 cwd + 包导出。`.mjs` 不能有 TS 类型注解，写纯 JS。

## Pitfalls

- **GBK 终端打 emoji 会炸**：`print("✅ …")` 在默认 GBK 控制台报
  `UnicodeEncodeError: 'gbk' codec can't encode character '\u2705'`。脚本开头加
  `sys.stdout.reconfigure(encoding="utf-8")`（Python 3.7+），或干脆别在 stdout 打 emoji。
- **被占用的文件写不进去**：WPS / Office 开着 `*.pptx` / `*.pdf` 时写入报
  `PermissionError`。写之前先试探测（`try: open(path,"ab")`），拿不到就落
  `-v2` 后缀，别把用户的原文件覆盖坏。
- `Select-Object -First N` 截断输出会吃掉报错尾部——压测/测试先看 `EXIT=$LASTEXITCODE` 再信 stdout。
- PowerShell `2>&1 | Select` 会把 stderr 包成 `NativeCommandError` 显示，不是命令真的挂了。
- `git diff --no-index` 当文件不同时 exit 1（`[exit code: 1]` 是正常差异信号，不是失败）。
- **重定向目标用相对 `..\..\..\..\` 会算错层，而且失败得很安静**：v0.6.5 从 `.release\harness-cli`
  往上四层想落回工作区的 `.tmp`，实际落到 `Desktop\.tmp`（不存在），报
  `Out-File: Could not find a part of the path` —— 于是 **publish 一步都没跑，job 却显示 completed**。
  大上传 / 长任务的日志重定向一律写**绝对路径**，并在开跑前 `Test-Path` 目标目录。
  后台 job 返回 completed 只证明进程退出过，不证明命令成功——看日志尾部与 `$LASTEXITCODE`。
