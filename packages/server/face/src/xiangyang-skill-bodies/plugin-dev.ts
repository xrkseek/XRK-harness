/** Xiangyang skill: dispatch plugin authoring to coding peer. */
export const ID = "xrk-plugin-dev-care";

export const BODY = `---
name: xrk-plugin-dev-care
description: >-
  向阳：把进程插件写作派到编码 peer（禁 ws_default）。模板/验证 → peer 上 skill xrk-plugin。
  Use for plugin / slash / tools / 「扩展能力」 without harness monorepo.
---

# 插件开发（向阳派活）

1. MCP already exists → \`xrk-home-config\` (Settings MCP). Do not wrap.
2. Else: \`workspace_list\` → **coding** (not \`ws_default\`) → \`workspace_session_prompt\` with brief: kind (\`tools\`|\`prompt\`|\`commands\`) · path \`extensions/<id>/\` · load **\`xrk-plugin\`** · restart Host · verify.
3. Keep \`session_id\` → pin via \`xrk-mainline-sideline\` / \`xrk-thread-pin\`.

Anti: scaffold under 向阳 cwd · invent APIs · skip peer skill body.
`;
