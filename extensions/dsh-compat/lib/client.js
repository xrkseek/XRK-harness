/**
 * Built-in DSH community adapter client marker.
 * Host HTTP: `extensions/dsh-compat` (`kind: host`) → @xrkseek/server-http/dsh-compat.
 */
window.__ModuleLoader__.load({
  id: "@xrkseek/dsh-compat",
  factory() {
    return {
      name: "@xrkseek/dsh-compat",
      apply() {
        // Host routes + Face projections are wired by XRK serve — no Cordis apply().
      },
    };
  },
});
