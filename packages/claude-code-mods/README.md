# @xrkseek/claude-code-mods

Run **Claude Code plugins (mods)** inside this harness: read
`.claude-plugin/plugin.json` + `hooks/hooks.json`, import the hook modules with
the native ESM loader, run their `register(on)` handlers as one middleware
chain, and serve the `$` API from our own tool pipeline and services.

A plugin author changes nothing — you ship the same directory that
`claude --plugin-dir` accepts.

```
my-plugin/
  .claude-plugin/plugin.json     { "name": "my-plugin", "version": "0.1.0" }
  hooks/hooks.json               { "modules": ["./my-plugin.mjs"] }
  hooks/my-plugin.mjs            export function register(on) { … }
```

## Use

The shipped runtime (`core-agent` / `core-tools`, no Cordis container in the
request path) uses `createModsRuntime`:

```ts
import { createModsRuntime } from "@xrkseek/claude-code-mods";

const mods = await createModsRuntime({
  services: { fs, subprocess, commands, tools, workingDirectory, storageDomain },
  pipeline, // the composition's ToolPipeline
  agentOf: ({ call }) => agentForSession(call),
  dirs: ["~/.xrk/plugins/claude-code/my-plugin"],
});

await mods.dispatch("prompt.submit", { text }, () => ({ text }), { agent, signal });
await mods.dispose();
```

A Cordis composition (tests, or a host that already runs one) uses
`attachClaudeCodeMods`:

```ts
import { attachClaudeCodeMods } from "@xrkseek/claude-code-mods";

const mods = await attachClaudeCodeMods({
  ctx,
  pipeline, // the composition's ToolPipeline
  dirs: ["~/.xrk/plugins/claude-code/my-plugin"],
  agentOf: ({ call }) => agentForSession(call),
});

// live now: a plugin observes, refuses, or rewrites every tool call
// other events are raised by the host on its own seam:
await mods.dispatch("prompt.submit", { text, messages }, () => ({ text }), {
  agent,
  signal,
});
```

`definePluginDir(dir)` is usable on its own: it turns a plugin directory into an
ordinary Cordis plugin (`ctx.plugin(...)`) for hosts that do not want the tool
interceptor installed.

## Product wiring

`presets/harness/mods.ts` is the only place that knows the tool pipeline, the
filesystem seam, and the session identity at once. `createHarnessComposition()`
uses it to:

1. `await mods.attach(handle)` in `createAgent()` — raises `session.start`, then
   hands back `mods.wrap(handle)`;
2. wrap `continueTurn` / `run` — `prompt.submit` (a plugin may rewrite or drop
   the turn), then `turn.start`, then `turn.complete` on both the answer and the
   error path;
3. `await mods.dispose()` first in `dispose()` — `session.end` runs while
   `$.state` is still readable, and only then do the seams come down.

Plugins live at `~/.xrk/plugins/claude-code/<name>/.claude-plugin/plugin.json`
by default; `createHarnessComposition({ claudeCodePluginsRoot })` points
somewhere else. A missing directory means "no plugins installed" and costs the
composition nothing.

Inside a composition `$.fs`, `$.process`, `$.store` and `$.session` are the
product's own services (workspace-confined fs, the shell's own subprocess, a
`.state/` directory beside the plugins, the session cwd). Everything else fails
with the service name:

| Call                                  | Result in the product                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `$.tool.list`                         | the product registry's `name` / `description` (never `execute`)                        |
| `$.tool.register`                     | lands in the product registry as `mcp__<plugin>__<tool>`, dropped with the session     |
| `$.tool.call`                         | runs the product `ToolPipeline` (policy, sandbox, other plugins' hooks), returns text  |
| `$.command.register` / `run` / `list` | the composition's own table: listed in Face's `/` panel, a typed `/name` dispatches it |
| `$.ui.ask`                            | throws (no question surface yet)                                                       |

Plugin tools are named `mcp__<plugin>__<tool>` (Claude Code's namespace rule) and are
registered `direct`, so the model sees them immediately. Their `execute` is still a
placeholder that rejects: the result has to come from
`on('tool.call', { tool: 'mcp__<plugin>__<tool>' }, …)`. With no hook answering, the
model reads "no tool.call hook answered it" — a diagnosable failure, not an empty result.

The per-method wiring matrix (9 events × 36 `$` methods, including _why_ each gap is a
gap) lives in [`docs/claude-code-mods-wiring.md`](../../docs/claude-code-mods-wiring.md).
Change either side, update that table.

## Events

| Event                          | Raised here by                                                         | A hook may                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `tool.call`                    | **wired**: `ToolPipeline.onPre` / `onExecute` / `onPost`               | observe, `{ deny }`, answer before dispatch with `{ result }` (body skipped), or replace after `next` |
| `session.start`                | **wired**: harness composition, before `createAgent()` returns         | observe; register commands and tools                                                                  |
| `prompt.submit`                | **wired**: harness composition, before `continueTurn`                  | rewrite `text`, `{ drop }`; `context` has no seam here and is reported then dropped                   |
| `turn.start` / `turn.complete` | **wired**: harness composition, around `continueTurn`                  | observe; `{ text }` for the host log                                                                  |
| `command.run`                  | **wired**: `$.command.run`, and harness composition on a typed `/name` | answer `{ text }` or `{}`                                                                             |
| `ui.render`                    | ✅ AbovePrompt band (`session/band` + `ModBandDock`)                   | return a `Box`/`Text`/`Button` tree, or `next`                                                        |
| `session.end`                  | **wired**: harness composition, first thing in `dispose()`             | observe; `$.state` still readable                                                                     |

Unwired events are not silently broken: they can be registered, never fire, and
are named in a load-time warning — the same deal Claude Code gives an event it
never raises.

Tool names translate both ways (`Bash` ↔ `bash`), for `e.tool` and for matchers.

## `$` surface

`plugin`, `ui`, `command`, `tool`, `prompt`, `session`, `state`, `store`,
`clock`, `fs`, `process`, `http`, `env` — all implemented **by the bridge**. A
service the deployment did not compose fails the call with the package name;
anything outside the table rejects with `no implementation for <namespace>.<method>`.
Which method actually runs inside this product's composition is the matrix in
[`docs/claude-code-mods-wiring.md`](../../docs/claude-code-mods-wiring.md).
See `README.zh.md` for the per-method table and the security boundary
(plugins run with the host process's full privileges).

## Differences from the upstream bridge

Ported from `@deepseek-ai/dsh-experimental-claude-code-mods` (v0.2.1-rc.3).
Chain, engine and `$` semantics match; the differences are the host seams and
four self-supplied dependencies (`storage-domain`, `working-directory`,
`deepFreeze`/`JsonValue`, `randomUUID`). `README.zh.md` carries the full table.

## Tests

```
npx vitest run packages/claude-code-mods/tests
```

63 tests, including real plugin directories driven through a real
`ToolPipeline`: refuse → tool error, pass → body runs, rewrite after `next`,
pipeline restored after `dispose`.

## License

MIT
