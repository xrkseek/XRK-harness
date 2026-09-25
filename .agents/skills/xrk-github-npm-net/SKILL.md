---
name: xrk-github-npm-net
description: >-
  GitHub/npm 网络探测：api.github.com 直连 vs 代理（Clash 7897）哪条通会变，调 GitHub
  API 前先各探一次；registry.npmjs.org 与 release asset 下载一直直连可达；npm 大上传
  面板看不到属正常，用网卡计数器判真实流量。gh/npm 超时、EOF、10060 时使用。
---

# GitHub / npm 网络探测

这台 Windows 机（Clash Verge 内核 verge-mihomo，系统代理 `127.0.0.1:7897`，**node/npm 不读系统代理**）上，GitHub API 的连通性**会反转**，别固定一条。

## When to Use

- `gh` / `curl` GitHub API 报 `EOF`、`10060`（connect timeout）、`error checking for existing release`
- `npm publish` / `pnpm` 上传或装包超时
- 判断「面板里看不到上传进度」是不是真在传

## Procedure

### 1. 调 GitHub API 前先各探一次

`api.github.com` 哪条网通会变（2026-09-24 实测直连可用、走代理反而 EOF；更早相反——直连 10060、必须给 `HTTPS_PROXY`）。探法：

```
gh api repos/<owner>/<repo>/releases/tags/<tag>
```

- 返回 **404** = 网络通（资源不存在但请求到达）
- `EOF` / timeout / 10060 = 这条不通 → **换另一条**（`HTTPS_PROXY=http://127.0.0.1:7897` 或去掉）

### 2. registry.npmjs.org 与 release asset 下载一直直连可达

npm registry 与 GitHub release asset 下载**从不走代理**（node/npm 不读系统代理）。大 tarball 上传/下载超时 → 先试直连，别一上来套代理。

### 3. npm 大上传：面板看不到 = 正常

CLI 面板里看不到 npm 大上传（如 120MB tarball）的进度条属正常——npm 的上传进度不打到面板。用网卡计数器判真实流量：

```powershell
Get-NetAdapterStatistics
# 记下 SentBytes 基线 → 上传中再取一次 → 差值在涨 = 真在传
```

## Pitfalls

- 别凭上一次会话的记忆固定「必须代理」或「必须直连」——**每次调 GitHub API 前探一次**，两个方向都试。
- `gh api` 的 EOF 和 `error checking for existing release: ... EOF` 都是网络层报错，不是仓库/权限问题。
- `npm_config_fetch_timeout` 默认 300s；**绝不要调低**（曾设 60s 直接把大包上传掐死，日志表现为 `verbose type request-timeout` / `FETCH_ERROR`）。`fetch_retries` 也别往下调。