/**
 * GenUI dynamic npm component registry — resolve package metadata without embedding npm trees.
 */
import { spawnSync } from "node:child_process";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { adapterEcho } from "./honest-envelope.js";

export const XRK_GENUI_NPM_ALLOWLIST_ENV = "XRK_GENUI_NPM_ALLOWLIST";

export interface GenuiNpmComponentRow {
  readonly id: string;
  readonly package: string;
  readonly exportName?: string;
  readonly version?: string;
  readonly registeredAt: string;
}

interface GenuiNpmStore {
  components: GenuiNpmComponentRow[];
}

const NPM_STORE = createXrkDocStore<GenuiNpmStore>(
  ["genui", "npm-components.json"],
  { components: [] },
);

function parseAllowlistEnv(env: NodeJS.ProcessEnv = process.env): GenuiNpmComponentRow[] {
  const raw = env[XRK_GENUI_NPM_ALLOWLIST_ENV]?.trim();
  if (!raw) return [];
  const now = new Date().toISOString();
  return raw
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pkg) => ({
      id: pkg.replace(/[@/]/g, "-"),
      package: pkg,
      registeredAt: now,
    }));
}

export function listGenuiNpmComponents(
  xrkHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): GenuiNpmComponentRow[] {
  const doc = NPM_STORE.read(xrkHome).data;
  const merged = new Map<string, GenuiNpmComponentRow>();
  for (const row of doc.components) merged.set(row.package, row);
  for (const row of parseAllowlistEnv(env)) merged.set(row.package, row);
  return [...merged.values()];
}

export function registerGenuiNpmComponent(
  xrkHome: string | undefined,
  input: { package: string; exportName?: string; version?: string },
): GenuiNpmComponentRow {
  const pkg = input.package.trim();
  if (!pkg) throw new Error("package required");
  const now = new Date().toISOString();
  const row: GenuiNpmComponentRow = {
    id: pkg.replace(/[@/]/g, "-"),
    package: pkg,
    ...(input.exportName?.trim() ? { exportName: input.exportName.trim() } : {}),
    ...(input.version?.trim() ? { version: input.version.trim() } : {}),
    registeredAt: now,
  };
  NPM_STORE.patch(xrkHome, (current) => {
    const without = current.components.filter((c) => c.package !== pkg);
    return { components: [row, ...without] };
  });
  return row;
}

export function resolveGenuiNpmPackage(
  spec: string,
): {
  ok: boolean;
  spec: string;
  name?: string;
  version?: string;
  description?: string;
  error?: string;
} {
  const trimmed = spec.trim();
  if (!trimmed) {
    return { ok: false, spec: trimmed, error: "empty-spec" };
  }
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const res = spawnSync(npmCmd, ["view", trimmed, "name", "version", "description", "--json"], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (res.status !== 0) {
    return {
      ok: false,
      spec: trimmed,
      error: res.stderr?.trim() || res.stdout?.trim() || "npm-view-failed",
    };
  }
  try {
    const parsed = JSON.parse(String(res.stdout)) as
      | string
      | { name?: string; version?: string; description?: string };
    if (typeof parsed === "string") {
      return { ok: true, spec: trimmed, name: parsed };
    }
    return {
      ok: true,
      spec: trimmed,
      name: parsed.name ?? trimmed,
      ...(parsed.version ? { version: parsed.version } : {}),
      ...(parsed.description ? { description: parsed.description } : {}),
    };
  } catch {
    const line = String(res.stdout).trim().split("\n")[0] ?? trimmed;
    return { ok: true, spec: trimmed, name: line };
  }
}

/** Walk schema for npm component references (`type: npm` or `npm:package/Export`). */
export function collectNpmRefsFromSchema(schema: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const row = node as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type.trim() : "";
    if (type === "npm" && typeof row.package === "string" && row.package.trim()) {
      const pkg = row.package.trim();
      const exp =
        typeof row.export === "string" && row.export.trim()
          ? `/${row.export.trim()}`
          : typeof row.exportName === "string" && row.exportName.trim()
            ? `/${row.exportName.trim()}`
            : "";
      out.add(`${pkg}${exp}`);
    } else if (type.startsWith("npm:")) {
      out.add(type.slice(4));
    }
    for (const value of Object.values(row)) walk(value);
  };
  walk(schema);
  return [...out];
}

export function mergeGenuiComponentRegistry(
  builtins: readonly string[],
  xrkHome?: string,
  schema?: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const merged = new Set<string>(builtins);
  for (const row of listGenuiNpmComponents(xrkHome, env)) {
    merged.add(row.exportName ? `npm:${row.package}/${row.exportName}` : `npm:${row.package}`);
  }
  if (schema) {
    for (const ref of collectNpmRefsFromSchema(schema)) {
      merged.add(ref.startsWith("npm:") ? ref : `npm:${ref}`);
    }
  }
  return [...merged];
}

export function genuiNpmRegistryStatus(
  xrkHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const rows = listGenuiNpmComponents(xrkHome, env);
  return {
    ok: true,
    count: rows.length,
    components: rows,
    allowlistEnv: XRK_GENUI_NPM_ALLOWLIST_ENV,
    note: "Dynamic npm components resolve via npm registry metadata; Host does not bundle packages.",
    ...adapterEcho(),
  };
}

export function unregisterGenuiNpmComponent(
  xrkHome: string | undefined,
  pkg: string,
): boolean {
  const trimmed = pkg.trim();
  let removed = false;
  NPM_STORE.patch(xrkHome, (current) => {
    const next = current.components.filter((c) => c.package !== trimmed);
    removed = next.length !== current.components.length;
    return { components: next };
  });
  return removed;
}
