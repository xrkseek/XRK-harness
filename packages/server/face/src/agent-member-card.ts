/**
 * Portable 干员 card. Appearance / dressing never round-trips.
 * Kind `xrk-agent-member` is what the roster UI exports and `team_import` reads.
 */
import { isAgentTeamSpawnRole, type AgentTeamSpawnRole } from "./agent-team-roles.js";
import {
  MEMBER_PLAYBOOK_MAX,
  parseMemberToolPolicy,
  type MemberToolPolicy,
} from "./agent-roster-store.js";

export const AGENT_MEMBER_CARD_KIND = "xrk-agent-member";

export interface AgentMemberCard {
  readonly name: string;
  readonly playbook: string;
  readonly role: AgentTeamSpawnRole;
  readonly brief?: string;
  readonly inject?: "minimal" | "subagent";
  readonly tools?: MemberToolPolicy;
}

/** Wire shape for export / paste. Never includes appearance. */
export function formatAgentMemberCard(card: AgentMemberCard): string {
  return JSON.stringify(
    {
      kind: AGENT_MEMBER_CARD_KIND,
      name: card.name,
      playbook: card.playbook,
      role: card.role,
      ...(card.brief ? { brief: card.brief } : {}),
      ...(card.inject ? { inject: card.inject } : {}),
      ...(card.tools ? { tools: card.tools } : {}),
    },
    null,
    2,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Parse a card object or JSON string. Drops shape, color, kit, and overlays. */
export function parseAgentMemberCard(
  raw: unknown,
): { ok: true; card: AgentMemberCard } | { ok: false; error: string } {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: "card is not JSON" };
    }
  }
  const row = asRecord(value);
  if (!row) return { ok: false, error: "card must be an object" };
  const kind = typeof row.kind === "string" ? row.kind.trim() : "";
  if (kind !== AGENT_MEMBER_CARD_KIND) {
    return {
      ok: false,
      error: `card kind must be ${AGENT_MEMBER_CARD_KIND}`,
    };
  }
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const playbook = typeof row.playbook === "string" ? row.playbook.trim() : "";
  if (!name || !playbook) {
    return { ok: false, error: "card needs name and playbook" };
  }
  if (playbook.length > MEMBER_PLAYBOOK_MAX) {
    return {
      ok: false,
      error: `playbook exceeds ${MEMBER_PLAYBOOK_MAX} characters`,
    };
  }
  const roleRaw = typeof row.role === "string" ? row.role : "worker";
  const brief = typeof row.brief === "string" ? row.brief.trim() : "";
  const inject = row.inject === "subagent" || row.inject === "minimal"
    ? row.inject
    : undefined;
  const tools = parseMemberToolPolicy(row.tools);
  return {
    ok: true,
    card: {
      name,
      playbook,
      role: isAgentTeamSpawnRole(roleRaw) ? roleRaw : "worker",
      ...(brief ? { brief } : {}),
      ...(inject ? { inject } : {}),
      ...(tools ? { tools } : {}),
    },
  };
}
