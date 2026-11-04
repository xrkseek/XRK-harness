# 0.7.10 发版复盘

- 四区记忆注入修复 + 过程头对齐 + USER.md 可写 + cap 可配 + TTS 引导移除。
- 踩坑：npm 传播延迟（0.7.10 初查 404，等待后 shasum 对上）；AGT SSH 首次 EOF（重试成功）；pnpm check 并发 5 个 5s 超时（隔离复跑全绿）。
- 最险：release stage 掏空根 devDeps（已按流程 install 回）。

