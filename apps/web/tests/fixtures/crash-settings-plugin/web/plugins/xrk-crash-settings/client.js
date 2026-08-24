/**
 * Minimal community-style client plugin: registers a settings.section that
 * throws on render. Used by product-shell e2e to assert the settings dialog
 * stays open and keeps the nav row after abdication (crash face in content).
 */
window.__ModuleLoader__.load({
  id: "xrk-crash-settings",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");

    function CrashSection() {
      throw new Error("xrk-crash-settings: intentional section crash");
    }

    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "crash-demo",
            order: 90,
            label: "Crash Demo",
          },
          CrashSection,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
