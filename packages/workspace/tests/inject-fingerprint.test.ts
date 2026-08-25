import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeInjectFingerprint,
  skillDirFingerprint,
} from "../src/inject-fingerprint.js";

describe("inject-fingerprint", () => {
  it("changes when a standing instruction file is touched", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fp-"));
    const product = path.join(root, ".xrk");
    await mkdir(product, { recursive: true });
    await writeFile(path.join(product, "AGENTS.md"), "v1", "utf8");

    const before = await computeInjectFingerprint({
      root,
      productDir: product,
      includeUserHome: false,
    });
    await writeFile(path.join(product, "AGENTS.md"), "v2", "utf8");
    const after = await computeInjectFingerprint({
      root,
      productDir: product,
      includeUserHome: false,
    });
    expect(after).not.toBe(before);
  });

  it("skillDirFingerprint tracks SKILL.md mtime without reading body", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fp-sk-"));
    const skills = path.join(root, "skills", "ping");
    await mkdir(skills, { recursive: true });
    await writeFile(path.join(skills, "SKILL.md"), "---\ndescription: a\n---\n", "utf8");
    const a = await skillDirFingerprint(path.join(root, "skills"));
    const skillFile = path.join(skills, "SKILL.md");
    await writeFile(skillFile, "---\ndescription: b\n---\n", "utf8");
    const bumped = new Date(Date.now() + 2_000);
    await utimes(skillFile, bumped, bumped);
    const b = await skillDirFingerprint(path.join(root, "skills"));
    expect(b).not.toBe(a);
  });

  it("ignores home skill churn unless includeUserHomeSkills is true", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fp-home-"));
    const product = path.join(root, ".xrk");
    const home = path.join(root, "fake-home");
    await mkdir(product, { recursive: true });
    await mkdir(path.join(home, ".agents", "skills", "home-only"), {
      recursive: true,
    });
    await writeFile(
      path.join(home, ".agents", "skills", "home-only", "SKILL.md"),
      "---\ndescription: h\n---\n",
      "utf8",
    );

    const before = await computeInjectFingerprint({
      root,
      productDir: product,
      homeDir: home,
    });
    await writeFile(
      path.join(home, ".agents", "skills", "home-only", "SKILL.md"),
      "---\ndescription: h2\n---\n",
      "utf8",
    );
    const afterDefault = await computeInjectFingerprint({
      root,
      productDir: product,
      homeDir: home,
    });
    expect(afterDefault).toBe(before);

    const withHome = await computeInjectFingerprint({
      root,
      productDir: product,
      homeDir: home,
      includeUserHomeSkills: true,
    });
    expect(withHome).not.toBe(before);
  });
});
