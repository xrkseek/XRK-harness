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
（typescript/eslint/vitest/prettier）清掉。这一轮发版里这个清空**会触发两次**，
伪装成两个完全不同的症状：

| 症状 | 真实原因 |
|---|---|
| `pnpm release` 打印 `release: GitHub Release … ok` 后**静默 exit 1**，npm 一行 publish 输出都没有 | `npmPack()` 跑在已被掏空的根目录 → 死在 `npx npm@10.9.2 pack` |
| `pnpm package:desktop` 报 `'tsc' is not recognized` 且中途 abort、不执行 restore | 同一个 deps-status check 在 build 之前就要求 devDeps |

两条都是 `CI=true pnpm install --frozen-lockfile` 装回后一次通过。
release 静默失败时最快的复现：`XRK_RELEASE_SKIP_UPLOAD=1 pnpm release`——绕过 GitHub 上传
直接暴露 stage 问题，GitHub Release 已建、重跑走 `--clobber` 分支不会产生重复 Release。

```
CI=true pnpm install --frozen-lockfile
```

（不设 `CI` 则 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`；`CI` 是 pnpm 自己的开关、**非代理**，
可放心设。）**release 一成功就立刻装回**，别等打包报错再补。

动作要写成显式一步，否则第二次清空会以全新症状出现（v0.6.5 真实白跑一轮）：

```
pnpm release
CI=true pnpm install --frozen-lockfile     # ← 紧接着，不要中间插入 package:desktop
pnpm package:desktop
```

`pnpm package:desktop` 内部的 `build:desktop` 也依赖根 `tsc`；跳过装回就直接打包，报的是
`apps/desktop build: 'tsc' is not recognized`，看着像桌面构建坏了，其实还是副作用 1。

### 3. 大 tarball 上传用 bash 后台任务（副作用 2）

CLI tarball 约 120 MB，`npm publish` 的 PUT 远超默认时间预算。用 `bash` 后台任务并在**同一轮** `job_output(wait:true)` 等到底（`Start-Process` 分离进程会在对话轮次边界被回收——日志与退出码文件同时冻结、无报错）。

### 4. E409 / E403 处理

- `E409 Cannot publish over previously staged version` = 孤儿 staged。
  **但 `npm unpublish --force <pkg>@<ver>` 对「从未真正落成的版本」无效**：它会打印成功
  （`- @xrkseek/harness-cli@0.6.5`）却清不掉 staging slot，下一次 PUT 仍是 E409（v0.6.5 实测每
  一次 94s）。**别拿 unpublish 当解法反复试**，也别据此断定包已存在。
- 正确处置：E409 出现后**改为轮询 version doc**
  （`curl -s -o NUL -w "%{http_code}" https://registry.npmjs.org/@scope%2Fname/<ver>`）。
  v0.6.5 的 CLI 就是这么落地的：几次 E409 之后直接变 **`E403` + doc `200`** —— 说明先前那条
  「超时的 138 MB PUT」其实已被 npm 的异步流水线收下并写成了。
- 这是「PUT 202 ≠ 落地」的**镜像情形**：**超时 ≠ 未落地**。两头都不能凭客户端的报错下结论，
  只认 registry 的 version doc 与 `dist.shasum`。
- 已落地（doc 200）后再发只会 `E403`，此时**读文档确认，别再发**。

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
  （改名去 `unsigned` → **先传完整 exe/blockmap** → 再传 nightly/latest.yml → 核对 HEAD 大小）。
  yml 必须写**明文 IP 绝对 URL**（`http://IP:6969/api/harness/desktop/bin/win-x64/…`）——
  不是 HTTPS 域名、不是相对文件名，写错会 403 / checksum mismatch。
  不要整目录盲传旧版；不要 `C:\xrk-h` junction。

## Pitfalls

- **PowerShell 把 git 的 stderr 进度行当错误**：`git push` 成功时输出
  `4b9c445..03281ea7 main -> main` 走的是 stderr，`$LASTEXITCODE` 可能也是 1。
  判成功要看**结果行**，不要看 exit code / 红色报错。
- **`gh` / GitHub API 的代理**：这台机子直连和 Clash 7897 常都能通，但**先各探一次**
  （`gh api user --jq .login`）再决定走哪条；`registry.npmjs.org` 直连可达，别给 npm 强塞代理。
  **绝不设 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` 环境变量**（会破坏用户正常生产生活）。
  要走代理只落在单命令参数上：`curl.exe -x http://127.0.0.1:7897 <url>`、
  `npm publish --proxy … --https-proxy …`、`git -c http.proxy=… -c https.proxy=… push`。
  探活只用 `curl.exe`——Node `https.get` 不读代理**参数**，会给你「直连不通」的假阴性。
  直连 200 也不等于能用（2026-10 撞过 TLS 拦 / `ECONNRESET`），大包别赌直连。
- 发布产物不一致：GitHub asset 前缀 `<dir>/` vs npm tarball `package/`——字节与
  清单都不同，各自用对应清单核对。
- `npm_config_fetch_timeout` 保持默认 300s（曾设 60s 把大包上传掐死，日志
  `verbose type request-timeout` / `FETCH_ERROR`）；`fetch_retries` 保持默认。
- 面板里看不到大上传属正常，用 `Get-NetAdapterStatistics` 的 SentBytes 差值判断
  是否真在传（见 `xrk-github-npm-net`）。
- `package-plan.json` 里中文根目录被写成 `\X` 之类无效转义，`ConvertFrom-Json` 会报
  「无法识别的转义序列」——那是旧 plan 的编码问题，**不是打包失败**，别据此重跑。
- **权限档热切换会让编排锁重入**：`exec/fs` 改 live getter 后 `/permission` 不再 invalidateAgent，但
  IM / 向阳的 `ensureOrchestrationFullAccess` 若直接落 `applyPermissionPreset`，**fork 会把权限事件重复写进
  child 日志**——seed 常只带 `permission/preset` 一条，此时 `derivePermissionSelect` 读成 `custom`，于是每次
  重入补一整组 preset+sandbox+approval。v0.6.1 实测由
  `fork-policy.test.ts > keeps legacy beforeSeq as a raw exclusive offset` 的 `eventCount` 1→4 暴露。
  判据认 `foldPermissionKnobs().preset` 这个**持久身份**，不是派生 select。
- **给「幂等」写的钉子测试要先做变异验证**：v0.6.1 第一版钉子拿「完整锁定的会话」当前提，撤掉 guard 后仍全绿
  （`applyPermissionPreset` 对完整锁定本来就幂等）——假绿。钉子必须复刻被修的形状（只带 `permission/preset`
  的 seed），并先断言派生值**不等于** full access 把前提钉死。收尾前临时注释掉修复本体，确认目标用例变红再恢复。
- **flaky 判定不能只看一次隔离复跑**：`packages/server/face/tests/session-tools-skill-source.test.ts`
  在全量并发下报 `create failed`，隔离与 face 目录复跑都绿（957s collect / 并发抢 temp 目录）；同轮
  `hot-plugin-shapes > billing endpoints` 5000ms timeout 亦属此类。判真实回归的硬标准是**隔离复跑仍红**
  （如 v0.6.1 的 fork-policy），否则不阻塞发版。v0.6.4 一次全量报 4 红
  （`host/tests/workflow-engine-mount`、`http/tests/dsh-update`、`http/tests/git-graph`、
  `http/tests/hot-plugin-shapes`），全是 `Test timed out in 5000ms`（collect 1293s），**逐文件隔离复跑
  30/30 全绿** → 同一家族，不阻塞。v0.6.5 全量 **559 个文件只有 1 红**
  （`host/tests/workflow-engine-mount > soft-skips when xrk-workflow import fails`，5000ms timeout），
  **隔离复跑 3/3 绿、该用例 602ms** → 判掉。
- **同一次 `check` 里 flaky 与真实回归会混着出现，别一律判掉**：v0.6.5 的 `check` 实际是三样东西叠在一起
  —— 1 个 vitest 超时（flaky，判掉）+ **1 个真实 `tsc` 错** + **3 个真实 eslint 错**。后两类隔离复跑照样红，
  必须修：`ruleset.ts` 的 `TS2345` 是窄化写错了——`ACTIONS.has(action as PolicyRuleAction)` 这种
  断言式检查**不会把 `string` 窄化成联合类型**，传给只收 `"deny" | "ask"` 的 `kindWide` 就报错；
  正解是把变量本身绑成 `PolicyRuleAction | undefined`，而不是在使用点强转。eslint 三条
  （`prefer-const` / `no-extra-boolean-cast` / `no-useless-assignment`）全在**本轮新增文件**里，逐条手改、
  没用 `--fix`，以免顺手改动别人的代码。
- `check` 是**失败即退**的，所以它一红就看不到后面的段。v0.6.5 因此单独补跑了
  kernel coverage（exit 0，Statements 99.04% / Lines 99.04% / Functions 100%）才算把这一环验完。
- **`release.mjs` 的真实顺序**：stage-cli → stage-sdk → **建 GitHub Release（挂两个 tgz）** →
  `publishStage(CLI)` → `publishStage(SDK)`。所以 GH Release 存在 ≠ npm 已发。
- **`FETCH_ERROR` 必须先分清落在哪一步，两种结论相反**：CLI tarball 约 138 MB，npm 客户端在
  **PUT 之后**还要回拉 packument 做确认，这一步超时报 `code FETCH_ERROR` 而**上传往往已成功**；
  但 **PUT 本身**超时（v0.6.5 的 CLI 连报 3 次，debug 日志
  `http fetch PUT … attempt 1/2/3 failed` / `verbose type request-timeout`，且 version doc 404）
  则是**真失败**。只看错误码判不了——必须去 npm debug log 里 `http fetch PUT` 那一行**有没有状态码**：
  有 `201`/`202` = 已受理，无状态码 + attempt 重试 = 真没传上去。
- **CLI publish 报错 exit 1 会连坐跳过 SDK publish**：`publishStage(CLI)` 与 `publishStage(SDK)` 串行，
  前者非零退出后者根本不会跑。补救不是重跑 `pnpm release`（会重 stage 十几分钟并撞已存在的 CLI 版本），
  而是手动在 `.release/harness` 用同款凭据补：写 `.npmrc`（`//registry.npmjs.org/:_authToken=$env:NPM_TOKEN`）
  → `npx --yes npm@10.9.2 pack` → `npx --yes npm@10.9.2 publish <tgz> --access public`。
  手里没有 `NPM_TOKEN` 时，`.release/harness-cli/.npmrc`（`publishStage(CLI)` 写的）里就是同一枚 token，
  `Copy-Item` 到 `.release/harness/.npmrc` 即可、不必回显；`npm whoami` 出账号名且上一版同包 tarball
  `HEAD 200` 就说明凭据可用（`.release/` 已 gitignore，token 不会入库）。
- **PUT 返回 `202 Accepted` 是异步接收，不等于落地**：npm 仍会照打 `+ <pkg>@<ver>` / `exit 0` / `info ok`
  （debug 日志 `http fetch PUT 202 … 14125ms`），但紧随其后的**数分钟**里 `npm view` 的 `versions` 查不到、
  version doc 与 tarball 全 404 —— v0.6.4 的 SDK（36.5 MB）实测约 **4 分钟**、v0.6.5 约 **4–6 分钟**
  后才出现。**别在这个窗口里判失败重发**（会 `E409 Cannot publish over previously
  staged version`）。终态判据只有两条：
  `curl -s -o NUL -w "%{http_code}" https://registry.npmjs.org/@scope%2Fname/<ver>` = 200，且
  `npm view <pkg>@<ver> dist.shasum` 与上传时 npm notice 的 `shasum` **逐字一致**（v0.6.4 是
  `3a9161abce8fa09c4559b868cc93ac5d8109d8cf`）；`time.<ver>` 这类字段可能更晚才补上，别当判据。
  npm 在 202 之前会多打一行很有用的信号：`npm notice Your package is being processed and may take
  a few minutes to become available.` —— **同时看到这行和 `+ <pkg>@<ver>` 就应当判定成功并收工**，
  不必等 doc 转绿（v0.6.5 的 SDK 即如此）。
- **tag 里的 `apps/site/releases.json` 恒落后一版，是预期而非漏发**：下载页要等桌面 exe 打出来才能填
  真实 filename，所以 `chore(site)` commit 必然落在 tag 之后（v0.6.4 的 tag 里写着 0.6.3，v0.6.3 的 tag 里
  写着 0.6.2）。核版本别拿 tag 里的 releases.json 当判据，看 **main HEAD**。
- **GH Release 的 SDK tgz 与 npm 上发布的 tarball 不是同一份字节**：`stage-sdk-release.mjs` 生成
  `.release/xrkseek-harness-<ver>.tgz`，`publishStage` 内部又 `npm pack` 一次（`<stage>/…tgz`），两者
  size/hash 都不同（v0.6.4：36856813 vs 36542179）。这是固有现象，别当成错版。
- **`pnpm install` 有时会往 `pnpm-workspace.yaml` 追加 `minimumReleaseAgeExclude`**（v0.6.4 是三条
  `@rollup/rollup-*@4.64.8`）。它是 pnpm 为绕过 minimumReleaseAge 闸门一次性写入的，**不入库**：
  `git checkout -- pnpm-workspace.yaml` 后 `CI=true pnpm install --frozen-lockfile` 仍 exit 0 且不会重写。
  **这条是有条件的、不是每轮必现**——v0.6.5 整轮 `git diff pnpm-workspace.yaml` 全程为空。
  别把它当每次都要处理的固定仪式，但收尾 `git status` 时看到就还原。
- **`upload:desktop` 产出的 mirror 文件名仍带 `-unsigned`**，且 yml 的 `url`/`path` 也指向
  `…-unsigned.exe`。上 AGT 前必须**复制改名去 `unsigned`** 并手写 `nightly.yml` / `latest.yml`
  （`version`/`files[0].url`/`path`/`sha512`/`size`/`releaseDate`，LF 行尾、url 用明文 IP 绝对路径），
  再**先传 `desktop/bin` 后传 `desktop/win-x64`**（yml 最后，避免更新端拿到 yml 却 404 到 exe）。
  收尾核对三处：本地 exe sha512 == yml sha512 == 远端 `Content-Length` == `package-complete` 的 size。
- **yml 的 sha512 要自己算，别只核长度**：本地制品一直留在
  `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`（历代版本都在，v0.6.5 实测在位），
  所以**不必拉回 345 MB**，直接对本地 exe 算再与 yml 比对即可：

  ```powershell
  $hex = (Get-FileHash $exe -Algorithm SHA512).Hash
  $b = [byte[]]::new(64); for ($i=0;$i -lt 64;$i++){ $b[$i]=[Convert]::ToByte($hex.Substring($i*2,2),16) }
  [Convert]::ToBase64String($b)     # ← 与 yml 的 sha512 字段逐字比对
  ```

  `Get-FileHash` 给的是 hex，electron-updater 的 yml 要的是 **base64**，别直接比字符串。
  v0.6.5 由父会话补算：本地 == yml，`MATCH = True`。
- **`unsigned-artifacts/` 不会自动清理旧版**：里头堆着 0.5.20 起每个版本的 exe + blockmap（每个约
  330 MB）。本轮只新增自己的两个文件，别顺手删——那是历史包的唯一留存地。
