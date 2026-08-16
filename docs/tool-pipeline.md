# Tool pipeline

Order (M1):

```text
tool/call (session, by loop)
  → pre-execute
  → guards (monotonic: deny sticky)
  → execute (around + timeout + retry)
  → post-execute
  → finalizeContent
  → output bound (optional persist)
  → freeze tool/result
  → (batch) safetyNotices → safety/notice
  → (batch) additionalContexts → user/message
```

## Rules

1. **`tool/call` before pre** — `runTurn` appends the call event, then enters the pipeline. Do not append call inside `runTool`.
2. **Guards are monotonic** — once any guard returns `deny`, a later `allow` cannot upgrade it. `abstain` is neutral.
3. **Pre outcomes** — `continue` (optional args rewrite), `deny` (skip body, error result), `ask` (approval hook; default deny if unset).
4. **Execute** — around waterfall; `AbortSignal.timeout` when `timeoutMs` set; retries only for `transientError` up to `maxRetries`.
5. **Post** — `accept` | `block` | `replace`. Use `addAdditionalContext` for generic batch user text; use `addSafetyNotice` for typed `safety/notice`.
6. **Finalize** — may only change the `content` string.
7. **Output bound** — after finalize, model-facing content is capped (default 2000 lines / 50KiB). Optional `persist` stores full text; session/log keeps the truncated view. Host presets use `createWorkspaceToolOutputPersist`. Disable with `createToolPipeline({ outputBound: false })`.
8. **Result is frozen** — `Object.freeze`; mutation throws in strict mode.
9. **Batch** — after all `tool/result` in a step: first `safety/notice` (FIFO), then `additionalContexts` as `user/message`. Multi-call settle defaults to **parallel** with call/result barriers (see [tool-settlement.md](./tool-settlement.md)).
10. **Materialize** — each provider step freezes the tool table (`materializeTools`); settle uses the snapshot. Live replace → `Stale tool call`. Catalog `omitNames` ≠ execution auth (guards still own deny).

## Notes

- Pipeline is an explicit `ToolPipeline` object (no global proxy bus).
- Approval is a single hook (`ask`); Host Face wires UI via `approval/*`.
- Sandbox argv wrap is a `MonotonicGuard` on `exec-sandbox`.
- Output bound (+ optional workspace persist) is an explicit stage after finalize.

## API sketch

```ts
const pipeline = createToolPipeline();
pipeline.onPre(async (ctx) => ({ action: "continue", args: ctx.args }));
pipeline.onGuard(createPolicyToolCallGuard(["shell"]));
pipeline.onGuard(createWriteIntentGuard({ hasRead }));
pipeline.onExecute(async (ctx, next) => { await next(); });
pipeline.onPost(async (ctx) => {
  addAdditionalContext(ctx, "note");
  return { action: "accept" };
});

await runToolDetailed({ registry, call, pipeline });
```
