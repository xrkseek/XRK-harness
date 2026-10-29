// The pre-dispatch half of the tool interceptor contract: a refusal the host
// turns into the tool error the model reads, plus a fall-through for everything
// it does not care about.

const RISKY = /\bgit\s+push\b.*--force|\brm\s+-rf?\b/u;

export function register(on) {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (RISKY.test(String(e.command ?? ""))) {
      return { deny: "guard refused this command: " + String(e.command) };
    }
    return next(e);
  });
}
