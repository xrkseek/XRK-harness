/**
 * 干员 home directories: `{XRK_HOME}/agent-homes/{memberId}/` plus a workspace
 * AGENTS.md that mirrors the live playbook for identity sessions.
 *
 * Bidirectional hot sync with roster (+ advanced pack playbook.md) lives in
 * `agent-identity-sync.ts` — this helper is the disk write used by that fan-out
 * and by mint.
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/server-config";
import type { FaceRuntime } from "./context.js";
import { persistWorkspaceDoc } from "./workspace-store.js";
import { liveMemberPlaybook } from "./agent-roster-tools.js";
import type { AgentRosterMember, ListedRosterMember } from "./agent-roster-store.js";
import { resolveHarnessHome } from "./settings-document.js";
import { publishWorkspaceChanged } from "./workspace-member-look.js";

function normalizeAgentsMd(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/** Absolute home directory for one roster member. */
export function agentHomeDir(
  memberId: string,
  productHome?: string,
): string {
  const id = memberId.trim();
  const root = path.resolve(productHome ?? resolveXrkHome());
  return path.join(root, "agent-homes", id);
}

/** Write / refresh workspace AGENTS.md from the member playbook (no-op if equal). */
export function syncAgentHomePlaybook(
  absHome: string,
  playbook: string,
): void {
  const body = normalizeAgentsMd(playbook);
  if (!body) return;
  mkdirSync(absHome, { recursive: true });
  const file = path.join(absHome, "AGENTS.md");
  try {
    if (existsSync(file)) {
      const prev = normalizeAgentsMd(readFileSync(file, "utf8"));
      if (prev === body) return;
    }
  } catch {
    // Fall through and write.
  }
  writeFileSync(file, `${body}\n`, "utf8");
}

/**
 * Ensure the registry has an agent-home workspace for this member, disk dir
 * exists, and AGENTS.md matches the live playbook. Call only on explicit
 * user add / import — never for catalog seed sync.
 */
export async function mintAgentHomeForMember(
  runtime: FaceRuntime,
  member: AgentRosterMember | ListedRosterMember,
  canvasWorkspaceId: string,
): Promise<{ workspaceId: string; created: boolean }> {
  const home = agentHomeDir(member.id, runtime.agentRoster.home ?? resolveHarnessHome(runtime));
  mkdirSync(home, { recursive: true });
  const listed: ListedRosterMember =
    "scope" in member
      ? member
      : { ...member, scope: "workspace" };
  const playbook = liveMemberPlaybook(runtime, canvasWorkspaceId, listed);
  syncAgentHomePlaybook(home, playbook);
  const { workspace, created } = runtime.workspaces.ensureAgentHome({
    absPath: home,
    memberId: member.id,
    title: member.name.trim() || member.id,
  });
  await persistWorkspaceDoc(runtime, runtime.workspaces);
  publishWorkspaceChanged(runtime, workspace);
  return { workspaceId: workspace.workspaceId, created };
}

/** Drop agent-home registration for a removed member (disk kept). */
export async function unbindAgentHomeForMember(
  runtime: FaceRuntime,
  memberId: string,
): Promise<void> {
  // Keep identity after unbind: unbound rows still report memberId on
  // session.list so 干员「未分组」can claim them (project orphans have none).
  const unbound = runtime.workspaces.unbindAgentHome(memberId);
  await persistWorkspaceDoc(runtime, runtime.workspaces);
  if (unbound.workspaceId) {
    runtime.bus.publishHost({
      type: "host/workspace-removed",
      workspaceId: unbound.workspaceId,
    });
  }
}
