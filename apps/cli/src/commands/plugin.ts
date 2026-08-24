/**
 * `xrk-harness plugin` — install / remove / list user plugins under
 * `{XRK_HOME}/plugins` (or `XRK_PLUGINS_DIR`).
 */
import {
  addPlugin,
  listPlugins,
  reconcilePluginsDir,
  removePlugin,
  resolvePluginsDir,
} from "../plugin/index.js";

export function pluginHelpText(): string {
  return `xrk-harness plugin — manage user plugins

Usage:
  xrk-harness plugin add <spec…>
  xrk-harness plugin remove <name…>
  xrk-harness plugin list
  xrk-harness plugin path
  xrk-harness plugin reconcile
  xrk-harness plugin help

Specs (npm pack):
  @scope/name                 registry package
  github:user/repo            git (npm-compatible)
  ./path  file:./path         local checkout (anchored to cwd)
  link:./path                 same as file: for local dirs

Kinds:
  client   xrk.client / dsh.client + lib/client.js → web/boot overlay
  process  xrk.plugin.json / xrkseek.plugin / dsh.plugin → discover
  both     both halves

Root:
  default  ~/.xrk/plugins  (XRK_HOME / XRK_DSH_HOME / DSH_HOME)
  override XRK_PLUGINS_DIR

After add/remove, run \`xrk-harness restart\` so Host reloads plugins
(stops the previous XRK Host via pid lock; will not kill foreign listeners).

Examples:
  xrk-harness plugin add @huanlin/dsh-plugin-spur
  xrk-harness plugin list
  xrk-harness plugin remove @huanlin/dsh-plugin-spur
`;
}

export async function runPlugin(argv: readonly string[]): Promise<number> {
  const args = [...argv];
  if (
    args.length === 0 ||
    args[0] === "help" ||
    args[0] === "--help" ||
    args[0] === "-h"
  ) {
    process.stdout.write(pluginHelpText());
    return 0;
  }

  const sub = args.shift()!;

  try {
    switch (sub) {
      case "add": {
        if (args.length === 0) {
          throw new Error("plugin add needs at least one <spec>");
        }
        for (const spec of args) {
          addPlugin(spec);
        }
        process.stdout.write(
          "xrk-harness: run `restart` to load new plugins (stops the previous XRK Host only)\n",
        );
        return 0;
      }
      case "remove":
      case "rm": {
        if (args.length === 0) {
          throw new Error("plugin remove needs at least one <name>");
        }
        for (const name of args) {
          removePlugin(name);
        }
        process.stdout.write(
          "xrk-harness: run `restart` to drop removed plugins (stops the previous XRK Host only)\n",
        );
        return 0;
      }
      case "list":
      case "ls": {
        const pluginsDir = resolvePluginsDir();
        const entries = listPlugins({ pluginsDir });
        if (entries.length === 0) {
          process.stdout.write(`(none)  root=${pluginsDir}\n`);
          return 0;
        }
        process.stdout.write(`root=${pluginsDir}\n`);
        for (const e of entries) {
          process.stdout.write(
            `${e.name}\t${e.version}\t${e.kind}\t${e.source}\n`,
          );
        }
        return 0;
      }
      case "path": {
        process.stdout.write(`${resolvePluginsDir()}\n`);
        return 0;
      }
      case "reconcile": {
        const pluginsDir = resolvePluginsDir();
        reconcilePluginsDir(pluginsDir);
        process.stdout.write(
          "xrk-harness: reconciled client staging and web/boot.json with inventory\n",
        );
        return 0;
      }
      default:
        throw new Error(
          `unknown plugin subcommand: ${sub} (try: add | remove | list | path | reconcile | help)`,
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }
}
