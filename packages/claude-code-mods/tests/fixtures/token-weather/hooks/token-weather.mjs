// Fixture hook module in the published plugin shape: a `.mjs` file exporting
// `register(on)`. It exercises each `$` namespace this bridge implements plus
// the two registration forms (`on(event, handler)` and `on(event, matcher,
// handler)`), so the loader/chain tests drive real plugin code rather than a
// mock of it.

const READINGS = { plugin: "token-weather", key: "readings" };

export function register(on) {
  on("session.start", async ($, e, next) => {
    await $.state.set(READINGS, [{ percent: 4 }]);
    $.log.info(`session ${e.sessionId} started in ${$.session.cwd()}`);
    return next(e);
  });

  on("prompt.submit", async ($, e, next) => {
    const { value = [] } = await $.state.get(READINGS);
    $.status.set(`ctx ${JSON.stringify(value)}`);
    return next(e);
  });

  on("turn.complete", async ($, e) => {
    if (e.agentId) return next(e);
    await $.store.set("turns", await $.session.turns());
    return `turns:${await $.session.turns()}`;
  });

  // Matcher form: only the AbovePrompt slot, everything else falls through.
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props["hasSurvey"] === true) return next(e);
    return { component: "band", columns: e.props["bodyColumns"] ?? 0 };
  });

  // Registered but never dispatched by this host → load-time warning.
  on("prompt.cancelled", async ($, e, next) => next(e));
}
