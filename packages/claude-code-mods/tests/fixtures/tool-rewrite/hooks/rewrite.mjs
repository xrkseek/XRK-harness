// A `tool.call` hook that lets the call run and then replaces what the model
// reads — the post-dispatch half of the tool interceptor contract.

export function register(on) {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    await next(e);
    $.ui.log("rewrote " + e.tool);
    return { result: "rewritten by mod" };
  });
}
