/**
 * Native client gold sample — theme token overlay.
 *
 * Stacks a few `--dsw-alias-*` overrides through ThemeRuntime (first-party).
 * No dsh-compat, no skin HTTP, no community skin.json.
 */
window.__ModuleLoader__.load({
  id: "example-theme-tokens",
  factory: () => ({
    name: "example-theme-tokens",
    inject: ["theme"],
    apply(ctx) {
      const theme = ctx.get("theme");
      if (theme === undefined || typeof theme.overrideTokens !== "function") {
        throw new Error(
          "example-theme-tokens: ctx.theme.overrideTokens missing — is @xrkseek/client-ui-theme mounted?",
        );
      }
      ctx.effect(
        () =>
          theme.overrideTokens("example-theme-tokens", {
            "--dsw-alias-label-primary": {
              light: "#0B5FFF",
              dark: "#7EB6FF",
            },
            "--dsw-alias-bg-layer-1": {
              light: "#F3F7FF",
              dark: "#121826",
            },
          }),
        "example-theme-tokens: overrideTokens",
      );
    },
  }),
});
