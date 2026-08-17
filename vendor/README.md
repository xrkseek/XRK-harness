# vendor/

## `deepseek-harness`（上游 Web 源码二次改）

- **真源**：`Desktop\XRKbar\deepseek-harness`（参考仓放 XRKbar，不进 grocery）
- **本目录联接**：`vendor/deepseek-harness` → 上述路径（gitignore）
- **许可**：MIT（Copyright DeepSeek）；二次修改保留 NOTICE

### 命令

```bash
pnpm web:dsh:build      # 在上游树构建 lib + web
pnpm web:dsh            # 上游 Cordis host 起 UI（对照基线，默认 :3080）
pnpm web:dsh:capture    # 抓取 dist + __DSH_BOOT__ + /plugins → vendor/dsh-web-static
```

然后：

```bash
pnpm build
node apps/cli/dist/bin.js serve --preset minimal --workspace .
# 自动优先托管 vendor/dsh-web-static（含 boot.json）
```
.github/workflows/ci.yml
.gitignore
.nvmrc
AGENTS.md
CONTRIBUTING.md
README.md
apps/cli/src/commands/serve.ts
apps/web/NOTICE
apps/web/README.md
apps/web/index.html
apps/web/src/app-shell-entry.ts
apps/web/src/boot-composition.ts
apps/web/src/boot-manifest.ts
apps/web/src/dom.ts
apps/web/src/face-client.ts
apps/web/src/face-console.ts
apps/web/src/main.ts
apps/web/src/shell-controller.ts
apps/web/src/shell/mount-shell.ts
apps/web/src/shell/panels/conversation.ts
apps/web/src/shell/panels/settings.ts
apps/web/src/shell/panels/sidebar.ts
apps/web/src/shell/panels/status.ts
apps/web/src/shell/panels/workspace.ts
apps/web/src/styles.css
apps/web/src/trajectory.ts
apps/web/tests/boot-composition.test.ts
apps/web/tests/boot-manifest.test.ts
apps/web/tests/slot-shell.test.ts
docs/README.md
docs/architecture.md
docs/host-face.md
docs/learn.md
docs/seams.md
docs/status.md
docs/testing.md
docs/tool-pipeline.md
package.json
packages/compose/package.json
packages/kernel/package.json
packages/mcp/package.json
packages/server/face/src/adapt/index.ts
packages/server/face/src/adapt/tool-view.ts
packages/server/face/src/adapt/wire-event.ts
packages/server/face/src/attach-http.ts
packages/server/face/src/context.ts
packages/server/face/src/dispatch.ts
packages/server/face/src/envelope.ts
packages/server/face/src/index.ts
packages/server/face/src/projections/title-controller.ts
packages/server/face/src/runtime.ts
packages/server/face/src/settings-credentials.ts
packages/server/face/src/types.ts
packages/server/face/src/workspace-face.ts
packages/server/face/tests/dispatch.test.ts
packages/server/face/tests/envelope.test.ts
packages/server/face/tests/face-fidelity.test.ts
packages/server/face/tests/settings-credentials.test.ts
packages/server/face/tests/workspace.test.ts
packages/server/host/src/index.ts
packages/server/http/src/boot-inject.ts
packages/server/http/src/index.ts
packages/server/http/tests/static.test.ts
scripts/build.mjs
scripts/check.mjs
.agents/skills/README.md
.agents/skills/dsh-archive-agent-notes/SKILL.md
.agents/skills/dsh-archive-agent-notes/agents/openai.yaml
.agents/skills/dsh-code-review/SKILL.md
.agents/skills/dsh-doc-site-sync/SKILL.md
.agents/skills/dsh-doc-site-sync/agents/openai.yaml
.agents/skills/dsh-doc-standards/SKILL.md
.agents/skills/dsh-find-simplifications/SKILL.md
.agents/skills/dsh-merging-stacked-prs/SKILL.md
.agents/skills/dsh-pre-push-checks/SKILL.md
.agents/skills/dsh-pre-push-checks/agents/openai.yaml
.agents/skills/dsh-prose-standard/SKILL.md
.agents/skills/dsh-prose-standard/agents/openai.yaml
.agents/skills/dsh-prose-standard/references/examples.md
.agents/skills/dsh-translate-docs/SKILL.md
.agents/skills/dsh-translate-docs/agents/openai.yaml
.agents/skills/dsh-trim-cot-leakage/SKILL.md
.agents/skills/dsh-trim-cot-leakage/references/examples.md
.agents/skills/dsh-trim-cot-leakage/references/recall-batteries.md
.agents/skills/record-browser-gif/SKILL.md
.agents/skills/record-browser-gif/agents/openai.yaml
.agents/skills/record-browser-gif/scripts/encode_gif.py
_tmp_mi_pipe_scan.py
_tmp_xy_scan.py
apps/web/public/favicon-mark.png
apps/web/public/favicon.png
apps/web/public/logo-plate.png
apps/web/public/logo.png
docs/assets/favicon-mark.png
docs/assets/logo-hero.png
docs/assets/logo-plate.png
docs/assets/logo-source.png
docs/assets/logo-transparent.png
docs/assets/logo.png
docs/upstream/deepseek-harness/AGENTS.md
docs/upstream/deepseek-harness/README.md
docs/upstream/deepseek-harness/agent-lifecycle.i18n.yaml
docs/upstream/deepseek-harness/agent-lifecycle.md
docs/upstream/deepseek-harness/agent-lifecycle.zh.md
docs/upstream/deepseek-harness/api-gateway.i18n.yaml
docs/upstream/deepseek-harness/api-gateway.md
docs/upstream/deepseek-harness/api-gateway.zh.md
docs/upstream/deepseek-harness/architecture.i18n.yaml
docs/upstream/deepseek-harness/architecture.md
docs/upstream/deepseek-harness/architecture.zh.md
docs/upstream/deepseek-harness/capability-seams.i18n.yaml
docs/upstream/deepseek-harness/capability-seams.md
docs/upstream/deepseek-harness/capability-seams.zh.md
docs/upstream/deepseek-harness/cordis-primer.i18n.yaml
docs/upstream/deepseek-harness/cordis-primer.md
docs/upstream/deepseek-harness/cordis-primer.zh.md
docs/upstream/deepseek-harness/defensive-patterns.i18n.yaml
docs/upstream/deepseek-harness/defensive-patterns.md
docs/upstream/deepseek-harness/defensive-patterns.zh.md
docs/upstream/deepseek-harness/development.i18n.yaml
docs/upstream/deepseek-harness/development.md
docs/upstream/deepseek-harness/development.zh.md
docs/upstream/deepseek-harness/event-producer-consumer.i18n.yaml
docs/upstream/deepseek-harness/event-producer-consumer.md
docs/upstream/deepseek-harness/event-producer-consumer.zh.md
docs/upstream/deepseek-harness/glossary.i18n.yaml
docs/upstream/deepseek-harness/glossary.md
docs/upstream/deepseek-harness/glossary.zh.md
docs/upstream/deepseek-harness/testing.i18n.yaml
docs/upstream/deepseek-harness/testing.md
docs/upstream/deepseek-harness/testing.zh.md
docs/upstream/deepseek-harness/tool-execution-pipeline.i18n.yaml
docs/upstream/deepseek-harness/tool-execution-pipeline.md
docs/upstream/deepseek-harness/tool-execution-pipeline.zh.md
packages/server/face/src/adapt/wire-ids.ts
packages/server/face/src/host-directory.ts
packages/server/face/src/workspace-registry.ts
packages/server/face/tests/host-directory.test.ts
packages/server/face/tests/wire-event.test.ts
scripts/capture-dsh-web.mjs
scripts/cut-logo.py
vendor/README.md
为什么要提交一大堆项目的参考，你可以自己参考自己看，但是不要提交，别人看见应该是只有一个学习参考的文档，剩下都是项目正经文档和文件
