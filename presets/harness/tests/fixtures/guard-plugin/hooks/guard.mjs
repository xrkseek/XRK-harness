// Fixture for the harness composition: one plugin that touches every seam the
// composition wires, so a test can see which seams actually fire.
//
// `$.ui.log` is used rather than a file write because the host routes it to the
// logger, which is the only observable channel a mod has without a UI.

const RISKY = /\bgit\s+push\b.*--force|\brm\s+-rf?\b/u;

export function register(on) {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (RISKY.test(String(e.command ?? ""))) {
      return { deny: "harness guard refused: " + String(e.command) };
    }
    return next(e);
  });

  on("prompt.submit", {}, async ($, e, next) => {
    const out = await next(e);
    return { ...out, text: out.text + " [mod]" };
  });

  // Observe-only: run the chain beneath, then a side effect, return nothing.
  // The result from beneath stands; this must not be reported as a skip.
  on("turn.complete", {}, async ($, e, next) => {
    await next(e);
    $.ui.log("turn-complete:" + e.reason);
  });

  on("session.end", {}, async ($, e, next) => {
    $.ui.log("session-end");
    return next(e);
  });
}
