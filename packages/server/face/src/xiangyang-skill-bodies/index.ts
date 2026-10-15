/**
 * Product-owned Xiangyang skill catalog (bodies compile into dist).
 * Order: demand hub first, then care playbooks.
 */
import * as demand from "./demand-translate.js";
import * as homeConfig from "./home-config.js";
import * as mainline from "./mainline-sideline.js";
import * as memory from "./memory-polish.js";
import * as plugin from "./plugin-dev.js";
import * as skillMerge from "./skill-merge.js";
import * as cleanup from "./xrk-cleanup.js";

export interface XiangyangSkillSeed {
  readonly id: string;
  readonly body: string;
}

/** Bump when seed semantics change in a way operators should notice in logs. */
export const XIANGYANG_SKILLS_REVISION = 2;

export const XIANGYANG_SKILL_SEEDS: readonly XiangyangSkillSeed[] = [
  { id: demand.ID, body: demand.BODY },
  { id: plugin.ID, body: plugin.BODY },
  { id: homeConfig.ID, body: homeConfig.BODY },
  { id: cleanup.ID, body: cleanup.BODY },
  { id: memory.ID, body: memory.BODY },
  { id: mainline.ID, body: mainline.BODY },
  { id: skillMerge.ID, body: skillMerge.BODY },
];

export const XIANGYANG_SKILL_IDS: readonly string[] =
  XIANGYANG_SKILL_SEEDS.map((s) => s.id);
