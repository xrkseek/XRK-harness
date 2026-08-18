import { stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolveProductWebDist } from "../product-paths.js";

export interface DoctorResult {
  readonly ok: boolean;
  readonly checks: readonly { name: string; ok: boolean; detail: string }[];
}

export async function runDoctor(workspace: string): Promise<DoctorResult> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
  const execPath = process.execPath;
  checks.push({
    name: "node",
    ok: nodeMajor >= 26,
    detail: `v${process.versions.node} (need >=26) ${execPath}`,
  });

  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const pnpm = spawnSync(pnpmCmd, ["--version"], {
    encoding: "utf8",
  });
  checks.push({
    name: "pnpm",
    ok: true,
    detail:
      pnpm.status === 0
        ? String(pnpm.stdout).trim()
        : "not on PATH (ok for a built bin)",
  });

  let wsOk = false;
  try {
    const st = await stat(workspace);
    wsOk = st.isDirectory();
  } catch {
    wsOk = false;
  }
  checks.push({
    name: "workspace",
    ok: wsOk,
    detail: wsOk ? workspace : `not a directory: ${workspace}`,
  });

  const web = await resolveProductWebDist();
  checks.push({
    name: "product-ui",
    ok: Boolean(web),
    detail: web ?? "no apps/web/dist — serve falls back to Face console",
  });

  const llm = Boolean(process.env.XRK_LLM_PRESET?.trim());
  checks.push({
    name: "llm-preset",
    ok: true,
    detail: llm
      ? `XRK_LLM_PRESET=${process.env.XRK_LLM_PRESET}`
      : "unset (run/serve use replay until set)",
  });

  return {
    ok: checks
      .filter(
        (c) =>
          c.name !== "llm-preset" &&
          c.name !== "pnpm" &&
          c.name !== "product-ui",
      )
      .every((c) => c.ok),
    checks,
  };
}
