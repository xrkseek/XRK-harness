---
name: xrk-release-chain
description: >-
  XRK-harness 发包链的既有副作用与终态判据：root devDeps 被 stage 清掉、
  大 tarball 上传不能用分离进程、E409/E403 处理、文档中英成对四处一起改。
  跑 release、npm publish、发 GitHub release 或修发布文档时使用。
---

# XRK-harness 发包链（副作用清单）

发 XRK-harness 版本号/发包时，以下副作用与终态判据都实际踩过，先读再跑。

## When to Use

- 跑 `release` / `publish` / `npm publish` / `gh release`
- 改版本号（`docs/releases/README.md`、`docs/publishing.md` 等）
- 遇到 `E409` / `E403` / `missing node_modules/typescript` / 上传无进度

## Procedure

### 1. 终态判据（成功 = 收尾，不轮询）

- 包文档 `time[<版本>]` 出现且 `modified` 今天；
- 拿到 `+ @scope/pkg@version` 即认定发布成功收尾。
- 收尾动作交给用户一条命令或一次性后台任务，**不轮询 `npm view`**。

### 2. 先装根依赖再跑 stage（副作用 1）

release 的 stage 步骤会在根工作区跑一次类 `--production` 安装，把根 devDeps
（typescript/eslint/vitest/prettier）清掉 → 同轮第二次跑 release 死在
`stage: missing node_modules/typescript`。必须先：

```
CI=true pnpm install --frozen-lockfile
```

（不设 `CI` 则 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）。发布完再装回来。

### 3. 大 tarball 上传用 bash 后台任务（副作用 2）

CLI tarball 约 120 MB，`npm publish` 的 PUT 远超默认时间预算。用 `bash` 后台任务并在**同一轮** `job_output(wait:true)` 等到底（`Start-Process` 分离进程会在对话轮次边界被回收——日志与退出码文件同时冻结、无报错）。

### 4. E409 / E403 处理

- `E409 Cannot publish over previously staged version` = 孤儿 staged →
  `npm unpublish --force` 清。
- 清后 `E403` = 上次 PUT 已落地（文档已有该版本），**读文档确认，别再发**。

### 5. 文档中英成对，四处一起改

- `docs/releases/README.md`：中英两半表（当前行 + 上一版行 + 承接链 + 安装速查）
- `docs/publishing.md`：GitHub 公开页保留清单也各一份（zh 约 L79 / en 约 L164）

改版本号**四处一起改**——v0.4.1 那次英文半表漏改、仍停在 v0.4.0，隔一版才发现。

## Pitfalls

- 发布产物不一致：GitHub asset 前缀 `<dir>/` vs npm tarball `package/`——字节与
  清单都不同，各自用对应清单核对。
- `npm_config_fetch_timeout` 保持默认 300s（曾设 60s 把大包上传掐死，日志
  `verbose type request-timeout` / `FETCH_ERROR`）；`fetch_retries` 保持默认。
- 面板里看不到大上传属正常，用 `Get-NetAdapterStatistics` 的 SentBytes 差值判断
  是否真在传（见 `xrk-github-npm-net`）。
