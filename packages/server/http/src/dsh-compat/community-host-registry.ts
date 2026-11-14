/**
 * Live contributions from community Cordis host halves (tools / skills /
 * prompt sections / index-inject globals). Host reads these on agent resolve.
 */
import type { ToolDefinition } from "@xrkseek/core-tools";

export type CommunityPromptSection = {
  readonly name: string;
  readonly order: number;
  readonly text: () => string | Promise<string>;
};

export type CommunityIndexGlobal = {
  readonly name: string;
  readonly value: unknown;
};

/** Shape-compatible with `@xrkseek/context-fragments` ContextFragment. */
export type CommunityPromptFragment = {
  readonly id: string;
  readonly kind: "additional_context";
  readonly phase: "turn-start";
  readonly text: string;
  readonly priority: number;
};

export type CommunityHostPackageSurfaces = {
  readonly packageName: string;
  readonly tools: readonly ToolDefinition[];
  readonly skillDirs: readonly string[];
  readonly promptSections: readonly CommunityPromptSection[];
  readonly indexGlobals: readonly CommunityIndexGlobal[];
};

const byPackage = new Map<string, CommunityHostPackageSurfaces>();

function sameToolRefs(
  a: readonly ToolDefinition[],
  b: readonly ToolDefinition[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((tool, i) => tool === b[i]);
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function samePromptRefs(
  a: readonly CommunityPromptSection[],
  b: readonly CommunityPromptSection[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) => row === b[i]);
}

function sameIndexGlobals(
  a: readonly CommunityIndexGlobal[],
  b: readonly CommunityIndexGlobal[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (row, i) => row.name === b[i]!.name && row.value === b[i]!.value,
  );
}

/** Replace (or clear) the live surface snapshot for one community package. */
export function publishCommunityHostSurfaces(
  packageName: string,
  surfaces: Omit<CommunityHostPackageSurfaces, "packageName"> | undefined,
): void {
  const name = packageName.trim();
  if (!name) return;
  if (!surfaces) {
    byPackage.delete(name);
    return;
  }
  const prev = byPackage.get(name);
  if (
    prev &&
    sameToolRefs(prev.tools, surfaces.tools) &&
    sameStringList(prev.skillDirs, surfaces.skillDirs) &&
    samePromptRefs(prev.promptSections, surfaces.promptSections) &&
    sameIndexGlobals(prev.indexGlobals, surfaces.indexGlobals)
  ) {
    return;
  }
  byPackage.set(name, { packageName: name, ...surfaces });
}

/** Drop one package's surfaces (soft-disable / stopHostPackage). */
export function clearCommunityHostSurfaces(packageName: string): void {
  publishCommunityHostSurfaces(packageName, undefined);
}

export function listCommunityHostPackages(): readonly CommunityHostPackageSurfaces[] {
  return [...byPackage.values()];
}

/** Flatten tools from every live community host (first package wins on name). */
export function listCommunityHostTools(): readonly ToolDefinition[] {
  const seen = new Set<string>();
  const out: ToolDefinition[] = [];
  for (const row of byPackage.values()) {
    for (const tool of row.tools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      out.push(tool);
    }
  }
  return out;
}

/**
 * Sync live community tools onto a Host ToolRegistry.
 * Tracks names we inserted so Settings remount can drop meme_render etc.
 * without touching built-in tools that happen to share a name.
 */
export function syncCommunityHostToolsOnto(
  registry: {
    get(name: string): ToolDefinition | undefined;
    register(tool: ToolDefinition): void;
    replace(tool: ToolDefinition): void;
    unregister(name: string): boolean;
  },
  tracked: Set<string>,
): void {
  const live = listCommunityHostTools();
  const liveNames = new Set(live.map((t) => t.name));
  for (const name of [...tracked]) {
    if (liveNames.has(name)) continue;
    registry.unregister(name);
    tracked.delete(name);
  }
  for (const tool of live) {
    const existing = registry.get(tool.name);
    if (!existing) {
      registry.register(tool);
      tracked.add(tool.name);
      continue;
    }
    if (tracked.has(tool.name)) {
      registry.replace(tool);
    }
    // else: built-in owns the name — leave it
  }
}

/**
 * Name-set fingerprint for agentCache invalidate when tools appear/disappear.
 * Same-name remounts (new execute closures) are applied via
 * {@link syncCommunityHostToolsOnto} `replace` on the next resolve — no thrash
 * from nekowhale's 1s republish poll.
 */
export function communityHostToolsFingerprint(): string {
  return listCommunityHostTools()
    .map((t) => t.name)
    .sort()
    .join("\0");
}

/** Skill directories staged beside community packages (SKILL.md trees). */
export function listCommunityHostSkillDirs(): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of byPackage.values()) {
    for (const dir of row.skillDirs) {
      const key = dir.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Turn-start fragments from community systemPrompt.section registrations. */
export async function collectCommunityPromptFragments(): Promise<
  readonly CommunityPromptFragment[]
> {
  const sections: Array<{
    packageName: string;
    section: CommunityPromptSection;
  }> = [];
  for (const row of byPackage.values()) {
    for (const section of row.promptSections) {
      sections.push({ packageName: row.packageName, section });
    }
  }
  sections.sort(
    (a, b) =>
      a.section.order - b.section.order ||
      a.section.name.localeCompare(b.section.name),
  );
  const out: CommunityPromptFragment[] = [];
  for (const { packageName, section } of sections) {
    let text: string;
    try {
      text = String((await section.text()) ?? "").trim();
    } catch {
      continue;
    }
    if (!text) continue;
    out.push({
      id: `community:${packageName}:${section.name}`,
      kind: "additional_context",
      phase: "turn-start",
      text,
      priority: Math.max(0, 10_000 - section.order),
    });
  }
  return out;
}

/** Globals pushed via Cordis `webserver/index-inject` (e.g. `__NEKOWHALE_PET__`). */
export function listCommunityIndexGlobals(): readonly CommunityIndexGlobal[] {
  const out: CommunityIndexGlobal[] = [];
  const seen = new Set<string>();
  for (const row of byPackage.values()) {
    for (const g of row.indexGlobals) {
      const name = g.name.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(g);
    }
  }
  return out;
}

/** Context-fragment provider Host can append to composition turn-start. */
export function createCommunityPromptFragmentProvider(): {
  readonly id: string;
  readonly phases: readonly ["turn-start"];
  produce(): Promise<readonly CommunityPromptFragment[]>;
} {
  return {
    id: "community-cordis-prompt",
    phases: ["turn-start"],
    produce: () => collectCommunityPromptFragments(),
  };
}
