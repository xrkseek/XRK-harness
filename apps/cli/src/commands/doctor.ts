import { access } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface DoctorResult {
  readonly ok: boolean;
  readonly checks: readonly { name: string; ok: boolean; detail: string }[];
}

export async function runDoctor(workspace: string): Promise<DoctorResult> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
  checks.push({
    name: "node",
    ok: nodeMajor >= 20,
    detail: `v${process.versions.node} (need >=20)`,
  });

  const pnpm = spawnSync("pnpm", ["--version"], {
    encoding: "utf8",
    shell: true,
  });
  checks.push({
    name: "pnpm",
    ok: pnpm.status === 0,
    detail:
      pnpm.status === 0
        ? String(pnpm.stdout).trim()
        : "pnpm not found on PATH",
  });

  const marker = path.join(workspace, "pnpm-workspace.yaml");
  let wsOk: boolean;
  try {
    await access(marker);
    wsOk = true;
  } catch {
    wsOk = false;
  }
  checks.push({
    name: "workspace",
    ok: wsOk,
    detail: wsOk
      ? `found ${marker}`
      : `missing pnpm-workspace.yaml under ${workspace}`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}
