/**
 * TongFlow node execution runtime (TypeScript bridge — optional external subprocess).
 */
import { spawnSync } from "node:child_process";
import { tag, DSH_COMPAT_ADAPTER } from "./meta.js";
import {
  isPythonTongflowNode,
  executePythonTongflowNode,
} from "./tongflow-python-bridge.js";

export const TASKFLOW_EXTERNAL_INCOMPLETE = "taskflow-external-runtime" as const;

export interface TongflowNodeResult {
  readonly ok: boolean;
  readonly nodeId: string;
  readonly data: unknown;
  readonly engine: "typescript" | "python-stub" | "external";
  readonly incomplete?: readonly string[];
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

export function isExternalTongflowNode(
  nodeId: string | undefined,
  config: Record<string, unknown>,
): boolean {
  const kind =
    typeof config.kind === "string" ? config.kind.trim().toLowerCase() : "";
  if (kind === "external") return true;
  const key = resolveTongflowNodeId(nodeId, config);
  return key.startsWith("external.") || key.startsWith("external/");
}

export function executeExternalTongflowNode(
  nodeId: string | undefined,
  config: Record<string, unknown>,
): TongflowNodeResult {
  const key = resolveTongflowNodeId(nodeId, config);
  const command =
    typeof config.command === "string"
      ? config.command.trim()
      : typeof config.executable === "string"
        ? config.executable.trim()
        : "";
  if (!command) {
    return {
      ok: false,
      nodeId: key,
      engine: "external",
      incomplete: [TASKFLOW_EXTERNAL_INCOMPLETE],
      data: tag(
        {
          code: "EXTERNAL_COMMAND_MISSING",
          message: "External TongFlow node requires config.command (ADR-0007).",
          nodeId: key,
          adapter: DSH_COMPAT_ADAPTER,
        },
        [TASKFLOW_EXTERNAL_INCOMPLETE],
      ),
    };
  }
  const args = Array.isArray(config.args)
    ? config.args.map((a) => String(a))
    : [];
  const timeoutMs =
    typeof config.timeoutMs === "number" && config.timeoutMs > 0
      ? Math.min(config.timeoutMs, 120_000)
      : 30_000;
  const payload = JSON.stringify({
    nodeId: key,
    config,
    input: config.input ?? config.data ?? config.text ?? config.prompt,
  });
  const res = spawnSync(command, args, {
    input: payload,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  if (res.error) {
    return {
      ok: false,
      nodeId: key,
      engine: "external",
      data: {
        error: res.error.message,
        adapter: DSH_COMPAT_ADAPTER,
      },
    };
  }
  if (res.status !== 0) {
    return {
      ok: false,
      nodeId: key,
      engine: "external",
      data: {
        error: res.stderr?.trim() || `exit ${String(res.status)}`,
        adapter: DSH_COMPAT_ADAPTER,
      },
    };
  }
  let data: unknown = res.stdout?.trim() ?? "";
  try {
    data = JSON.parse(String(data)) as unknown;
  } catch {
    /* plain text stdout */
  }
  return { ok: true, nodeId: key, data, engine: "external" };
}

export interface TongflowExecuteOptions {
  readonly xrkHome?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export function executeTongflowNode(
  nodeId: string | undefined,
  config: Record<string, unknown>,
  options: TongflowExecuteOptions = {},
): TongflowNodeResult {
  if (isPythonTongflowNode(nodeId, config)) {
    return executePythonTongflowNode(nodeId, config, options);
  }
  if (isExternalTongflowNode(nodeId, config)) {
    return executeExternalTongflowNode(nodeId, config);
  }
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
    methodsByNodeSlot["node.external"] = ["external"];
  methodsByNodeSlot["node.python"] = ["python"];
  return {
    plugins: {
      "xrk-tongflow-runtime": {
        id: "xrk-tongflow-runtime",
        package: "@xrkseek/tongflow-runtime-bridge",
        version: "0.1.0",
        methodsByNodeSlot,
        source: "xrk-bridge",
        externalKind: {
          kind: "external",
          note: "Requires config.command; see ADR-0007.",
        },
        pythonKind: {
          kind: "python",
          note: "Uses XRK_TONGFLOW_PYTHON or ~/.xrk/tongflow/python.json; see ADR-0007.",
        },
      },
    },
    nodePluginMap: {
      ...Object.fromEntries(
        Object.keys(BUILTIN_NODES).map((key) => [`node.${key}`, "xrk-tongflow-runtime"]),
      ),
      "node.external": "xrk-tongflow-runtime",
      "node.python": "xrk-tongflow-runtime",
    },
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
