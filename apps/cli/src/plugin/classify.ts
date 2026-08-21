/**
 * Classify an unpacked npm package as XRK client / process / both / reject.
 */
import { existsSync } from "node:fs";
import path from "node:path";

export type PluginKind = "client" | "process" | "both";

export interface ClassifiedPackage {
  readonly name: string;
  readonly version: string;
  readonly kind: PluginKind;
  readonly root: string;
  /** Absolute path to browser `client.js` when kind includes client. */
  readonly clientJs?: string;
  /** Raw inject from xrk.client / dsh.client (pre-remap). */
  readonly clientInject: readonly string[];
  readonly clientImmediately: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function nestedField(
  pkg: Record<string, unknown>,
  ns: string,
  key: string,
): unknown {
  return asRecord(pkg[ns])?.[key];
}

function readClientMeta(
  pkg: Record<string, unknown>,
): { inject: string[]; immediately: boolean } | undefined {
  const client =
    nestedField(pkg, "xrk", "client") ?? nestedField(pkg, "dsh", "client");
  const rec = asRecord(client);
  if (!rec) return undefined;
  const inject = Array.isArray(rec.inject)
    ? rec.inject.filter((x): x is string => typeof x === "string")
    : [];
  return {
    inject,
    immediately: rec.immediately === true,
  };
}

function hasProcessManifest(
  root: string,
  pkg: Record<string, unknown>,
): boolean {
  if (existsSync(path.join(root, "xrk.plugin.json"))) return true;
  if (nestedField(pkg, "xrkseek", "plugin") !== undefined) return true;
  if (nestedField(pkg, "dsh", "plugin") !== undefined) return true;
  if (nestedField(pkg, "deepseek", "plugin") !== undefined) return true;
  if (pkg["dsh.plugin"] !== undefined || pkg["deepseek.plugin"] !== undefined) {
    return true;
  }
  return false;
}

function hasCordisDep(deps: unknown): boolean {
  const rec = asRecord(deps);
  return Boolean(
    rec &&
      ("@xrkseek/cordis" in rec ||
        "@deepseek-ai/cordis" in rec),
  );
}

function resolveClientJs(
  root: string,
  pkg: Record<string, unknown>,
): string | undefined {
  const candidates = [
    path.join(root, "lib", "client.js"),
    path.join(root, "dist", "client.js"),
    path.join(root, "client.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const exportsField = asRecord(pkg.exports);
  const clientExport = asRecord(exportsField?.["./client"]);
  const def =
    (typeof clientExport?.default === "string" && clientExport.default) ||
    (typeof clientExport?.import === "string" && clientExport.import) ||
    (typeof exportsField?.["./client"] === "string"
      ? (exportsField["./client"] as string)
      : undefined);
  if (def) {
    const abs = path.resolve(root, def);
    if (existsSync(abs)) return abs;
  }
  return undefined;
}

/**
 * Classify an unpacked package directory (with package.json).
 * @throws when the package is not an installable XRK plugin.
 */
export function classifyPackage(root: string, pkg: Record<string, unknown>): ClassifiedPackage {
  const name = typeof pkg.name === "string" ? pkg.name.trim() : "";
  if (!name) {
    throw new Error("package.json missing string name");
  }
  const version =
    typeof pkg.version === "string" && pkg.version.trim()
      ? pkg.version.trim()
      : "0.0.0";

  const clientMeta = readClientMeta(pkg);
  const clientJs = clientMeta ? resolveClientJs(root, pkg) : undefined;
  const isClient = Boolean(clientMeta && clientJs);
  const isProcess = hasProcessManifest(root, pkg);

  if (!isClient && !isProcess) {
    if (
      hasCordisDep(pkg.peerDependencies) ||
      hasCordisDep(pkg.dependencies)
    ) {
      throw new Error(
        `${name}: Cordis host packages are not applied on XRK Host (inventory stub only). Ship tools/commands as process plugins (xrk.plugin.json / xrkseek.plugin) or a client half (xrk.client / dsh.client + lib/client.js).`,
      );
    }
    throw new Error(
      `${name}: not an XRK plugin — need xrk.client / dsh.client (+ lib/client.js) and/or a process manifest (xrk.plugin.json / xrkseek.plugin / dsh.plugin).`,
    );
  }

  if (clientMeta && !clientJs) {
    throw new Error(
      `${name}: declares xrk/dsh.client but no lib/client.js (or exports ./client) was found`,
    );
  }

  const kind: PluginKind =
    isClient && isProcess ? "both" : isClient ? "client" : "process";

  return {
    name,
    version,
    kind,
    root,
    ...(clientJs ? { clientJs } : {}),
    clientInject: clientMeta?.inject ?? [],
    clientImmediately: clientMeta?.immediately === true,
  };
}
