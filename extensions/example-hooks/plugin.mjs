/**
 * Example `kind: hooks` — ToolPipeline onPre / onPost via wireCompositionHooks.
 * Fail-open: throwing hooks must not abort the turn (Host wiring).
 * @see docs/plugin-development.md
 */
export function createPlugin() {
  return {
    id: "example-hooks",
    kind: "hooks",
    hooks: {
      onPre: [
        async (ctx) => {
          // Continue unchanged — sample only observes the call.
          void ctx;
          return { action: "continue", args: ctx.args };
        },
      ],
      onPost: [
        async () => ({ action: "accept" }),
      ],
    },
  };
}
