/**
 * `xrkh skill` — install / remove / list workspace skills under
 * `<workspace>/.agents/skills` (or `XRK_SKILLS_DIR` / `--dir`).
 *
 * Complements `xrkh plugin` (which owns the `~/.xrk/plugins` user layer):
 * skills are workspace-scoped, validated, and fail closed — a candidate
 * without a parseable `SKILL.md` is rejected and nothing is written outside
 * the skills root.
 */
import path from "node:path";
import {
  installSkill,
  listInstalledSkills,
  removeInstalledSkill,
  resolveInstalledSkillsRoot,
  SkillInstallError,
  type SkillInstallOptions,
} from "@xrkseek/workspace";

export function skillHelpText(): string {
  return `xrkh skill — manage workspace skills (bin also: xrk-harness)

Usage:
  xrkh skill add <spec…> [--force] [--ref <git-ref>]
  xrkh skill remove <name…>
  xrkh skill list [--json]
  xrkh skill path
  xrkh skill help

Specs:
  ./path  file:./path  link:./path   local skill directory (or collection)
  github:owner/repo                  GitHub shorthand
  git:https://…  git+https://…       explicit git remote
  https://…  ssh://…  git@…          git remote
  <spec>#subdir                      one skill inside a multi-skill repo

Flags:
  --workspace <path>   Workspace root (default: cwd)
  --dir <path>         Skills root (default: .agents/skills, or XRK_SKILLS_DIR)
  --force              Overwrite an existing skill (add)
  --ref <git-ref>      Clone a branch / tag (add, git specs)
  --json               NDJSON result on stdout (add / remove / list)

Root:
  default  <workspace>/.agents/skills
  override XRK_SKILLS_DIR (absolute, or relative to the workspace)

A repository with several skills must select one with #subdir; installs are
validated and fail closed (no silent partial copy).

Examples:
  xrkh skill add ./skills/office-ping
  xrkh skill add github:acme/skills#pdf-tools --force
  xrkh skill list
  xrkh skill remove office-ping
`;
}

interface SkillCliFlags {
  readonly workspace: string;
  readonly dir?: string;
  readonly force: boolean;
  readonly ref?: string;
  readonly json: boolean;
}

function parseSkillFlags(argv: readonly string[]): {
  readonly positionals: readonly string[];
  readonly flags: SkillCliFlags;
} {
  const rest = [...argv];
  const positionals: string[] = [];
  let workspace = process.cwd();
  let dir: string | undefined;
  let force = false;
  let ref: string | undefined;
  let json = false;

  const takeValue = (flag: string, inline?: string): string => {
    if (inline !== undefined) {
      if (!inline.trim()) throw new Error(`${flag} needs a value`);
      return inline;
    }
    const next = rest.shift();
    if (next === undefined || !next.trim()) {
      throw new Error(`${flag} needs a value`);
    }
    return next;
  };

  while (rest.length > 0) {
    const a = rest.shift()!;
    if (a === "--workspace") {
      workspace = takeValue("--workspace");
      continue;
    }
    if (a.startsWith("--workspace=")) {
      workspace = takeValue("--workspace", a.slice("--workspace=".length));
      continue;
    }
    if (a === "--dir") {
      dir = takeValue("--dir");
      continue;
    }
    if (a.startsWith("--dir=")) {
      dir = takeValue("--dir", a.slice("--dir=".length));
      continue;
    }
    if (a === "--force") {
      force = true;
      continue;
    }
    if (a === "--ref") {
      ref = takeValue("--ref");
      continue;
    }
    if (a.startsWith("--ref=")) {
      ref = takeValue("--ref", a.slice("--ref=".length));
      continue;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a.startsWith("-") && a !== "-") {
      throw new Error(`unknown flag: ${a}`);
    }
    positionals.push(a);
  }

  return {
    positionals,
    flags: {
      workspace: path.resolve(workspace),
      ...(dir !== undefined ? { dir } : {}),
      force,
      ...(ref !== undefined ? { ref } : {}),
      json,
    },
  };
}

function toOptions(flags: SkillCliFlags): SkillInstallOptions {
  return {
    workspaceRoot: flags.workspace,
    ...(flags.dir !== undefined ? { skillsRoot: flags.dir } : {}),
  };
}

export async function runSkill(argv: readonly string[]): Promise<number> {
  const raw = [...argv];
  if (raw.length === 0 || raw[0] === "help" || raw[0] === "--help" || raw[0] === "-h") {
    process.stdout.write(skillHelpText());
    return 0;
  }

  const sub = raw.shift()!;

  try {
    const { positionals, flags } = parseSkillFlags(raw);
    const options = toOptions(flags);

    switch (sub) {
      case "add": {
        if (positionals.length === 0) {
          throw new Error("skill add needs at least one <spec>");
        }
        const results = positionals.map((spec) =>
          installSkill(spec, {
            ...options,
            ...(flags.force ? { force: true } : {}),
            ...(flags.ref !== undefined ? { ref: flags.ref } : {}),
          }),
        );
        for (const r of results) {
          if (flags.json) {
            process.stdout.write(`${JSON.stringify(r)}\n`);
          } else {
            const from = r.url ? ` (${r.url})` : "";
            process.stdout.write(`installed ${r.name}${from} → ${r.directory}\n`);
          }
        }
        return 0;
      }
      case "remove":
      case "rm": {
        if (positionals.length === 0) {
          throw new Error("skill remove needs at least one <name>");
        }
        for (const name of positionals) {
          const removed = removeInstalledSkill(name, options);
          if (flags.json) {
            process.stdout.write(`${JSON.stringify({ name, removed })}\n`);
          } else {
            process.stdout.write(`${removed ? "removed" : "missing"} ${name}\n`);
          }
        }
        return 0;
      }
      case "list":
      case "ls": {
        const skillsRoot = resolveInstalledSkillsRoot(options);
        const installed = listInstalledSkills(options);
        if (flags.json) {
          process.stdout.write(
            `${JSON.stringify({ root: skillsRoot, skills: installed })}\n`,
          );
          return 0;
        }
        if (installed.length === 0) {
          process.stdout.write(`(none)  root=${skillsRoot}\n`);
          return 0;
        }
        process.stdout.write(`root=${skillsRoot}\n`);
        for (const s of installed) {
          const desc = s.description ? `\t${s.description}` : "";
          process.stdout.write(`${s.name}${desc}\n`);
        }
        return 0;
      }
      case "path": {
        process.stdout.write(`${resolveInstalledSkillsRoot(options)}\n`);
        return 0;
      }
      default:
        throw new Error(
          `unknown skill subcommand: ${sub} (try: add | remove | list | path | help)`,
        );
    }
  } catch (err) {
    const message =
      err instanceof SkillInstallError
        ? `${err.message} [${err.code}]`
        : err instanceof Error
          ? err.message
          : String(err);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }
}
