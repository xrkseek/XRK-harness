# Learn

本项目实现时学习了业界 agent harness 的常见做法，规格与代码以本仓为准。

## 学到并落在本仓的要点

- **Session 事件为对话真源**：模型可见输入可从事件日志重建；turn / loop 短寿
- **工具瀑布**：pre → guards → execute → post → finalize → settle；显式 pipeline，无全局 proxy
- **能力缝**：Definition / Provider / Consumer；exec 与 tools 解耦
- **Host Face**：Unary RPC + mux/host 双流；未实现方法诚实 `not-implemented`
- **组合叶**：`@xrkseek/compose`；presets 只接线不写业务

细节见 [architecture.md](./architecture.md) · [tool-pipeline.md](./tool-pipeline.md) · [seams.md](./seams.md) · [host-face.md](./host-face.md)。

## 运行时

- **Node ≥ 26**（`.nvmrc` · `package.json` engines · CI）
