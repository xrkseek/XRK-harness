/**
 * `@michengai/dsh-skills-manager` — scan workspace/user skill dirs + persist
 * enable / disable / trash under `~/.xrk/dsh-skills-manager/`.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { dataPath } from "./underlying/json-store.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface SkillsManagerOptions {
  readonly xrkHome?: string;
  readonly workspaceRoot?: string;
}

interface SkillFlags {
  enabled?: boolean;
}

interface TrashEntry {
  id: string;
  name: string;
  rootKey: string;
  fromPath: string;
  trashedAt: string;
}

interface SkillsDoc {
  flags: Record<string, SkillFlags>;
  trash: TrashEntry[];
  repositories: Array<{ id: string; url: string; label?: string }>;
}

interface SkillRow {
  name: string;
  declaredName?: string;
  description: string;
  kind: string;
  kindLabel: string;
  statusLabel: string;
  rootKey: string;
  rootLabel: string;
  path: string;
  enabled: boolean;
  managerEnabled: boolean;
  modelInvocable: boolean;
  userInvocable: boolean;
  invocationPolicyValid: boolean;
  mutable: boolean;
  exists: boolean;
  loadable: boolean;
}

const STORE = createXrkDocStore<SkillsDoc>(
  ["dsh-skills-manager", "state.json"],
  { flags: {}, trash: [], repositories: [] },
);

function flagKey(rootKey: string, name: string): string {
  return `${rootKey}::${name}`;
}

function parseFrontmatter(raw: string): Record<string, string> {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = raw.slice(3, end).trim();
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function scanSkillDir(
  abs: string,
  rootKey: string,
  rootLabel: string,
  flags: Record<string, SkillFlags>,
): SkillRow[] {
  if (!existsSync(abs)) return [];
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const rows: SkillRow[] = [];
  for (const name of entries) {
    const dir = path.join(abs, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const skillMd = path.join(dir, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    let fm: Record<string, string> = {};
    let description = "";
    try {
      const raw = readFileSync(skillMd, "utf8");
      fm = parseFrontmatter(raw);
      const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
      description =
        fm.description ||
        body.split(/\r?\n/).find((l) => l.trim())?.trim() ||
        "";
    } catch {
      /* keep defaults */
    }
    const key = flagKey(rootKey, name);
    const flag = flags[key];
    const enabled = flag?.enabled !== false;
    const modelInvocable = fm["disable-model-invocation"] !== "true";
    const userInvocable = fm["user-invocable"] !== "false";
    rows.push({
      name,
      declaredName: fm.name || name,
      description,
      kind: "skill",
      kindLabel: "Skill",
      statusLabel: enabled ? "enabled" : "disabled",
      rootKey,
      rootLabel,
      path: skillMd,
      enabled,
      managerEnabled: enabled,
      modelInvocable,
      userInvocable,
      invocationPolicyValid: true,
      mutable: true,
      exists: true,
      loadable: true,
    });
  }
  return rows;
}

function collectRoots(options: SkillsManagerOptions): Array<{
  key: string;
  kind: string;
  localeKey: string;
  label: string;
  path: string;
  projectName?: string;
}> {
  const roots: Array<{
    key: string;
    kind: string;
    localeKey: string;
    label: string;
    path: string;
    projectName?: string;
  }> = [];
  const xrkSkills = dataPath(options.xrkHome, "skills");
  roots.push({
    key: "user",
    kind: "user",
    localeKey: "user",
    label: "User skills",
    path: xrkSkills,
  });
  const homeSkills = path.join(homedir(), ".agents", "skills");
  if (homeSkills !== xrkSkills) {
    roots.push({
      key: "home-agents",
      kind: "user",
      localeKey: "user",
      label: "Home .agents/skills",
      path: homeSkills,
    });
  }
  const ws = options.workspaceRoot?.trim();
  if (ws) {
    for (const rel of [
      ".agents/skills",
      ".xrk/skills",
      ".claude/skills",
      ".cursor/skills",
      ".codex/skills",
    ]) {
      const abs = path.join(ws, rel);
      roots.push({
        key: `project:${rel}`,
        kind: "project",
        localeKey: "project",
        label: rel,
        path: abs,
        projectName: path.basename(ws),
      });
    }
  }
  return roots;
}

function buildState(options: SkillsManagerOptions): Record<string, unknown> {
  const doc = STORE.read(options.xrkHome).data;
  const rootDefs = collectRoots(options);
  const roots: unknown[] = [];
  const allSkills: SkillRow[] = [];
  for (const root of rootDefs) {
    const skills = scanSkillDir(root.path, root.key, root.label, doc.flags);
    allSkills.push(...skills);
    roots.push({
      key: root.key,
      kind: root.kind,
      localeKey: root.localeKey,
      label: root.label,
      path: root.path,
      ...(root.projectName ? { projectName: root.projectName } : {}),
      skills,
      count: skills.length,
    });
  }
  const enabled = allSkills.filter((s) => s.enabled).length;
  const disabled = allSkills.length - enabled;
  return {
    roots,
    projects: rootDefs
      .filter((r) => r.kind === "project")
      .map((r) => ({
        root: r.key,
        path: r.path,
        projectName: r.projectName,
      })),
    summary: {
      total: allSkills.length,
      enabled,
      disabled,
      issues: 0,
    },
    trash: doc.trash,
    warnings: [],
    adapter: DSH_COMPAT_ADAPTER,
  };
}

function trashDir(options: SkillsManagerOptions): string {
  const dir = dataPath(options.xrkHome, "dsh-skills-manager", "trash");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function isSkillsManagerPath(pathname: string): boolean {
  return (
    pathname === "/api/dsh-skills-manager" ||
    pathname.startsWith("/api/dsh-skills-manager/")
  );
}

export async function handleSkillsManagerHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: SkillsManagerOptions = {},
): Promise<boolean> {
  if (!isSkillsManagerPath(pathname)) return false;
  const method = httpMethod(req);
  const rel = pathname.replace(/^\/api\/dsh-skills-manager\/?/, "/");

  if (
    (rel === "/state" || rel === "/" || pathname === "/api/dsh-skills-manager") &&
    (method === "GET" || method === "HEAD")
  ) {
    sendJson(res, 200, buildState(options));
    return true;
  }

  if (rel === "/repositories" && (method === "GET" || method === "HEAD")) {
    const repos = STORE.read(options.xrkHome).data.repositories;
    sendJson(res, 200, {
      repositories: repos,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (rel === "/browse") {
    if (method === "POST" || method === "PUT") await parseJsonBody(req);
    sendJson(res, 200, {
      entries: [],
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (rel === "/detail") {
    const body = method === "POST" ? await parseJsonBody(req) : {};
    const state = buildState(options) as {
      roots: Array<{ skills: SkillRow[] }>;
    };
    const name = typeof body.name === "string" ? body.name : "";
    const root = typeof body.root === "string" ? body.root : "";
    const skill = state.roots
      .flatMap((r) => r.skills)
      .find((s) => s.name === name && (!root || s.rootKey === root));
    sendJson(res, 200, {
      ok: Boolean(skill),
      skill: skill ?? null,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (method === "POST") {
    const body = await parseJsonBody(req);
    const root = typeof body.root === "string" ? body.root : "";
    const name = typeof body.name === "string" ? body.name : "";

    if (rel === "/enable" || rel === "/disable") {
      if (!root || !name) {
        sendJson(res, 400, {
          ok: false,
          error: "root-and-name-required",
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      const enabled = rel === "/enable";
      STORE.patch(options.xrkHome, (doc) => ({
        ...doc,
        flags: {
          ...doc.flags,
          [flagKey(root, name)]: { enabled },
        },
      }));
      sendJson(res, 200, {
        ok: true,
        enabled,
        ...buildState(options),
      });
      return true;
    }

    if (rel === "/delete" || rel === "/trash") {
      const state = buildState(options) as {
        roots: Array<{ key: string; path: string; skills: SkillRow[] }>;
      };
      const skill = state.roots
        .flatMap((r) => r.skills.map((s) => ({ ...s, rootPath: r.path })))
        .find((s) => s.name === name && (!root || s.rootKey === root));
      if (!skill) {
        sendJson(res, 404, {
          ok: false,
          error: "skill-not-found",
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      const id = `${Date.now()}-${skill.name}`;
      const dest = path.join(trashDir(options), id);
      try {
        mkdirSync(dest, { recursive: true });
        const fromDir = path.dirname(skill.path);
        renameSync(fromDir, path.join(dest, skill.name));
      } catch (err) {
        sendJson(res, 200, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      STORE.patch(options.xrkHome, (doc) => ({
        ...doc,
        trash: [
          {
            id,
            name: skill.name,
            rootKey: skill.rootKey,
            fromPath: skill.path,
            trashedAt: new Date().toISOString(),
          },
          ...doc.trash,
        ],
      }));
      sendJson(res, 200, { ok: true, ...buildState(options) });
      return true;
    }

    if (rel === "/trash-restore") {
      const id = typeof body.id === "string" ? body.id : "";
      const doc = STORE.read(options.xrkHome).data;
      const entry = doc.trash.find((t) => t.id === id);
      if (!entry) {
        sendJson(res, 404, {
          ok: false,
          error: "trash-not-found",
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      const src = path.join(trashDir(options), id, entry.name);
      const rootDef = collectRoots(options).find((r) => r.key === entry.rootKey);
      const destParent = rootDef?.path ?? dataPath(options.xrkHome, "skills");
      if (!existsSync(destParent)) mkdirSync(destParent, { recursive: true });
      try {
        renameSync(src, path.join(destParent, entry.name));
        rmSync(path.join(trashDir(options), id), {
          recursive: true,
          force: true,
        });
      } catch (err) {
        sendJson(res, 200, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      STORE.patch(options.xrkHome, (current) => ({
        ...current,
        trash: current.trash.filter((t) => t.id !== id),
      }));
      sendJson(res, 200, { ok: true, ...buildState(options) });
      return true;
    }

    if (rel === "/trash-delete") {
      const id = typeof body.id === "string" ? body.id : "";
      try {
        rmSync(path.join(trashDir(options), id), {
          recursive: true,
          force: true,
        });
      } catch {
        /* ignore */
      }
      STORE.patch(options.xrkHome, (doc) => ({
        ...doc,
        trash: doc.trash.filter((t) => t.id !== id),
      }));
      sendJson(res, 200, { ok: true, ...buildState(options) });
      return true;
    }

    if (rel === "/create") {
      const skillName =
        (typeof body.name === "string" && body.name.trim()) ||
        `skill-${Date.now()}`;
      const safe = skillName.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const rootDef =
        collectRoots(options).find((r) => r.key === root) ??
        collectRoots(options)[0]!;
      const dir = path.join(rootDef.path, safe);
      mkdirSync(dir, { recursive: true });
      const desc =
        typeof body.description === "string" ? body.description : safe;
      writeFileSync(
        path.join(dir, "SKILL.md"),
        `---\nname: ${safe}\ndescription: ${desc}\n---\n\n# ${safe}\n\n${desc}\n`,
        "utf8",
      );
      sendJson(res, 200, {
        ok: true,
        name: safe,
        ...buildState(options),
      });
      return true;
    }

    if (rel === "/upload" || rel === "/import") {
      sendJson(res, 200, {
        ok: true,
        imported: [],
        skipped: [],
        note: "Use /create or drop SKILL.md under a scanned skills root.",
        ...buildState(options),
      });
      return true;
    }

    if (rel === "/repositories") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) {
        sendJson(res, 400, {
          ok: false,
          error: "url-required",
          adapter: DSH_COMPAT_ADAPTER,
        });
        return true;
      }
      const id = `repo-${Date.now()}`;
      STORE.patch(options.xrkHome, (doc) => ({
        ...doc,
        repositories: [
          ...doc.repositories,
          {
            id,
            url,
            label: typeof body.label === "string" ? body.label : url,
          },
        ],
      }));
      sendJson(res, 200, {
        ok: true,
        repositories: STORE.read(options.xrkHome).data.repositories,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await parseJsonBody(req).catch(() => ({}));
  }
  sendJson(res, 200, {
    ok: true,
    path: pathname,
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}
