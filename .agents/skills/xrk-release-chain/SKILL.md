---
name: xrk-release-chain
description: >-
  XRK-harness 发包链的既有副作用与终态判据：root devDeps 被 stage 清掉、
  大 tarball 上传不能用分离进程、E409/E403 处理、文档中英成对四处一起改。
  还含整条流水线顺序与「push 必须先于 release，否则 tag 落在旧 HEAD」这个坑。
  跑 release、npm publish、发 GitHub release、委派发版或修发布文档时使用。
  桌面包打完要上 AGT 更新源时叠 skill `xrk-desktop-update-feed`。
---

# XRK-harness 发包链（副作用清单）

发 XRK-harness 版本号/发包时，以下副作用与终态判据都实际踩过，先读再跑。

## When to Use

- 跑 `release` / `publish` / `npm publish` / `gh release`
- 用户说「发版 / 发布这一版 / release 一下」——整条流水线（含 push）由你负责
- 改版本号（`docs/releases/README.md`、`docs/publishing.md` 等）
- 遇到 `E409` / `E403` / `missing node_modules/typescript` / 上传无进度

## Procedure

### 0. 流水线顺序：先 push，最后才 release

顺序是硬的：**检查更新 → 分批 commit → `pnpm check` → push → 根依赖 → release →
打包桌面包 → 校验**。桌面包排在 release 之后（版本号先定下来），且它从工作树构建，
所以 commit 必须更早落地。

**push 必须先于 `pnpm release`**。`gh release create` 在 tag 不存在时，是拿**远端默认分支的 HEAD**
建 tag，不是你本地的工作区。本地没 push 的 commit 一个都进不去 —— 而 npm tarball 是从本地
工作区打的，于是「GitHub tag 源码 ≠ npm 包内容」，两边对不上，还很难第一时间看出来。

v0.5.11 实测：本地 ahead 8 个 commit 就直接 release，tag 落在 `4b9c445`（上一版代码），
GitHub Release 发布成功、npm 包内容正确，只有源码 tag 是错的。

收尾必查（一条命令定位）：

```
git fetch origin --tags
git rev-parse HEAD; git rev-parse origin/main; git rev-list -n 1 v<ver>
gh api repos/xrkseek/XRK-harness/git/ref/tags/v<ver> --jq '.object.sha'
```

三个 sha 必须一致。已经发歪了就 `git push origin main` + `git tag -f v<ver>` +
`git push --force origin v<ver>`（force 推 tag 属破坏性操作，**先问用户**）。

### 1. 终态判据（成功 = 收尾，不轮询）

- 包文档 `time[<版本>]` 出现且 `modified` 今天；
- 拿到 `+ @scope/pkg@version` 即认定发布成功收尾。
- 收尾动作交给用户一条命令或一次性后台任务，**不轮询 `npm view`**。
- 125 MB 的 CLI 包 publish 返回 ok 后，registry 文档里 `time[ver]` 可能还查不到、
  `dist-tags.latest` 还指着上一版 —— 这是大包传播延迟，**不是失败**，别去重发。

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

### 5. 文档中英成对，四处一起改；侧栏版本公告同步

- `docs/releases/README.md`：中英两半表（当前行 + 上一版行 + 承接链 + 安装速查）
- `docs/publishing.md`：GitHub 公开页保留清单也各一份（zh 约 L79 / en 约 L164）
- **`packages/client/ui-release-notes/src/client/release-notes.ts`**：`RELEASE_NOTES` 顶部追加本版（newest first）；测里钉死的 `latestReleaseVersion()` 一并改。漏改则侧栏铃铛公告停在旧号。

改版本号**四处一起改**——v0.4.1 那次英文半表漏改、仍停在 v0.4.0，隔一版才发现。侧栏公告是第五处，发版同轮必写。

### 6. 打包桌面包（release 之后，约 20 分钟）

本机无签名凭据，走 unsigned，只有 win-x64 可用：

```
$env:XRK_DESKTOP_UNSIGNED='1'
$env:XRK_DESKTOP_PACKAGE='1'
pnpm package:desktop 2>&1 | Tee-Object -FilePath .release/desktop-package-<ver>.log
```

- **不设 `XRK_DESKTOP_PACKAGE=1` 只写 `package-plan.json`，不产包**——最常见的「以为打包了」。
- `XRK_DESKTOP_UNSIGNED=1` 只允许 win-x64（否则抛 `unsigned packaging is Windows-only`）；
  正式目标 `win-x64 | mac-arm64 | mac-x64` 用 `XRK_DESKTOP_TARGET` 指定。
- electron / electron-builder / electron-updater 是 optionalDependencies，装在
  **`apps/desktop/node_modules`**，不是根。
- **静默是正常的**：`build:desktop` → runtime `pnpm install`（~700 包）→ host bundle →
 electron-builder packaging → nsis 压 1.1 GB 的 win-unpacked。nsis 阶段 `7za` 吃 CPU、
 日志和 `*.nsis.7z` 大小都不动。别用短 sleep 循环刷状态，用后台 job + `job_output(wait:true)`。
- 产物 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/` 下
  `xrk-harness-<ver>-win-x64-unsigned.exe`（~315 MB）+ `.exe.blockmap`；
  **同名同版本直接覆盖**旧包，这是重打补丁包的预期结果。
- 完成判据：日志尾 `package-desktop: wrote … package-complete-*.json`（测试源开启时）
  或 `unsigned build — no update feed / package-complete`（未开 `UNSIGNED_UPDATE`），
  前面还有 `smoke packaged Host loopback Face` 与 `restore workspace node_modules`，
  且 `win-unpacked/resources/` 下 `host` / `web` / `runtime` 都是本轮时间。
- **发新桌面版必须上 AGT 更新源**：顺序见 skill **`xrk-desktop-update-feed`**
  （改名去 `unsigned` → **先传 nightly/latest.yml** → 再传 exe/blockmap → 核对 HEAD 大小）。
  不要整目录盲传旧版；不要 `C:\xrk-h` junction。

## Pitfalls

- **PowerShell 把 git 的 stderr 进度行当错误**：`git push` 成功时输出
  `4b9c445..03281ea7 main -> main` 走的是 stderr，`$LASTEXITCODE` 可能也是 1。
  判成功要看**结果行**，不要看 exit code / 红色报错。
- **`gh` / GitHub API 的代理**：这台机子直连和 Clash 7897 常都能通，但**先各探一次**
  （`gh api user --jq .login`）再决定设不设 `$env:HTTPS_PROXY`/`$env:HTTP_PROXY`；
  `registry.npmjs.org` 直连可达，别给 npm 强塞代理。
- 发布产物不一致：GitHub asset 前缀 `<dir>/` vs npm tarball `package/`——字节与
  清单都不同，各自用对应清单核对。
- `npm_config_fetch_timeout` 保持默认 300s（曾设 60s 把大包上传掐死，日志
  `verbose type request-timeout` / `FETCH_ERROR`）；`fetch_retries` 保持默认。
- 面板里看不到大上传属正常，用 `Get-NetAdapterStatistics` 的 SentBytes 差值判断
  是否真在传（见 `xrk-github-npm-net`）。
- `package-plan.json` 里中文根目录被写成 `\X` 之类无效转义，`ConvertFrom-Json` 会报
  「无法识别的转义序列」——那是旧 plan 的编码问题，**不是打包失败**，别据此重跑。
