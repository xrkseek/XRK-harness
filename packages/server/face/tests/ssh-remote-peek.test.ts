/**
 * Host-boot peek of `ssh-remote` from settings.yaml (before Face exists).
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  peekSettingsYamlSection,
  resetLastGoodConfigCaches,
} from "../src/settings-document.js";

afterEach(() => {
  resetLastGoodConfigCaches();
});

describe("peekSettingsYamlSection", () => {
  it("reads ssh-remote user layer for Host SSH resolve", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-ssh-peek-"));
    await writeFile(
      path.join(dir, "settings.yaml"),
      [
        "ssh-remote:",
        "  host: box",
        "  workspace: /work",
        "  user: me",
        "  port: 2222",
        "  keyPath: /home/me/.ssh/id_ed25519",
        "",
      ].join("\n"),
      "utf8",
    );
    expect(peekSettingsYamlSection(dir, "ssh-remote")).toEqual({
      host: "box",
      workspace: "/work",
      user: "me",
      port: 2222,
      keyPath: "/home/me/.ssh/id_ed25519",
    });
    expect(peekSettingsYamlSection(dir, "missing")).toBeUndefined();
  });

  it("returns undefined when settings.yaml is absent", () => {
    expect(
      peekSettingsYamlSection(
        path.join(tmpdir(), "xrk-ssh-peek-absent-" + Date.now()),
        "ssh-remote",
      ),
    ).toBeUndefined();
  });
});
