import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AGENT_MEMBER_PACK_MARKER,
  buildAgentMemberPackZip,
  formatMemberPackInventoryLines,
  listMemberPackInventory,
  loadAgentMemberPack,
  materializeAgentMemberPack,
  parseAgentMemberPackFiles,
} from "../src/agent-member-pack.js";
import { buildStoredZip, readZipEntries } from "../src/zip-store.js";

function withMarker(files: Map<string, Buffer>): Map<string, Buffer> {
  files.set(
    AGENT_MEMBER_PACK_MARKER,
    Buffer.from(JSON.stringify({ kind: "xrk-agent-pack", version: 1 }) + "\n"),
  );
  return files;
}

describe("agent-member-pack", () => {
  it("parses manifest + playbook when marker is present", () => {
    const files = withMarker(
      new Map<string, Buffer>([
        [
          "manifest.json",
          Buffer.from(
            JSON.stringify({
              kind: "xrk-agent-pack",
              version: 1,
              name: "Scout",
              role: "researcher",
              brief: "Reads first",
            }),
          ),
        ],
        ["playbook.md", Buffer.from("# Scout\nCite paths.\n")],
        [
          "skills/scout-notes/SKILL.md",
          Buffer.from("---\nname: scout-notes\ndescription: notes\n---\n\n# Notes\n"),
        ],
        ["env/SETUP.md", Buffer.from("Install ripgrep if missing.\n")],
      ]),
    );
    const parsed = parseAgentMemberPackFiles(files);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pack.card.name).toBe("Scout");
    expect(parsed.pack.card.playbook).toContain("Cite paths");
    expect(parsed.pack.skillDirs).toEqual(["scout-notes"]);
    expect(parsed.pack.envPrep).toContain("ripgrep");
  });

  it("rejects zip without marker", () => {
    const files = new Map<string, Buffer>([
      [
        "manifest.json",
        Buffer.from(JSON.stringify({ kind: "xrk-agent-pack", name: "X", role: "worker" })),
      ],
      ["playbook.md", Buffer.from("hello\n")],
    ]);
    const parsed = parseAgentMemberPackFiles(files);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("marker");
  });

  it("round-trips via store zip", () => {
    const zip = buildAgentMemberPackZip({
      name: "Builder",
      playbook: "Implement the slice.",
      role: "worker",
    });
    const entries = readZipEntries(zip);
    expect(entries).toBeTruthy();
    expect(entries!.has(AGENT_MEMBER_PACK_MARKER)).toBe(true);
    const loaded = parseAgentMemberPackFiles(entries!);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.pack.card.name).toBe("Builder");
  });

  it("materializes into packs/ without writing workspace skills", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-pack-src-"));
    const home = mkdtempSync(path.join(tmpdir(), "xrk-pack-home-"));
    writeFileSync(
      path.join(root, AGENT_MEMBER_PACK_MARKER),
      JSON.stringify({ kind: "xrk-agent-pack", version: 1 }),
    );
    writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify({
        kind: "xrk-agent-pack",
        name: "DocWriter",
        role: "worker",
      }),
    );
    writeFileSync(path.join(root, "playbook.md"), "Write the docs.\n");
    const skillDir = path.join(root, "skills", "doc-style");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: doc-style\ndescription: doc tone\n---\n\n# Style\n",
    );

    const loaded = loadAgentMemberPack(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const placed = materializeAgentMemberPack(loaded.pack, {
      rosterWorkspaceId: "global",
      memberId: "mem_testdoc01",
      productHome: home,
    });
    expect(placed.skillNames).toEqual(["doc-style"]);
    expect(existsSync(path.join(placed.packDir, "skills", "doc-style", "SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(path.join(home, ".agents", "skills", "doc-style"))).toBe(false);
  });

  it("rejects empty playbook", () => {
    const zip = buildStoredZip([
      {
        name: AGENT_MEMBER_PACK_MARKER,
        data: Buffer.from(JSON.stringify({ kind: "xrk-agent-pack", version: 1 })),
      },
      {
        name: "manifest.json",
        data: Buffer.from(JSON.stringify({ kind: "xrk-agent-pack", name: "X" })),
      },
      { name: "playbook.md", data: Buffer.from("   \n") },
    ]);
    const entries = readZipEntries(zip)!;
    const parsed = parseAgentMemberPackFiles(entries);
    expect(parsed.ok).toBe(false);
  });

  it("rejects illegal root and skills without SKILL.md", () => {
    const badRoot = withMarker(
      new Map<string, Buffer>([
        [
          "manifest.json",
          Buffer.from(JSON.stringify({ kind: "xrk-agent-pack", name: "X", role: "worker" })),
        ],
        ["playbook.md", Buffer.from("ok\n")],
        ["notes.txt", Buffer.from("nope\n")],
      ]),
    );
    const rootParsed = parseAgentMemberPackFiles(badRoot);
    expect(rootParsed.ok).toBe(false);
    if (!rootParsed.ok) expect(rootParsed.error).toMatch(/illegal pack root/);

    const badSkill = withMarker(
      new Map<string, Buffer>([
        [
          "manifest.json",
          Buffer.from(JSON.stringify({ kind: "xrk-agent-pack", name: "X", role: "worker" })),
        ],
        ["playbook.md", Buffer.from("ok\n")],
        ["skills/orphan/references/a.md", Buffer.from("# a\n")],
      ]),
    );
    const skillParsed = parseAgentMemberPackFiles(badSkill);
    expect(skillParsed.ok).toBe(false);
    if (!skillParsed.ok) expect(skillParsed.error).toMatch(/SKILL\.md/);
  });

  it("accepts workspace/ and skills references/", () => {
    const files = withMarker(
      new Map<string, Buffer>([
        [
          "manifest.json",
          Buffer.from(
            JSON.stringify({ kind: "xrk-agent-pack", name: "Hw", role: "worker" }),
          ),
        ],
        ["playbook.md", Buffer.from("Read homework/brief.md\n")],
        [
          "skills/rubric/SKILL.md",
          Buffer.from("---\nname: rubric\ndescription: grade\n---\n# R\n"),
        ],
        ["skills/rubric/references/scale.md", Buffer.from("# scale\n")],
        ["workspace/homework/brief.md", Buffer.from("Do the worksheet.\n")],
      ]),
    );
    const parsed = parseAgentMemberPackFiles(files);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.pack.skillDirs).toEqual(["rubric"]);
    expect(parsed.pack.files.has("workspace/homework/brief.md")).toBe(true);
  });

  it("capability lines stay lean (no per-skill absolute paths)", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-pack-lean-"));
    const packHome = path.join(home, "agent-rosters", "packs", "global", "mem_x");
    for (const id of ["a", "b", "c"]) {
      const d = path.join(packHome, "skills", id);
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, "SKILL.md"), `# ${id}\n`);
    }
    mkdirSync(path.join(packHome, "workspace"), { recursive: true });
    writeFileSync(path.join(packHome, "playbook.md"), "Do work.\n");
    const inv = listMemberPackInventory({
      rosterWorkspaceId: "global",
      memberId: "mem_x",
      productHome: home,
    });
    expect(inv?.skills).toHaveLength(3);
    const lines = formatMemberPackInventoryLines(inv!);
    const blob = lines.join("\n");
    expect(blob).toContain("skills_dir:");
    expect(blob).toMatch(/skills: 3 in skill catalog/);
    expect(blob).toContain("skill tool");
    expect(blob).not.toMatch(/skill: a @/);
    expect(blob).not.toContain(path.join(packHome, "skills", "a"));
  });
});
