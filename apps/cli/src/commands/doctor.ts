import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolveXrkHome } from "@xrkseek/server-config";
import {
  configureCostMeterHome,
  costMeterGetState,
  costMeterLedgerPath,
  peekSettingsYamlSection,
} from "@xrkseek/server-face";
import { probeSandboxEnvironment } from "@xrkseek/exec-sandbox";
import {
  getOutboundAllowlistAuditLog,
  parseOutboundAllowlistHosts,
} from "@xrkseek/exec-web";
import { probeHttpExecEnvironment } from "@xrkseek/exec-environment";
import { probeSshTarget, resolveSshConfig } from "@xrkseek/exec-ssh";
import { describeVoiceAccess } from "@xrkseek/exec-voice";
import { resolveMemoryProvider } from "@xrkseek/exec-memory";
import { runSkillCurator } from "@xrkseek/workspace";
import {
  IM_GATEWAY_CONTRACT_VERSION,
  IM_GATEWAY_HOST_LOCAL_WS_PATH,
  IM_GATEWAY_HOST_RELAY_PATH,
  probeImGatewaySidecar,
  readImGatewaySidecarConfig,
} from "@xrkseek/im-gateway-contract";
import { resolveA2aInboundEnabled } from "@xrkseek/server-host";
import {
  describeAutoReviewAccess,
  probeAutoReviewClassifier,
} from "@xrkseek/server-http";
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

  configureCostMeterHome(xrkHome);
  const ledgerPath = costMeterLedgerPath();
  try {
    const state = costMeterGetState();
    const trendDays = [...(state.history ?? [])].length;
    checks.push({
      name: "cost-ledger",
      ok: true,
      detail: existsSync(ledgerPath)
        ? `${ledgerPath} · today $${state.today.cost.toFixed(4)} · total $${state.total.cost.toFixed(4)} · history ${trendDays}d (same Host ledger as Status billing + export cost.json)`
        : `${ledgerPath} (empty until first billed turn; Session events → Face costUsage → Host ledger)`,
    });
  } catch (err) {
    checks.push({
      name: "cost-ledger",
      ok: false,
      detail: `${ledgerPath}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

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

  {
    const wsUrl = process.env.XRK_IM_GATEWAY_WS_URL?.trim();
    const sidecar = readImGatewaySidecarConfig();
    const mockPlugin = path.join(
      workspace,
      "extensions",
      "example-im-mock-sidecar",
      "xrk.plugin.json",
    );
    const sampleHint = existsSync(mockPlugin)
      ? " · extensions/example-im-mock-sidecar"
      : " · packages/im-gateway-contract/examples/mock-sidecar.mjs";
    if (wsUrl) {
      checks.push({
        name: "im-gateway",
        ok: true,
        detail: `ws-client ${wsUrl} · contract v${IM_GATEWAY_CONTRACT_VERSION} · local ${IM_GATEWAY_HOST_LOCAL_WS_PATH} · relay ${IM_GATEWAY_HOST_RELAY_PATH}${sampleHint}`,
      });
    } else if (sidecar) {
      const probe = await probeImGatewaySidecar(sidecar, 3000);
      checks.push({
        name: "im-gateway",
        ok: probe.ok,
        detail: probe.ok
          ? `sidecar reachable ${sidecar.url}` +
            (probe.contractVersion
              ? ` · contract ${probe.contractVersion}`
              : ` · contract v${IM_GATEWAY_CONTRACT_VERSION}`) +
            ` · relay ${IM_GATEWAY_HOST_RELAY_PATH}${sampleHint}`
          : `sidecar unreachable ${sidecar.url}: ${probe.error ?? "probe failed"} · contract v${IM_GATEWAY_CONTRACT_VERSION}${sampleHint}`,
      });
    } else {
      checks.push({
        name: "im-gateway",
        ok: true,
        detail: `bridge · local ${IM_GATEWAY_HOST_LOCAL_WS_PATH} + relay ${IM_GATEWAY_HOST_RELAY_PATH} · contract v${IM_GATEWAY_CONTRACT_VERSION} · Face telegram/discord=discover stubs (no vendor SDK)${sampleHint}`,
      });
    }
  }

  {
    const a2aProduct = peekSettingsYamlSection(xrkHome, "a2a-inbound");
    const a2aOn = resolveA2aInboundEnabled(process.env, {
      enabled: a2aProduct?.enabled === true,
      ...(typeof a2aProduct?.sessionId === "string"
        ? { sessionId: a2aProduct.sessionId }
        : {}),
      ...(typeof a2aProduct?.timeoutMs === "number"
        ? { timeoutMs: a2aProduct.timeoutMs }
        : {}),
    });
    checks.push({
      name: "a2a-inbound",
      ok: true,
      detail: a2aOn
        ? "on · Agent Card + POST /a2a → Face inject · GET /a2a/health (no SSE/tasks CRUD)"
        : "off (Settings Plugins → A2A inbound or XRK_A2A_INBOUND=1)",
    });
  }

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
  let sshConfigured = false;
  try {
    const sshProduct = peekSettingsYamlSection(xrkHome, "ssh-remote");
    const sshConfig = resolveSshConfig(process.env, sshProduct);
    if (sshConfig) {
      sshConfigured = true;
      const probe = await probeSshTarget({
        config: sshConfig,
        timeoutMs: 12_000,
      });
      checks.push({
        name: "ssh-remote",
        ok: probe.ok,
        detail: probe.ok
          ? `${probe.detail} (SSH takes precedence over XRK_EXEC_ENVIRONMENT=http)`
          : `SSH probe failed: ${probe.detail}`,
      });
    } else {
      checks.push({
        name: "ssh-remote",
        ok: true,
        detail:
          "off (Settings General → Remote or XRK_SSH_HOST+XRK_SSH_WORKSPACE)",
      });
    }
  } catch (err) {
    checks.push({
      name: "ssh-remote",
      ok: false,
      detail: `SSH config: ${err instanceof Error ? err.message : String(err)}`,
    });
    sshConfigured = true;
  }

  if (execKind === "http") {
    const url = String(process.env.XRK_EXEC_ENVIRONMENT_URL ?? "").trim();
    let httpOk = false;
    let httpDetail = url
      ? `XRK_EXEC_ENVIRONMENT=http url=${url}`
      : "XRK_EXEC_ENVIRONMENT=http but XRK_EXEC_ENVIRONMENT_URL unset";
    if (sshConfigured) {
      httpDetail +=
        " · note: SSH remote is configured — Host will prefer SSH over HTTP";
    }
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
      ok: sshConfigured ? true : Boolean(url) && httpOk,
      detail: httpDetail,
    });
  } else {
    checks.push({
      name: "exec-environment",
      ok: true,
      detail: sshConfigured
        ? `ssh-remote (XRK_EXEC_ENVIRONMENT=${execKind || "local"} ignored while SSH is on)`
        : `local (XRK_EXEC_ENVIRONMENT=${execKind || "local"})`,
    });
  }

  const voice = describeVoiceAccess(process.env);
  checks.push({
    name: "voice",
    // Missing key with openai/env enabled is a real misconfig; off is fine.
    ok: voice.kind !== "openai-missing-key",
    detail: voice.summary,
  });

  {
    const arProduct = peekSettingsYamlSection(xrkHome, "auto-review");
    const product = {
      ...(typeof arProduct?.classifierUrl === "string"
        ? { classifierUrl: arProduct.classifierUrl }
        : {}),
    };
    const desc = describeAutoReviewAccess(process.env, product);
    const probe = await probeAutoReviewClassifier({
      env: process.env,
      product,
    });
    checks.push({
      name: "auto-review",
      ok: probe.ok,
      detail: `${desc.summary} · ${probe.detail}`,
    });
  }

  try {
    const mem = resolveMemoryProvider();
    const kind = String(process.env.XRK_MEMORY_PROVIDER ?? "file")
      .trim()
      .toLowerCase() || "file";
    checks.push({
      name: "memory-provider",
      ok: mem.isAvailable() !== false,
      detail: `XRK_MEMORY_PROVIDER=${kind} → ${mem.providerName}`,
    });
  } catch (err) {
    checks.push({
      name: "memory-provider",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const curator = await runSkillCurator({
      workspaceRoot,
      dryRun: true,
    });
    checks.push({
      name: "skill-curator",
      ok: true,
      detail:
        curator.candidates.length === 0
          ? `dry-run ok · no stale skills under ${curator.skillsRoot}`
          : `dry-run ok · ${curator.candidates.length} stale candidate(s) (≥${90}d) under ${curator.skillsRoot}`,
    });
  } catch (err) {
    checks.push({
      name: "skill-curator",
      ok: true,
      detail: `skip: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

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
          c.name !== "cost-ledger" &&
          // sandbox-backend is always ok; sandbox-helper fails closed when backend needs a helper
          c.name !== "sandbox-backend",
      )
      .every((c) => c.ok),
    checks,
  };
}
