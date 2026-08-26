/**
 * TongFlow Python runtime bridge (ADR-0007) — user PATH interpreter + optional scripts.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import type { TongflowNodeResult } from "./tongflow-node-runtime.js";
import { TASKFLOW_EXTERNAL_INCOMPLETE } from "./tongflow-node-runtime.js";

export const XRK_TONGFLOW_PYTHON_ENV = "XRK_TONGFLOW_PYTHON";
export const XRK_TONGFLOW_PYTHON_SCAN_ENV = "XRK_TONGFLOW_PYTHON_SCAN";
export const XRK_TONGFLOW_PYTHON_RUNNER_ENV = "XRK_TONGFLOW_PYTHON_RUNNER";

interface TongflowPythonConfig {
  command?: string;
  scanScript?: string;
  nodeRunner?: string;
}

const PYTHON_CONFIG = createXrkDocStore<TongflowPythonConfig>(
  ["tongflow", "python.json"],
  {},
);

export function readTongflowPythonConfig(
  xrkHome?: string,
): TongflowPythonConfig {
  return PYTHON_CONFIG.read(xrkHome).data;
}

export function resolveTongflowPythonCommand(
  env: NodeJS.ProcessEnv = process.env,
  xrkHome?: string,
): string | undefined {
  const fromEnv = env[XRK_TONGFLOW_PYTHON_ENV]?.trim();
  if (fromEnv) return fromEnv;
  const fromDoc = readTongflowPythonConfig(xrkHome).command?.trim();
  if (fromDoc) return fromDoc;
  for (const bin of ["python3", "python"]) {
    const probe = spawnSync(bin, ["--version"], {
      encoding: "utf8",
      timeout: 3000,
    });
    if (probe.status === 0) return bin;
  }
  return undefined;
}

export function tongflowPythonStatus(
  xrkHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const command = resolveTongflowPythonCommand(env, xrkHome);
  const doc = readTongflowPythonConfig(xrkHome);
  const scanScript =
    env[XRK_TONGFLOW_PYTHON_SCAN_ENV]?.trim() ||
    doc.scanScript?.trim() ||
    "";
  const nodeRunner =
    env[XRK_TONGFLOW_PYTHON_RUNNER_ENV]?.trim() ||
    doc.nodeRunner?.trim() ||
    "";
  return {
    ok: true,
    configured: Boolean(command),
    command: command ?? null,
    scanScript: scanScript || null,
    nodeRunner: nodeRunner || null,
    scanScriptExists: scanScript ? existsSync(scanScript) : false,
    nodeRunnerExists: nodeRunner ? existsSync(nodeRunner) : false,
    adapter: DSH_COMPAT_ADAPTER,
    note: command
      ? "Python TongFlow bridge via user interpreter (no vendored distribution)."
      : "Set XRK_TONGFLOW_PYTHON or ~/.xrk/tongflow/python.json command.",
  };
}

export function tryPythonTongflowScan(
  workspaceRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
  xrkHome?: string,
): Record<string, unknown> | null {
  const command = resolveTongflowPythonCommand(env, xrkHome);
  if (!command) return null;

  const doc = readTongflowPythonConfig(xrkHome);
  const scanScript =
    env[XRK_TONGFLOW_PYTHON_SCAN_ENV]?.trim() ||
    doc.scanScript?.trim() ||
    "";

  if (scanScript && existsSync(scanScript)) {
    const res = spawnSync(command, [scanScript], {
      encoding: "utf8",
      timeout: 15_000,
      cwd: workspaceRoot,
    });
    if (res.status === 0 && res.stdout?.trim()) {
      try {
        const parsed = JSON.parse(res.stdout) as Record<string, unknown>;
        return {
          ...parsed,
          scanner: parsed.scanner ?? "python-script",
          python: true,
        };
      } catch {
        /* fall through to inline stub */
      }
    }
  }

  const inline = [
    "import json,sys",
    "print(json.dumps({'plugins':{},'nodePluginMap':{},'official':[],'scanner':'python-inline','python':True}))",
  ].join("\n");
  const res = spawnSync(command, ["-c", inline], {
    encoding: "utf8",
    timeout: 5000,
    cwd: workspaceRoot,
  });
  if (res.status !== 0 || !res.stdout?.trim()) return null;
  try {
    return JSON.parse(res.stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isPythonTongflowNode(
  nodeId: string | undefined,
  config: Record<string, unknown>,
): boolean {
  const kind =
    typeof config.kind === "string" ? config.kind.trim().toLowerCase() : "";
  if (kind === "python") return true;
  const key = String(nodeId ?? config.nodeId ?? "").toLowerCase();
  return key.startsWith("python.") || key.startsWith("python/");
}

export function executePythonTongflowNode(
  nodeId: string | undefined,
  config: Record<string, unknown>,
  options: { readonly xrkHome?: string; readonly env?: NodeJS.ProcessEnv } = {},
): TongflowNodeResult {
  const env = options.env ?? process.env;
  const command = resolveTongflowPythonCommand(env, options.xrkHome);
  const key = String(nodeId ?? config.nodeId ?? "python.node").replace(
    /^python\./,
    "",
  );
  if (!command) {
    return {
      ok: false,
      nodeId: key,
      engine: "python-stub",
      incomplete: [TASKFLOW_EXTERNAL_INCOMPLETE],
      data: tag(
        {
          code: "PYTHON_COMMAND_MISSING",
          message:
            "Python TongFlow node requires XRK_TONGFLOW_PYTHON or tongflow/python.json command.",
          nodeId: key,
          adapter: DSH_COMPAT_ADAPTER,
        },
        [TASKFLOW_EXTERNAL_INCOMPLETE],
      ),
    };
  }

  const doc = readTongflowPythonConfig(options.xrkHome);
  const runner =
    (typeof config.runner === "string" ? config.runner.trim() : "") ||
    env[XRK_TONGFLOW_PYTHON_RUNNER_ENV]?.trim() ||
    doc.nodeRunner?.trim() ||
    "";

  const timeoutMs =
    typeof config.timeoutMs === "number" && config.timeoutMs > 0
      ? Math.min(config.timeoutMs, 120_000)
      : 30_000;
  const payload = JSON.stringify({
    nodeId: key,
    config,
    input: config.input ?? config.data ?? config.text ?? config.prompt,
  });

  const args = runner && existsSync(runner)
    ? [runner]
    : [
        "-c",
        "import json,sys; p=json.load(sys.stdin); print(json.dumps({'ok':True,'echo':p.get('input'),'nodeId':p.get('nodeId')}))",
      ];

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
      engine: "python-stub",
      data: { error: res.error.message, adapter: DSH_COMPAT_ADAPTER },
    };
  }
  if (res.status !== 0) {
    return {
      ok: false,
      nodeId: key,
      engine: "python-stub",
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
    /* plain stdout */
  }
  return { ok: true, nodeId: key, data, engine: "python-stub" };
}
