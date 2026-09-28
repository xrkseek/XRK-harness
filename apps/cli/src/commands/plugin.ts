/**
 * `xrkh plugin` — install / remove / list user plugins under
 * `{XRK_HOME}/plugins` (or `XRK_PLUGINS_DIR`). Bin also: xrk-harness.
 */
import {
  addPlugin,
  listPlugins,
  readDisabledPluginIds,
  reconcilePluginsDir,
  removePlugin,
  resolvePluginsDir,
} from "../plugin/index.js";

export function pluginHelpText(): string {
  return `xrkh plugin — manage user plugins (bin also: xrk-harness)

Usage:
  xrkh plugin add [--registry <url>] <spec…>
  xrkh plugin remove <name…>
  xrkh plugin list
  xrkh plugin path
  xrkh plugin reconcile
  xrkh plugin help

Specs (npm pack):
  @scope/name                 registry package
  github:user/repo            git (npm-compatible)
  ./path  file:./path         local checkout (anchored to cwd)
  link:./path                 same as file: for local dirs

Options:
  --registry / -r <url>       npm registry for pack (e.g. https://registry.npmmirror.com)

Kinds:
  client   xrk.client / dsh.client + lib/client.js → web/boot overlay
  process  xrk.plugin.json / xrkseek.plugin / dsh.plugin → discover
  both     both halves

Root:
  default  ~/.xrk/plugins  (XRK_HOME / XRK_DSH_HOME / DSH_HOME)
  override XRK_PLUGINS_DIR

After add/remove, run \`xrkh restart\` so Host reloads plugins
(stops the previous XRK Host via pid lock; will not kill foreign listeners).

Examples:
  xrkh plugin add @huanlin/dsh-plugin-spur
  xrkh plugin list
  xrkh plugin remove @huanlin/dsh-plugin-spur
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
        let registry: string | undefined;
        const specs: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const token = args[i]!;
          if (token === "--registry" || token === "-r") {
            const next = args[++i];
            if (!next?.trim()) {
              throw new Error("plugin add --registry needs a URL");
            }
            registry = next.trim();
            continue;
          }
          specs.push(token);
        }
        if (specs.length === 0) {
          throw new Error("plugin add needs at least one <spec>");
        }
        for (const spec of specs) {
          addPlugin(spec, registry !== undefined ? { registry } : {});
        }
        process.stdout.write(
          "xrkh: run `restart` to load new plugins (stops the previous XRK Host only)\n",
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
          "xrkh: run `restart` to drop removed plugins (stops the previous XRK Host only)\n",
        );
        return 0;
      }
      case "list":
      case "ls": {
        const pluginsDir = resolvePluginsDir();
        const entries = listPlugins({ pluginsDir });
        const disabled = readDisabledPluginIds(pluginsDir);
        if (entries.length === 0) {
          process.stdout.write(`(none)  root=${pluginsDir}\n`);
          return 0;
        }
        process.stdout.write(`root=${pluginsDir}\n`);
        for (const e of entries) {
          const flag = disabled.has(e.name) ? "\tdisabled" : "";
          process.stdout.write(
            `${e.name}\t${e.version}\t${e.kind}\t${e.source}${flag}\n`,
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
          "xrkh: reconciled client staging and web/boot.json with inventory\n",
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
