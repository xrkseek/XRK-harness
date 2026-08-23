/**
 * TongFlow node execution runtime (TypeScript bridge — optional Python scan enrich).
 */
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface TongflowNodeResult {
  readonly ok: boolean;
  readonly nodeId: string;
  readonly data: unknown;
  readonly engine: "typescript" | "python-stub";
}

type NodeHandler = (config: Record<string, unknown>) => unknown;

const BUILTIN_NODES: Record<string, NodeHandler> = {
  echo: (config) =>
    config.text ?? config.prompt ?? config.input ?? config.value ?? "",
  passthrough: (config) => config,
  "text.template": (config) => {
    const template = String(config.template ?? config.text ?? "");
    const vars =
      config.vars && typeof config.vars === "object"
        ? (config.vars as Record<string, unknown>)
        : {};
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
      String(vars[key] ?? ""),
    );
  },
  "json.parse": (config) => {
    const raw = String(config.text ?? config.input ?? "{}");
    return JSON.parse(raw) as unknown;
  },
  "json.stringify": (config) =>
    JSON.stringify(config.value ?? config.input ?? config.data ?? {}),
  delay: (config) => ({
    delayedMs: Number(config.ms ?? config.delayMs ?? 0),
    payload: config.input ?? config.data,
  }),
};

export function resolveTongflowNodeId(
  nodeId: string | undefined,
  config: Record<string, unknown>,
): string {
  const fromConfig =
    typeof config.nodeId === "string" ? config.nodeId.trim() : "";
  const raw = (nodeId ?? fromConfig ?? "echo").trim();
  if (BUILTIN_NODES[raw]) return raw;
  const withoutNode = raw.replace(/^node\./, "");
  if (BUILTIN_NODES[withoutNode]) return withoutNode;
  const slash = raw.includes(".") ? raw.split(".").pop()! : raw;
  return slash.replace(/^node\./, "");
}

export function executeTongflowNode(
  nodeId: string | undefined,
  config: Record<string, unknown>,
): TongflowNodeResult {
  const key = resolveTongflowNodeId(nodeId, config);
  const handler = BUILTIN_NODES[key] ?? BUILTIN_NODES.echo!;
  try {
    const data = handler(config);
    return {
      ok: true,
      nodeId: key,
      data,
      engine: "typescript",
    };
  } catch (err) {
    return {
      ok: false,
      nodeId: key,
      data: {
        error: err instanceof Error ? err.message : String(err),
        adapter: DSH_COMPAT_ADAPTER,
      },
      engine: "typescript",
    };
  }
}

export function buildTongflowNodeRegistry(): Record<string, unknown> {
  const methodsByNodeSlot: Record<string, string[]> = {};
  for (const key of Object.keys(BUILTIN_NODES)) {
    methodsByNodeSlot[`node.${key}`] = [key];
  }
  return {
    plugins: {
      "xrk-tongflow-runtime": {
        id: "xrk-tongflow-runtime",
        package: "@xrkseek/tongflow-runtime-bridge",
        version: "0.1.0",
        methodsByNodeSlot,
        source: "xrk-bridge",
      },
    },
    nodePluginMap: Object.fromEntries(
      Object.keys(BUILTIN_NODES).map((key) => [`node.${key}`, "xrk-tongflow-runtime"]),
    ),
    official: ["xrk-tongflow-runtime"],
    scanner: "typescript-runtime",
    python: false,
    adapter: DSH_COMPAT_ADAPTER,
  };
}

export function mergeTongflowRegistry(
  base: Record<string, unknown>,
): Record<string, unknown> {
  const runtime = buildTongflowNodeRegistry();
  const plugins = {
    ...(typeof base.plugins === "object" && base.plugins
      ? (base.plugins as Record<string, unknown>)
      : {}),
    ...(runtime.plugins as Record<string, unknown>),
  };
  const nodePluginMap = {
    ...(typeof base.nodePluginMap === "object" && base.nodePluginMap
      ? (base.nodePluginMap as Record<string, unknown>)
      : {}),
    ...(runtime.nodePluginMap as Record<string, unknown>),
  };
  const official = [
    ...new Set([
      ...(Array.isArray(base.official) ? (base.official as string[]) : []),
      ...(runtime.official as string[]),
    ]),
  ];
  return {
    ...base,
    plugins,
    nodePluginMap,
    official,
    runtime: "xrk-typescript",
    adapter: DSH_COMPAT_ADAPTER,
  };
}
