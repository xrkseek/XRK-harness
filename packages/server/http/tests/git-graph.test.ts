/**
 * dsh-git-graph `/git/*` Host shapes.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleGitGraphHttp,
  isGitGraphPath,
} from "../src/dsh-compat/git-graph.js";
import { createServer } from "node:http";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function initRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "xrk-git-graph-"));
  temps.push(root);
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  writeFileSync(path.join(root, "README.md"), "hello\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "initial"]);
  return root;
}

async function post(
  pathname: string,
  body: Record<string, unknown>,
  xrkHome?: string,
): Promise<unknown> {
  const server = createServer((req, res) => {
    void handleGitGraphHttp(req, res, req.url?.split("?")[0] ?? "/", {
      ...(xrkHome ? { xrkHome } : {}),
    }).then((claimed) => {
      if (!claimed) {
        res.writeHead(404);
        res.end("no");
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    const res = await fetch(`${base}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe("git-graph /git routes", () => {
  it("matches /git paths", () => {
    expect(isGitGraphPath("/git")).toBe(true);
    expect(isGitGraphPath("/git/status")).toBe(true);
    expect(isGitGraphPath("/api/git")).toBe(false);
  });

  it("returns config · status · branches · graph envelopes", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-gg-home-"));
    temps.push(home);
    const repo = initRepo();

    const config = (await post("/git/config", {}, home)) as {
      ok?: boolean;
      value?: { worktreesHome?: string; autoIsolate?: boolean };
    };
    expect(config.ok).toBe(true);
    expect(config.value?.autoIsolate).toBe(false);
    expect(config.value?.worktreesHome).toContain("worktrees");

    const status = (await post("/git/status", { path: repo }, home)) as {
      ok?: boolean;
      value?: {
        root?: string;
        branch?: string;
        head?: string;
        dirtyFiles?: number;
        untrackedFiles?: number;
        conflicts?: number;
        operationInProgress?: boolean;
      };
    };
    expect(status.ok).toBe(true);
    expect(status.value?.root).toBeTruthy();
    expect(typeof status.value?.head).toBe("string");
    expect(status.value?.dirtyFiles).toBe(0);
    expect(status.value?.operationInProgress).toBe(false);

    const branches = (await post("/git/branches", { path: repo }, home)) as {
      ok?: boolean;
      value?: { branches?: Array<{ name: string; current: boolean }> };
    };
    expect(branches.ok).toBe(true);
    expect(branches.value?.branches?.length).toBeGreaterThan(0);

    const graph = (await post(
      "/git/graph",
      { path: repo, limit: 10 },
      home,
    )) as {
      ok?: boolean;
      value?: {
        commits?: Array<{ oid: string; parents: string[]; subject: string }>;
        hasMore?: boolean;
      };
    };
    expect(graph.ok).toBe(true);
    expect(graph.value?.commits?.[0]?.oid).toMatch(/^[0-9a-f]{40}$/i);
    expect(graph.value?.commits?.[0]?.subject).toBe("initial");
    expect(graph.value?.hasMore).toBe(false);
  });

  it("creates a branch and reports it current", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-gg-br-"));
    temps.push(home);
    const repo = initRepo();

    const created = (await post(
      "/git/create-branch",
      { path: repo, name: "feature-a" },
      home,
    )) as {
      ok?: boolean;
      value?: {
        branch?: string;
        branches?: Array<{ name: string; current: boolean }>;
      };
    };
    expect(created.ok).toBe(true);
    expect(created.value?.branch).toBe("feature-a");
    expect(
      created.value?.branches?.find((b) => b.name === "feature-a")?.current,
    ).toBe(true);

    const switched = (await post(
      "/git/switch",
      { path: repo, branch: "feature-a" },
      home,
    )) as { ok?: boolean; value?: { branch?: string } };
    expect(switched.ok).toBe(true);
    expect(switched.value?.branch).toBe("feature-a");
  });
});
