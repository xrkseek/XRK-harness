/**
 * Fetch a package with `npm pack` and unpack it to a temp directory.
 * Relative path / file: / link: specs are anchored to `cwd` (DSH posture).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface UnpackedPackage {
  readonly root: string;
  readonly pkg: Record<string, unknown>;
  readonly cleanup: () => void;
}

/**
 * Rewrite relative filesystem specs against the invoking directory.
 * Absolute specs, registry names, and github:/git URLs pass through.
 */
export function anchorPathSpec(argument: string, cwd: string): string {
  const match =
    /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument);
  if (match?.groups?.path === undefined) return argument;
  const prefix = match.groups.prefix ?? "";
  return `${prefix}${path.resolve(cwd, match.groups.path)}`;
}

function readPkgJson(dir: string): Record<string, unknown> {
  const text = readFileSync(path.join(dir, "package.json"), "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

function extractTarball(tgz: string, extractDir: string): void {
  mkdirSync(extractDir, { recursive: true });
  const tarBin = process.platform === "win32" ? "tar.exe" : "tar";
  const result = spawnSync(tarBin, ["-xzf", tgz, "-C", extractDir], {
    encoding: "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `failed to extract ${path.basename(tgz)}: ${(result.stderr || result.stdout || result.error?.message || "").trim()}`,
    );
  }
}

/**
 * Prefer a local directory when the spec already points at an unpacked
 * package (file:/link:/relative path with package.json). Otherwise npm pack.
 */
export function fetchPackage(
  spec: string,
  cwd: string = process.cwd(),
): UnpackedPackage {
  const anchored = anchorPathSpec(spec.trim(), cwd);
  const bare =
    anchored.startsWith("file:") || anchored.startsWith("link:")
      ? anchored.slice(anchored.indexOf(":") + 1)
      : anchored;

  const looksLikePath =
    !/^(git\+|github:|https?:|npm:)/i.test(anchored) &&
    (path.isAbsolute(bare) ||
      bare.startsWith(".") ||
      /[/\\]/.test(bare));

  if (looksLikePath) {
    const abs = path.resolve(cwd, bare);
    if (existsSync(path.join(abs, "package.json"))) {
      return {
        root: abs,
        pkg: readPkgJson(abs),
        cleanup: () => {},
      };
    }
  }

  const stage = mkdtempSync(path.join(tmpdir(), "xrk-plugin-pack-"));
  const cleanup = () => {
    try {
      rmSync(stage, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  try {
    const result = spawnSync(
      "npm",
      ["pack", anchored, "--pack-destination", stage],
      {
        cwd,
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new Error(
          "npm not found on PATH — install Node.js (includes npm) to manage plugins",
        );
      }
      throw result.error;
    }
    if ((result.status ?? 1) !== 0) {
      const err = (result.stderr || result.stdout || "").trim();
      throw new Error(
        `npm pack failed for ${JSON.stringify(anchored)}${err ? `: ${err}` : ""}`,
      );
    }

    const tgz = readdirSync(stage).find((n) => n.endsWith(".tgz"));
    if (!tgz) {
      throw new Error(
        `npm pack produced no tarball for ${JSON.stringify(anchored)}`,
      );
    }
    const extractDir = path.join(stage, "extract");
    extractTarball(path.join(stage, tgz), extractDir);

    const packageRoot = path.join(extractDir, "package");
    if (!existsSync(path.join(packageRoot, "package.json"))) {
      throw new Error(
        `unexpected pack layout for ${anchored}: missing package/`,
      );
    }
    return {
      root: packageRoot,
      pkg: readPkgJson(packageRoot),
      cleanup,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}
