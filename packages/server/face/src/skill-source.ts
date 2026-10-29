/**
 * Classify a skill directory into wire-safe layer + vendor (no absolute paths).
 */

import path from "node:path";
import {
  SKILL_VENDOR_PRIORITY,
  resolveUserProductHome,
} from "@xrkseek/workspace";

/** Standing catalog layer for `skill.list`. */
export type SkillListLayer = "workspace" | "home" | "other";

/** Vendor tree under a skill root (matches SKILL_VENDOR_PRIORITY suffixes). */
export type SkillListVendor =
  | "xrk"
  | "agents"
  | "cursor"
  | "claude"
  | "codex"
  | "other";

/** Wire projection for one skill's origin. */
export interface SkillListSource {
  readonly layer: SkillListLayer;
  readonly vendor: SkillListVendor;
  /** Relative root label, e.g. `.xrk/skills` or `~/.claude/skills`. */
  readonly root: string;
}

const VENDOR_BY_SUFFIX: ReadonlyArray<{
  readonly suffix: string;
  readonly vendor: SkillListVendor;
}> = [
  { suffix: ".xrk/skills", vendor: "xrk" },
  { suffix: ".agents/skills", vendor: "agents" },
  { suffix: ".cursor/skills", vendor: "cursor" },
  { suffix: ".claude/skills", vendor: "claude" },
  { suffix: ".codex/skills", vendor: "codex" },
];

function vendorFromDir(skillsParent: string): SkillListVendor {
  const norm = path.resolve(skillsParent).replace(/\\/g, "/");
  for (const row of VENDOR_BY_SUFFIX) {
    if (norm.endsWith(row.suffix)) return row.vendor;
  }
  for (const suffix of SKILL_VENDOR_PRIORITY) {
    if (norm.endsWith(suffix)) {
      const leaf = suffix.split("/")[0]?.replace(/^\./, "") ?? "other";
      if (
        leaf === "xrk" ||
        leaf === "agents" ||
        leaf === "cursor" ||
        leaf === "claude" ||
        leaf === "codex"
      ) {
        return leaf;
      }
    }
  }
  return "other";
}

function rootLabel(
  layer: SkillListLayer,
  vendor: SkillListVendor,
  skillsParent: string,
): string {
  const match = VENDOR_BY_SUFFIX.find((row) =>
    path.resolve(skillsParent).replace(/\\/g, "/").endsWith(row.suffix),
  );
  const rel = match?.suffix ?? path.basename(path.dirname(skillsParent)) + "/skills";
  if (layer === "home") return `~/${rel}`;
  if (layer === "workspace") return rel.startsWith(".") ? rel : `./${rel}`;
  return rel;
}

/**
 * Map a skill `directory` (…/skills/<name>) to a wire source.
 * @param skillDirectory - absolute path to the skill folder (contains SKILL.md)
 * @param workspaceRoot - session / Host project root
 * @param homeDir - optional test override for product-home resolution
 */
export function classifySkillSource(
  skillDirectory: string,
  workspaceRoot: string,
  homeDir?: string,
): SkillListSource {
  const skillsParent = path.resolve(skillDirectory, "..");
  const ws = path.resolve(workspaceRoot);
  const underWs =
    skillsParent === ws ||
    skillsParent.startsWith(ws + path.sep) ||
    skillsParent.replace(/\\/g, "/").startsWith(ws.replace(/\\/g, "/") + "/");

  // Relocated `XRK_HOME` may not end with `.xrk/skills` — still product home.
  const productSkills = path.resolve(
    path.join(resolveUserProductHome(homeDir), "skills"),
  );
  if (skillsParent === productSkills) {
    return {
      layer: "home",
      vendor: "xrk",
      root: "~/.xrk/skills",
    };
  }

  const layer: SkillListLayer = underWs ? "workspace" : "home";
  // productDir/skills and odd overlays stay "other" when not under a known vendor.
  const vendor = vendorFromDir(skillsParent);
  const effectiveLayer: SkillListLayer =
    vendor === "other" && !underWs ? "other" : layer;
  return {
    layer: effectiveLayer,
    vendor,
    root: rootLabel(effectiveLayer, vendor, skillsParent),
  };
}
