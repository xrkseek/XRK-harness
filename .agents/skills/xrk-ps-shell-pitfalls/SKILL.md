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

### 1. 一行语法错 = 整段死

PowerShell 一行里任何语法错误 → **整段解析期失败**，一步都不执行（exit 1 + ParserError）。长脚本写 `.ps1` 文件用 `-File` 执行，别拼一行。

### 2. 改文件永远用编辑工具，别用 shell 管道

`(Get-Content -Raw) -replace ... | Set-Content` 会：把 LF 压成一行、加 BOM、把 UTF-8 中文按 GBK 解码再编码（**乱码**）。改脚本/文档用 `apply_edit` / `write_file` / `apply_patch` 工具，写完用 node（不是 Get-Content）验证编码。

### 3. GBK 显示 ≠ 文件坏

`Get-Content` 默认按系统 ANSI 码页（GBK）解码 UTF-8 文件，中文会显示成乱码——**不代表文件真坏了**。验证文件完好用：
`node -e "const t=require('fs').readFileSync(p,'utf8'); console.log(t.charCodeAt(0)===0xFEFF, t.slice(0,60))"`

### 4. 无 BOM UTF-8 `.ps1` 里中文路径会被码页毁掉

`.ps1` 脚本内**不放非 ASCII 字面量**（中文绝对路径 → Set-Location 失败）。路径用 ASCII，或从环境变量取。

### 5. vitest filter 放根工作区

`pnpm --filter <pkg> exec vitest run <file>` 会把 `<file>` 当 include 过滤器（匹配不到 → "No test files found"）且包内 spawn 可能 `ENOENT`。稳的是：
`pnpm exec vitest run packages/<pkg>/tests/<file>.test.ts`（根工作区跑，能正确匹配 include 模式）

### 6. workspace 包名解析

pnpm workspace 下裸 ESM `import '@scope/pkg'` 从 `scripts/` 或任意位置跑 → `ERR_MODULE_NOT_FOUND`。临时脚本 import 包 `dist/index.js` 的**相对/绝对路径**，或用包内 cwd + 包导出。`.mjs` 不能有 TS 类型注解，写纯 JS。

## Pitfalls

- `Select-Object -First N` 截断输出会吃掉报错尾部——压测/测试先看 `EXIT=$LASTEXITCODE` 再信 stdout。
- PowerShell `2>&1 | Select` 会把 stderr 包成 `NativeCommandError` 显示，不是命令真的挂了。
- `git diff --no-index` 当文件不同时 exit 1（`[exit code: 1]` 是正常差异信号，不是失败）。
