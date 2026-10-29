/**
 * Assembles full prompt stacks (durable + turn-start + spawn) for seat kinds
 * and dumps readable markdown under repo `.tmp/prompt-replay/` for human review.
 */
import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import { agentHomeDir, mintAgentHomeForMember } from "../src/agent-home.js";
import { sessionCreate } from "../src/handlers/session.js";
import { createSessionCapabilityFragmentProvider } from "../src/session-capability.js";
import { createSessionPostureFragmentProvider } from "../src/session-posture.js";
import { createBossStatusFragmentProvider } from "../src/boss-status-broadcast.js";
import { createSeatIdentityFragmentProvider } from "../src/seat-identity.js";
import { createCollabBoardFragmentProvider } from "../src/collab-board.js";
import {
  MANAGER_MEMBER_ID,
  SUNFLOWER_MEMBER_ID,
} from "../src/agent-roster-store.js";
import { XIANGYANG_WORKSPACE_ID } from "../src/xiangyang-workspace.js";
import { applySubagentSpawnPreamble } from "../src/agent-team-roles.js";

const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.tmp/prompt-replay",
);

const SEED_STANDING = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../apps/cli/seeds/standing",
);

type Frag = {
  readonly id: string;
  readonly text: string;
  readonly priority: number;
};

type LayerRow = {
  readonly layer: string;
  readonly in: boolean;
  readonly note: string;
};

function collectTurnStart(
  runtime: ReturnType<typeof createBareFaceRuntime>,
  sessionId: string,
): Frag[] {
  const providers = [
    createSessionCapabilityFragmentProvider(runtime),
    createSessionPostureFragmentProvider(runtime),
    createBossStatusFragmentProvider(runtime),
    createSeatIdentityFragmentProvider(runtime),
    createCollabBoardFragmentProvider(runtime),
  ];
  const out: Frag[] = [];
  for (const p of providers) {
    for (const row of p.produce({ sessionId })) {
      out.push({ id: row.id, text: row.text, priority: row.priority });
    }
  }
  return out.toSorted((a, b) => b.priority - a.priority);
}

function readSeed(name: string): string {
  const p = path.join(SEED_STANDING, name);
  return existsSync(p) ? readFileSync(p, "utf8") : `(missing seed ${name})`;
}

function fence(body: string): string {
  return ["```", body.trimEnd(), "```"].join("\n");
}

function layerTable(rows: readonly LayerRow[]): string {
  return [
    "| Layer | In? | Note |",
    "|---|---|---|",
    ...rows.map(
      (r) => `| ${r.layer} | ${r.in ? "YES" : "no"} | ${r.note} |`,
    ),
  ].join("\n");
}

function dumpPack(opts: {
  readonly title: string;
  readonly fileName: string;
  readonly sessionId: string;
  readonly userSays: string;
  readonly layers: readonly LayerRow[];
  readonly durableSections: readonly { readonly title: string; readonly body: string }[];
  readonly frags: readonly Frag[];
  readonly spawn?: string;
}): string {
  const body = [
    `# ${opts.title}`,
    "",
    `sessionId: \`${opts.sessionId}\``,
    "",
    "## Simulated user turn",
    "",
    `> ${opts.userSays}`,
    "",
    "## Layer map (what actually reaches the model)",
    "",
    layerTable(opts.layers),
    "",
    ...(opts.spawn
      ? [
          "## Spawn preamble (first user/message on child)",
          "",
          fence(opts.spawn),
          "",
        ]
      : []),
    "## Durable inject (agent-instructions)",
    "",
    ...opts.durableSections.flatMap((s) => [
      `### ${s.title}`,
      "",
      fence(s.body),
      "",
    ]),
    "## Turn-start fragments (priority desc)",
    "",
    ...opts.frags.flatMap((f) => [
      `### ${f.id} (priority ${f.priority})`,
      "",
      fence(f.text),
      "",
    ]),
    "## User message (after inject)",
    "",
    fence(opts.userSays),
    "",
  ].join("\n");
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, opts.fileName), body, "utf8");
  return body;
}

type ThemeHit = {
  readonly theme: string;
  readonly scenario: string;
  readonly where: string;
  readonly snippet: string;
};

function scanThemes(
  scenario: string,
  where: string,
  text: string,
  patterns: readonly { readonly theme: string; readonly re: RegExp }[],
): ThemeHit[] {
  const hits: ThemeHit[] = [];
  for (const p of patterns) {
    const m = text.match(p.re);
    if (!m) continue;
    const idx = m.index ?? 0;
    const snippet = text.slice(Math.max(0, idx - 20), idx + 80).replace(/\s+/g, " ");
    hits.push({ theme: p.theme, scenario, where, snippet });
  }
  return hits;
}

const THEMES = [
  { theme: "identity-you-are", re: /You are (?:the |经理|向日葵|施工)|office manager seat/i },
  { theme: "todo_write", re: /todo_write/ },
  { theme: "ask-blocker", re: /Ask only|one blocker|deliverable changes/i },
  { theme: "authority-mandatory", re: /mandatory|ACTIVE and MANDATORY|Instruction authority|Orders vs data|instruction_authority/i },
  { theme: "spawn-member_id", re: /member_id|subagent member/i },
  { theme: "repo-agents-not-persona", re: /Repo AGENTS\.md is not your persona/ },
  { theme: "catalog-truth", re: /[Cc]atalog = truth|[Cc]atalog=truth/ },
  { theme: "boss-speaker", re: /speaker: 老板|titles\.boss|Serve \*\*老板\*\*/ },
  { theme: "seat-manager", re: /you: 经理|titles\.manager/ },
  { theme: "seat-sunflower", re: /you: 向日葵|You are 向日葵/ },
] as const;

function writeAudit(hits: readonly ThemeHit[], packs: readonly string[]): void {
  const byTheme = new Map<string, ThemeHit[]>();
  for (const h of hits) {
    const list = byTheme.get(h.theme) ?? [];
    list.push(h);
    byTheme.set(h.theme, list);
  }

  const multi = [...byTheme.entries()]
    .map(([theme, rows]) => {
      const places = new Set(rows.map((r) => `${r.scenario}::${r.where}`));
      return { theme, places: [...places], rows };
    })
    .filter((x) => x.places.length >= 2)
    .toSorted((a, b) => b.places.length - a.places.length);

  const findings = [
    {
      id: "F1",
      sev: "fixed",
      title: "子代理 spawn 曾否定 AGENTS.md 人格（已改措辞）",
      detail:
        "Spawn now: product standing (`~/.xrk`) kept; home convention (`~/.agents`) skipped. Seat text = playbook + seat_identity. Parent-repo root AGENTS.md is not identity theater.",
    },
    {
      id: "F2",
      sev: "note",
      title: "干员家：保留产品站立，跳过家约定（Host identity audience）",
      detail:
        "Top-level agent-home sets audience=subagent|minimal → keeps `~/.xrk/AGENTS.md` · `SOUL.md`, skips `~/.agents` drafts. Seat-specific durable text is still workspace `AGENTS.md` (playbook) + seat_identity + turn-start.",
    },
    {
      id: "F3",
      sev: "med",
      title: "项目主会话：经理 playbook 不进模型，但 collab 仍甩整表 brief",
      detail:
        "Seat says 经理; catalog playbook for mem_seed_manager is **not** durable-injected on project cwd. Collab board still lists all members with briefs every turn — token heavy, overlaps seat for \"who am I\".",
    },
    {
      id: "F4",
      sev: "low",
      title: "todo_write / ask-blocker 多处重复",
      detail:
        "Standing Stance + every catalog playbook + custom agent-home playbooks. Agent-home / child see product standing + playbook. Coding / 向阳 parents see standing Stance; catalog playbook is not on those cwds.",
    },
    {
      id: "F5",
      sev: "low",
      title: "capability catalog=truth vs standing Catalog = truth",
      detail:
        "Standing read-order and child capability both assert catalog truth — intentional echo, not a conflict.",
    },
    {
      id: "F6",
      sev: "ops",
      title: "本机 ~/.xrk 指纹可能落后于 seeds",
      detail:
        "Dumps use **repo seeds** as canonical standing. Live Host still serves fingerprint-refreshed `~/.xrk` until restart/establish.",
    },
  ];

  const md = [
    "# Prompt-stack audit (simulated full contexts)",
    "",
    "Generated by `packages/server/face/tests/prompt-replay.test.ts`.",
    "",
    "## Packs",
    "",
    ...packs.map((p) => `- \`${p}\``),
    "",
    "## Findings",
    "",
    ...findings.flatMap((f) => [
      `### ${f.id} · ${f.sev} — ${f.title}`,
      "",
      f.detail,
      "",
    ]),
    "## Theme cross-hit (same theme in ≥2 places)",
    "",
    "| Theme | Places |",
    "|---|---|",
    ...multi.map(
      (m) =>
        `| ${m.theme} | ${m.places.map((p) => `\`${p}\``).join("<br>")} |`,
    ),
    "",
    "## Raw hits",
    "",
    ...hits.map(
      (h) =>
        `- **${h.theme}** · ${h.scenario} · ${h.where}: \`${h.snippet.replace(/`/g, "'")}\``,
    ),
    "",
  ].join("\n");
  writeFileSync(path.join(OUT_DIR, "00-audit.md"), md, "utf8");
}

describe("prompt-replay dumps", () => {
  it("writes full context packs + audit for project / agent-home / subagent / xiangyang", async () => {
    const runtime = createBareFaceRuntime();
    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      moodId: "21",
      statusLine: "别吵",
      bossNickname: "阿凯",
    });
    runtime.agentRoster.patchCatalogMeta(MANAGER_MEMBER_ID, {
      nickname: "阿经",
    });

    const standingAgents = readSeed("AGENTS.md");
    const standingSoul = readSeed("SOUL.md");
    const managerPlaybook =
      runtime.agentRoster.get("global", MANAGER_MEMBER_ID)?.playbook ?? "";
    const sunflowerPlaybook =
      runtime.agentRoster.get("global", SUNFLOWER_MEMBER_ID)?.playbook ?? "";

    const hits: ThemeHit[] = [];
    const note = (scenario: string, where: string, text: string) => {
      hits.push(...scanThemes(scenario, where, text, THEMES));
    };

    // --- 01 project main ---
    const root = path.join(runtime.productDir!, "code-proj");
    mkdirSync(root, { recursive: true });
    const { workspace } = runtime.workspaces.create(root);
    const projectCreated = await sessionCreate(runtime, "rp-proj", {
      workspaceId: workspace.workspaceId,
      agentPreset: "harness",
    });
    expect(projectCreated.ok).toBe(true);
    if (!projectCreated.ok) return;
    const projectId = String(
      (projectCreated.value as { sessionId: string }).sessionId,
    );
    const projectFrags = collectTurnStart(runtime, projectId);
    const projectUser = "帮我改一下登录页";
    note("01-project", "standing/AGENTS", standingAgents);
    note("01-project", "standing/SOUL", standingSoul);
    note("01-project", "catalog/manager-playbook(NOT-injected)", managerPlaybook);
    for (const f of projectFrags) note("01-project", f.id, f.text);

    dumpPack({
      title: "01 · Project main (经理 seat, coding)",
      fileName: "01-project-manager.md",
      sessionId: projectId,
      userSays: projectUser,
      layers: [
        {
          layer: "`~/.xrk/AGENTS.md` standing",
          in: true,
          note: "audience=user parent",
        },
        { layer: "`~/.xrk/SOUL.md`", in: true, note: "fingerprint standing" },
        {
          layer: "workspace `AGENTS.md`",
          in: false,
          note: "empty code-proj — manager playbook NOT here",
        },
        {
          layer: "catalog manager playbook",
          in: false,
          note: "only on agent-home / spawn path",
        },
        { layer: "`<session_capability>`", in: true, note: "harness badge" },
        { layer: "`<session_posture>`", in: false, note: "coding → empty" },
        { layer: "`<boss_status>`", in: true, note: "employee seat" },
        { layer: "`<seat_identity>`", in: true, note: "you=经理" },
        { layer: "`<external_collab_board>`", in: true, note: "full roster" },
        { layer: "spawn preamble", in: false, note: "parent" },
      ],
      durableSections: [
        {
          title: "Home standing AGENTS.md (seed canonical)",
          body: standingAgents,
        },
        {
          title: "Home standing SOUL.md (seed canonical)",
          body: standingSoul,
        },
        {
          title:
            "NOT injected — catalog mem_seed_manager playbook (for contrast)",
          body: managerPlaybook,
        },
      ],
      frags: projectFrags,
    });

    // --- 02 agent-home ---
    const member = runtime.agentRoster.upsertAtScope(
      runtime.workspaces.defaultId(),
      "global",
      {
        name: "施工员",
        playbook:
          "Precise edits. Multi-step → todo_write. Ask only when the deliverable changes — one blocker.",
        role: "worker",
        nickname: "小工",
      },
    );
    expect(member).toBeTruthy();
    const home = await mintAgentHomeForMember(
      runtime,
      member!,
      runtime.workspaces.defaultId(),
    );
    const homeAbs = agentHomeDir(
      member!.id,
      runtime.agentRoster.home ?? runtime.productDir,
    );
    const homeAgentsPath = path.join(homeAbs, "AGENTS.md");
    const homePlaybookOnDisk = readFileSync(homeAgentsPath, "utf8");
    const homeCreated = await sessionCreate(runtime, "rp-home", {
      workspaceId: home.workspaceId,
      memberId: member!.id,
    });
    expect(homeCreated.ok).toBe(true);
    if (!homeCreated.ok) return;
    const homeId = String((homeCreated.value as { sessionId: string }).sessionId);
    const homeFrags = collectTurnStart(runtime, homeId);
    const homeUser = "把这个按钮改成绿色";
    note("02-agent-home", "standing/AGENTS(KEPT)", standingAgents);
    note("02-agent-home", "workspace/AGENTS(playbook)", homePlaybookOnDisk);
    for (const f of homeFrags) note("02-agent-home", f.id, f.text);

    dumpPack({
      title: "02 · Agent-home (施工员 identity parent)",
      fileName: "02-agent-home.md",
      sessionId: homeId,
      userSays: homeUser,
      layers: [
        {
          layer: "`~/.xrk/AGENTS.md` standing",
          in: true,
          note: "product standing kept on identity audience",
        },
        { layer: "`~/.xrk/SOUL.md`", in: true, note: "product standing kept" },
        {
          layer: "`~/.agents` convention",
          in: false,
          note: "audience=minimal|subagent skips home convention drafts",
        },
        {
          layer: "workspace `AGENTS.md`",
          in: true,
          note: "synced playbook — seat-specific durable text",
        },
        { layer: "`<session_capability>`", in: true, note: "minimal / subagents=off" },
        { layer: "`<session_posture>`", in: false, note: "" },
        { layer: "`<boss_status>`", in: true, note: "" },
        { layer: "`<seat_identity>`", in: true, note: "you=施工员（小工）" },
        {
          layer: "`<external_collab_board>`",
          in: true,
          note: "roster + self row (skill-load matching)",
        },
      ],
      durableSections: [
        {
          title: "Home standing AGENTS.md (product seed — kept)",
          body: standingAgents,
        },
        {
          title: `Workspace AGENTS.md @ agent-home (${member!.id})`,
          body: homePlaybookOnDisk,
        },
      ],
      frags: homeFrags,
    });

    // --- 03 subagent ---
    const childCreated = await sessionCreate(runtime, "rp-child", {
      workspaceId: home.workspaceId,
    });
    expect(childCreated.ok).toBe(true);
    if (!childCreated.ok) return;
    const childId = String(
      (childCreated.value as { sessionId: string }).sessionId,
    );
    runtime.subagents.attach({
      parentSessionId: homeId,
      childSessionId: childId,
      mode: "one-shot",
      label: "helper",
      memberId: member!.id,
    });
    const childFrags = collectTurnStart(runtime, childId);
    const spawn = applySubagentSpawnPreamble({
      parentSessionId: homeId,
      childSessionId: childId,
      mode: "one-shot",
      label: "helper",
      role: "default",
      memberId: member!.id,
      inject: "minimal",
      cwd: homeAbs,
      inheritContext: false,
      isolatedWorktree: false,
      prompt: "改登录页按钮颜色为绿色，完成后 FINAL 回报。",
    });
    const childUser = "(task embedded in spawn preamble)";
    note("03-subagent", "spawn", spawn);
    note("03-subagent", "workspace/AGENTS(playbook-KEPT)", homePlaybookOnDisk);
    note("03-subagent", "standing/AGENTS(KEPT)", standingAgents);
    for (const f of childFrags) note("03-subagent", f.id, f.text);

    dumpPack({
      title: "03 · Subagent (parent=干员家)",
      fileName: "03-subagent.md",
      sessionId: childId,
      userSays: childUser,
      layers: [
        {
          layer: "`~/.xrk/AGENTS.md` standing",
          in: true,
          note: "product standing kept (audience=subagent|minimal)",
        },
        { layer: "`~/.xrk/SOUL.md`", in: true, note: "product standing kept" },
        {
          layer: "`~/.agents` convention",
          in: false,
          note: "home convention drafts skipped",
        },
        {
          layer: "workspace `AGENTS.md`",
          in: true,
          note: "SAME agent-home cwd — playbook KEPT",
        },
        { layer: "spawn preamble", in: true, note: "first message" },
        { layer: "`<session_capability>`", in: true, note: "delegated_child" },
        { layer: "`<boss_status>`", in: false, note: "tool children excluded" },
        { layer: "`<seat_identity>`", in: true, note: "subagent + human_face" },
        { layer: "`<external_collab_board>`", in: true, note: "squad only" },
      ],
      durableSections: [
        {
          title: "Home standing AGENTS.md (product seed — kept)",
          body: standingAgents,
        },
        {
          title:
            "Workspace AGENTS.md (KEPT for subagent — same agent-home cwd)",
          body: homePlaybookOnDisk,
        },
      ],
      frags: childFrags,
      spawn,
    });

    // --- 04 xiangyang ---
    const xyCreated = await sessionCreate(runtime, "rp-xy", {
      workspaceId: XIANGYANG_WORKSPACE_ID,
    });
    expect(xyCreated.ok).toBe(true);
    if (!xyCreated.ok) return;
    const xyId = String((xyCreated.value as { sessionId: string }).sessionId);
    const xyFrags = collectTurnStart(runtime, xyId);
    const xyUser = "帮我把登录页派给施工员改";
    note("04-xiangyang", "standing/AGENTS", standingAgents);
    note("04-xiangyang", "catalog/sunflower-playbook(NOT-injected)", sunflowerPlaybook);
    for (const f of xyFrags) note("04-xiangyang", f.id, f.text);

    dumpPack({
      title: "04 · Xiangyang (向日葵 seat, qichuang)",
      fileName: "04-xiangyang.md",
      sessionId: xyId,
      userSays: xyUser,
      layers: [
        { layer: "`~/.xrk/AGENTS.md` standing", in: true, note: "parent" },
        { layer: "`~/.xrk/SOUL.md`", in: true, note: "" },
        {
          layer: "catalog sunflower playbook",
          in: false,
          note: "not durable on ws_default unless agent-home",
        },
        { layer: "`<session_capability>`", in: true, note: "qichuang" },
        {
          layer: "`<session_posture>`",
          in: true,
          note: "orchestrator verbs",
        },
        { layer: "`<boss_status>`", in: true, note: "" },
        {
          layer: "`<seat_identity>`",
          in: true,
          note: "you=向日葵 · nickname locked",
        },
        { layer: "`<external_collab_board>`", in: true, note: "full roster" },
      ],
      durableSections: [
        {
          title: "Home standing AGENTS.md",
          body: standingAgents,
        },
        {
          title: "NOT injected — catalog sunflower playbook (contrast)",
          body: sunflowerPlaybook,
        },
      ],
      frags: xyFrags,
    });

    writeAudit(hits, [
      "00-audit.md",
      "01-project-manager.md",
      "02-agent-home.md",
      "03-subagent.md",
      "04-xiangyang.md",
    ]);

    expect(projectFrags.some((f) => f.text.includes("<seat_identity>"))).toBe(
      true,
    );
    expect(homeFrags.some((f) => f.text.includes("施工员"))).toBe(true);
    expect(childFrags.some((f) => f.text.includes("<boss_status>"))).toBe(false);
    expect(spawn).toContain("cwd workspace AGENTS.md");
    expect(spawn).toContain("<seat_identity>");
    expect(spawn).not.toContain("Repo AGENTS.md is not your persona");
    expect(xyFrags.some((f) => f.text.includes("<session_posture>"))).toBe(
      true,
    );
    expect(xyFrags.some((f) => f.text.includes("向日葵"))).toBe(true);
    expect(existsSync(path.join(OUT_DIR, "00-audit.md"))).toBe(true);
  });
});
