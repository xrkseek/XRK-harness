/** Xiangyang skill: reclaim hub — path map lives in xrk-product-home. */
export const ID = "xrk-xrk-cleanup";

export const BODY = `---
name: xrk-xrk-cleanup
description: >-
  向阳清盘：跨仓 reclaim ~/.xrk 与项目 .xrk。路径表 → skill xrk-product-home。
  Use when litter / cache / full disk / tidy .xrk.
---

# .xrk 清理（向阳）

Load **\`xrk-product-home\`** for keep/delete map. Here:

1. Inventory path+size first. Ask before "maybe useful".
2. Clear safe: \`spill/\` · \`tmp/\` · \`cache/\` · \`logs/\` · rebuildable embeddings/caches.
3. **Never** silent-delete \`sessions.db\` · credentials · user-edited skills/memory bodies.
4. Large coding-tree sweeps → \`workspace_session_prompt\` peer; keep \`session_id\`.

Anti: wipe product home to "save space" · paste secrets into chat.
`;
