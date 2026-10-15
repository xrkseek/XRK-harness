/** Xiangyang skill body: ~/.xrk and project .xrk reclaim. */
export const ID = "xrk-xrk-cleanup";

export const BODY = `---
name: xrk-xrk-cleanup
description: >-
  Reclaim disk under ~/.xrk and project .xrk with a keep/delete map.
  Use when the user says litter, cache, full disk, tidy .xrk, or Harness feels heavy.
---

# .xrk 垃圾清理

范围：产品家目录 \`~/.xrk\`（或 \`XRK_HOME\`）与各**编码工作区**的 \`.xrk\`。  
向阳有 full access，可本会话处理；跨项目大清理也可 \`workspace_session_prompt\` 派工。

## 原则

1. **先清单后删除**：列路径 + 体积（或大致大小），对「可能有用」的征得同意。  
2. **优先大文件与明确临时产物**。  
3. **绝不静默删**会话热库、凭据、用户改过的 skills / 记忆正文（除非用户明确要求）。

## \`~/.xrk\` 地图

| 路径 | 默认 | 说明 |
|------|------|------|
| \`settings.yaml\` · \`host-settings.json\` | **保留** | Host / 设置真源 |
| \`.credentials.yaml\` | **保留** | 密钥；勿进聊天 |
| \`sessions/\`（\`sessions.db\` · WAL） | **保留** | 热会话；归档走产品归档，勿手删库图省事 |
| \`sessions-archive.db\`（若有） | **保留** | 归档冷库 |
| \`workspaces.json\` · \`session-models.json\` · \`session-agent-presets.json\` | **保留** | 工作区与徽章钉 |
| \`memories/\` | **保留正文**；可清噪声条目 | 用 \`xrk-memory-polish\`，别整目录 rm |
| \`skills/\` · \`xiangyang-workspace/.xrk/skills/\` | **保留用户改过的** | 产品 seed 可刷新；勿删用户自建 |
| \`plugins/\` | **慎删** | 已装插件；确认无用再卸 |
| \`spill/\` · \`tmp/\` · \`cache/\` · \`logs/\` | **可清** | 工具溢出、临时、缓存、日志 |
| \`memory-embeddings/\` · \`pubmed-cache/\` 等缓存树 | **可清** | 可再生索引/缓存 |
| \`mcp-venvs/\` · \`mcp-cwd/\` | **可清闲置** | 确认对应 MCP 不用 |
| \`community-plugin-mirror/\` | **可清** | 镜像缓存，可再拉 |
| \`run/\` | **慎** | Host pid；勿在 Host 运行中乱删锁 |
| \`cron/\` | **慎** | 用户定时任务 |
| \`attachments/\` · \`canvases/\` · \`checkpoints/\` | **问再删** | 用户产物 |
| \`xiangyang-workspace/\` | **保留目录** | 向阳家；只清其下明确 temp |

## 项目 \`.xrk\`（编码工作区）

| 可清 | 保留 |
|------|------|
| 空 / 过期 recipes、明显 temp、重复草稿 | 用户写的 skills、有意保留的 recipes、工作区 AGENTS |

## 步骤

1. 列候选（路径 + 为何可删）。  
2. 用户确认或明确授权「清缓存」后删除。  
3. 大块删除后若热库虚胖，可提醒：归档会话走产品归档；Host 关闭时可能 VACUUM。  
4. 短摘要回报：删了什么、保留了什么、大约腾出多少。

## 反模式

- 为省事 \`rm -rf ~/.xrk\`。  
- 删 \`sessions.db\` / 凭据当「清理」。  
- 把策展记忆整目录当缓存删掉。
`;
