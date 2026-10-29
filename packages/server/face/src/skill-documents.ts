/**
 * Runtime inject catalog for Settings UI — same paths Host actually injects
 * (collectEcosystemInstructions + standing skill catalog), not a static guess list.
 */

import path from "node:path";
import {
  collectEcosystemInstructions,
  createInjectBudget,
  formatAvailableSkillsXml,
  listStandingCatalogSkills,
} from "@xrkseek/workspace";

/** Catalog layer for one inject document. */
export type InjectDocumentLayer = "workspace" | "home" | "session";

/** Kind of standing / turn-start inject payload. */
export type InjectDocumentKind =
  | "instruction"
  | "skill-catalog"
  | "session-capability"
  | "session-posture"
  | "collab-board";

/** One inject document row (exists in the live inject set). */
export interface InjectDocumentEntry {
  readonly path: string;
  readonly layer: InjectDocumentLayer;
  readonly kind: InjectDocumentKind;
  /** Characters in the clipped inject body. */
  readonly bytes: number;
}

/** Synthetic path for the model-facing skill catalog card. */
export const SKILL_CATALOG_PATH = "skills://catalog";

const LIST_BUDGET_CHARS = 128_000;
const MAX_DOCUMENT_CHARS = 200_000;

function layerForPath(logicalPath: string): InjectDocumentLayer {
  if (logicalPath.startsWith("~/") || logicalPath.startsWith("~/.xrk")) {
    return "home";
  }
  return "workspace";
}

/**
 * List inject sections Host would put on the standing prompt for this cwd
 * (audience=user, home layer on, workspace skills catalog on).
 */
export async function listInjectDocuments(
  workspaceRoot: string,
  options?: { readonly homeDir?: string; readonly maxChars?: number },
): Promise<readonly InjectDocumentEntry[]> {
  const root = path.resolve(workspaceRoot);
  const productDir = path.join(root, ".xrk");
  const maxChars = options?.maxChars ?? LIST_BUDGET_CHARS;
  const budget = createInjectBudget(maxChars);
  const sections = await collectEcosystemInstructions({
    root,
    productDir,
    budget,
    includeUserHome: true,
    audience: "user",
    ...(options?.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
  });

  const out: InjectDocumentEntry[] = sections
    .filter((s) => s.body.trim().length > 0)
    .map((s) => ({
      path: s.path,
      layer: layerForPath(s.path),
      kind: "instruction" as const,
      bytes: s.body.length,
    }));

  // Standing skill catalog (= Host inject + skill tool roots).
  const skills = await listStandingCatalogSkills({
    workspaceRoot: root,
    productDir: path.join(root, ".xrk"),
    audience: "user",
    ...(options?.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
  });
  const catalog = formatAvailableSkillsXml(skills);
  if (catalog.trim()) {
    out.push({
      path: SKILL_CATALOG_PATH,
      layer: "workspace",
      kind: "skill-catalog",
      bytes: catalog.length,
    });
  }

  return out;
}

/**
 * Read one inject document body by logical path from the live inject set.
 */
export async function readInjectDocument(
  workspaceRoot: string,
  logicalPath: string,
  options?: { readonly homeDir?: string; readonly maxChars?: number },
): Promise<{ readonly path: string; readonly content: string } | undefined> {
  const root = path.resolve(workspaceRoot);
  if (logicalPath === SKILL_CATALOG_PATH) {
    const skills = await listStandingCatalogSkills({
      workspaceRoot: root,
      productDir: path.join(root, ".xrk"),
      audience: "user",
      ...(options?.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
    });
    const catalog = formatAvailableSkillsXml(skills);
    if (!catalog.trim()) return undefined;
    return { path: SKILL_CATALOG_PATH, content: catalog };
  }

  const productDir = path.join(root, ".xrk");
  const maxChars = options?.maxChars ?? LIST_BUDGET_CHARS;
  const budget = createInjectBudget(maxChars);
  const sections = await collectEcosystemInstructions({
    root,
    productDir,
    budget,
    includeUserHome: true,
    audience: "user",
    ...(options?.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
  });
  const hit = sections.find((s) => s.path === logicalPath);
  if (!hit?.body.trim()) return undefined;
  const content =
    hit.body.length > MAX_DOCUMENT_CHARS
      ? `${hit.body.slice(0, MAX_DOCUMENT_CHARS)}\n\n… [truncated]`
      : hit.body;
  return { path: hit.path, content };
}
