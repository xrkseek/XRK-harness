import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolveXrkHome } from "@xrkseek/server-config";
import { probeSandboxEnvironment } from "@xrkseek/exec-sandbox";
import {
  getOutboundAllowlistAuditLog,
  parseOutboundAllowlistHosts,
} from "@xrkseek/exec-web";
import { probeHttpExecEnvironment } from "@xrkseek/exec-environment";
import { describeVoiceAccess } from "@xrkseek/exec-voice";
import {
  PRODUCT_SHELL_BUILD_HINT,
  harnessAppsRoot,
  resolveProductWebDist,
} from "../product-paths.js";
import { ensureUserHomeSeeds } from "../user-skill-seeds.js";

export interface DoctorResult {
  readonly ok: boolean;
  readonly checks: readonly { name: string; ok: boolean; detail: string }[];
}

function countStagedCommunityClients(pluginsRoot: string): number {
  if (!existsSync(pluginsRoot)) return 0;
  let count = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync(path.join(full, "client.js"))) {
        count += 1;
        continue;
      }
      walk(full);
    }
  };
  walk(pluginsRoot);
  return count;
}

function communityEnvSummary(): string {
  const parts: string[] = [];
  if (process.env.XRK_IM_GATEWAY_WS_URL?.trim()) {
    parts.push("IM WS");
  } else if (process.env.XRK_IM_GATEWAY_URL?.trim()) {
    parts.push("IM sidecar");
  }
  if (process.env.XRK_MEMORY_EMBED_URL?.trim()) parts.push("memory sidecar");
  if (process.env.XRK_GENUI_NPM_ALLOWLIST?.trim()) parts.push("genui npm");
  if (process.env.XRK_TONGFLOW_PYTHON?.trim()) parts.push("tongflow python");
  return parts.length > 0 ? parts.join(" · ") : "none (embedded defaults)";
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
    wsOk = (await stat(workspace)).isDirectory();
  } catch {
    /* missing or inaccessible */
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
    detail:
      web ??
      (existsSync(path.join(harnessAppsRoot(), "web", "package.json"))
        ? `missing — monorepo serve will build (${PRODUCT_SHELL_BUILD_HINT})`
        : "missing — reinstall CLI (product-web) or set XRK_WEB_DIST"),
  });

  const xrkHome = resolveXrkHome();
  const xrkHomeOk = existsSync(xrkHome);
  checks.push({
    name: "xrk-home",
    ok: true,
    detail: xrkHomeOk
      ? xrkHome
      : `${xrkHome} (created on first serve/web)`,
  });

  const seeded = await ensureUserHomeSeeds(xrkHome);
  const parts = [
    ...seeded.skills.installed.map((n) => `skill:${n}`),
    ...seeded.skills.refreshed.map((n) => `skill~${n}`),
    ...seeded.standing.installed.map((n) => `standing:${n}`),
    ...seeded.standing.refreshed.map((n) => `standing~${n}`),
    ...seeded.recipes.installed.map((n) => `recipe:${n}`),
    ...seeded.recipes.refreshed.map((n) => `recipe~${n}`),
  ];
  checks.push({
    name: "user-home-seeds",
    ok: true,
    detail:
      parts.length > 0
        ? `${parts.join(", ")} → ${xrkHome}`
        : `ok ${path.join(xrkHome, "skills")}`,
  });

  const pluginsRoot = path.join(xrkHome, "plugins", "web", "plugins");
  const communityCount = countStagedCommunityClients(pluginsRoot);
  checks.push({
    name: "community-plugins",
    ok: true,
    detail:
      communityCount > 0
        ? `${communityCount} client package(s) under ${pluginsRoot}`
        : `none staged — xrkh plugin add <pkg> then xrkh restart`,
  });

  const dshCompatExt = path.join(
    workspace,
    "extensions",
    "dsh-compat",
    "xrk.plugin.json",
  );
  if (existsSync(dshCompatExt)) {
    checks.push({
      name: "dsh-compat-host",
      ok: true,
      detail: "extensions/dsh-compat present (dev tree)",
    });
  }

  checks.push({
    name: "community-env",
    ok: true,
    detail: communityEnvSummary(),
  });

  const sandboxProbe = probeSandboxEnvironment({ workspaceRoot: workspace });
  for (const row of sandboxProbe.checks) {
    checks.push({
      name: row.name,
      ok: row.ok,
      detail: row.detail,
    });
  }

  const allowHosts = parseOutboundAllowlistHosts(
    process.env.XRK_WEB_FETCH_ALLOWLIST,
  );
  const auditTail = getOutboundAllowlistAuditLog().slice(-5);
  const auditDetail =
    auditTail.length === 0
      ? "audit ring empty"
      : `recent ${auditTail.length}: ${auditTail
          .map((e) => `${e.decision}:${e.host}`)
          .join(", ")}`;
  checks.push({
    name: "web-fetch-allowlist",
    ok: true,
    detail:
      allowHosts.length === 0
        ? `open (XRK_WEB_FETCH_ALLOWLIST unset; private hosts still blocked; ${auditDetail})`
        : `allowlist (${allowHosts.length}): ${allowHosts.slice(0, 12).join(", ")}${allowHosts.length > 12 ? ", …" : ""}; ${auditDetail}`,
  });

  const execKind = String(process.env.XRK_EXEC_ENVIRONMENT ?? "local")
    .trim()
    .toLowerCase();
  if (execKind === "http") {
    const url = String(process.env.XRK_EXEC_ENVIRONMENT_URL ?? "").trim();
    let httpOk = false;
    let httpDetail = url
      ? `XRK_EXEC_ENVIRONMENT=http url=${url}`
      : "XRK_EXEC_ENVIRONMENT=http but XRK_EXEC_ENVIRONMENT_URL unset";
    if (url) {
      try {
        httpOk = await probeHttpExecEnvironment({ baseUrl: url });
        httpDetail += httpOk ? " · /health ok" : " · /health failed";
      } catch (err) {
        httpDetail += ` · probe error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    checks.push({
      name: "exec-environment-http",
      ok: Boolean(url) && httpOk,
      detail: httpDetail,
    });
  } else {
    checks.push({
      name: "exec-environment",
      ok: true,
      detail: `local (XRK_EXEC_ENVIRONMENT=${execKind || "local"})`,
    });
  }

  const voice = describeVoiceAccess(process.env);
  checks.push({
    name: "voice",
    // Missing key with openai/env enabled is a real misconfig; off is fine.
    ok: voice.kind !== "openai-missing-key",
    detail: voice.summary,
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
          c.name !== "product-ui" &&
          c.name !== "xrk-home" &&
          c.name !== "user-home-seeds" &&
          c.name !== "community-plugins" &&
          c.name !== "community-env" &&
          c.name !== "dsh-compat-host" &&
          c.name !== "web-fetch-allowlist" &&
          c.name !== "voice" &&
          c.name !== "exec-environment" &&
          // sandbox-backend is always ok; sandbox-helper fails closed when backend needs a helper
          c.name !== "sandbox-backend",
      )
      .every((c) => c.ok),
    checks,
  };
}
