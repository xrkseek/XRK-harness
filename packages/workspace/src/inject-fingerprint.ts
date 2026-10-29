import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  HOME_OS_INSTRUCTION_FINGERPRINT_MARKERS,
  HOME_PRODUCT_INSTRUCTION_FINGERPRINT_MARKERS,
  WORKSPACE_INSTRUCTION_FINGERPRINT_MARKERS,
} from "./inject-sources.js";
import {
  resolveSkillDirs,
  skillDirsFingerprint,
} from "./skill-dirs.js";
import { standingCatalogSkillDirCandidates } from "./standing-skill-dirs.js";
import { resolveUserProductHome } from "./user-product-home.js";

export interface InjectFingerprintOptions {
  readonly root: string;
  readonly productDir: string;
  readonly includeUserHome?: boolean;
  readonly homeDir?: string;
  readonly includeUserHomeSkills?: boolean;
  readonly extraSkillDirs?: readonly string[];
  /** When `minimal`, workspace skill trees are omitted from the standing catalog. */
  readonly audience?: "user" | "subagent" | "minimal";
}

async function markerFingerprint(base: string, rel: string): Promise<string> {
  const abs = path.join(base, ...rel.split("/"));
  try {
    const st = await stat(abs);
    return `${rel}:${st.mtimeMs}:${st.size}`;
  } catch {
    return `${rel}:missing`;
  }
}

/**
 * Cheap invalidation token — stat markers only, no file reads.
 * Markers follow {@link HOME_OS_INSTRUCTION_FINGERPRINT_MARKERS},
 * {@link HOME_PRODUCT_INSTRUCTION_FINGERPRINT_MARKERS}, and
 * {@link WORKSPACE_INSTRUCTION_FINGERPRINT_MARKERS} in `inject-sources.ts`.
 */
export async function computeInjectFingerprint(
  options: InjectFingerprintOptions,
): Promise<string> {
  const root = path.resolve(options.root);
  const productDir = path.resolve(options.productDir);
  const parts: string[] = [`root:${root}`, `product:${productDir}`];

  if (options.includeUserHome !== false) {
    const skipHomeConvention =
      options.audience === "subagent" || options.audience === "minimal";
    if (!skipHomeConvention) {
      const home = path.resolve(options.homeDir ?? homedir());
      for (const rel of HOME_OS_INSTRUCTION_FINGERPRINT_MARKERS) {
        parts.push(`home:${await markerFingerprint(home, rel)}`);
      }
    }
    const userProduct = resolveUserProductHome(options.homeDir);
    for (const rel of HOME_PRODUCT_INSTRUCTION_FINGERPRINT_MARKERS) {
      parts.push(
        `home-product:${await markerFingerprint(userProduct, rel)}`,
      );
    }
  }

  for (const rel of WORKSPACE_INSTRUCTION_FINGERPRINT_MARKERS) {
    parts.push(`ws:${await markerFingerprint(root, rel)}`);
  }
  parts.push(`ws-product:${await markerFingerprint(productDir, "AGENTS.md")}`);

  const skillDirs = await resolveSkillDirs({
    skillDirs: standingCatalogSkillDirCandidates({
      workspaceRoot: root,
      productDir,
      ...(options.audience !== undefined
        ? { audience: options.audience }
        : {}),
      ...(options.extraSkillDirs?.length
        ? { extraSkillDirs: options.extraSkillDirs }
        : {}),
      ...(options.includeUserHome !== undefined
        ? { includeUserHome: options.includeUserHome }
        : {}),
      includeUserHomeSkills: options.includeUserHomeSkills === true,
      ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    }),
  });
  parts.push(await skillDirsFingerprint(skillDirs));

  return parts.join("|");
}

export { skillDirFingerprint, skillDirsFingerprint } from "./skill-dirs.js";
