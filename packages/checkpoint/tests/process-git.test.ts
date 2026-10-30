import { afterEach, describe, expect, it, vi } from "vitest";
import { createProcessGitRunner } from "../src/index.js";

/**
 * `createProcessGitRunner` is the seam every real snapshot goes through, so
 * these assertions run against a real child process (node, not git) that
 * prints what it inherited.
 */
const node = createProcessGitRunner(process.execPath);

function readEnv(expr: string): Promise<string> {
  return node(["-e", `process.stdout.write(String(${expr}))`]).then(
    (result) => {
      expect(result.code).toBe(0);
      return result.stdout;
    },
  );
}

describe("createProcessGitRunner environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pins the C locale so git's clean prefixes stay parseable", async () => {
    // `clean -nd` is parsed by its English `Would remove ` prefix. A localized
    // git (`将删除 `) silently reported "no extra files" and made `--prune`
    // delete nothing.
    expect(await readEnv("process.env.LC_ALL")).toBe("C");
    expect(await readEnv("process.env.LANG")).toBe("C");
  });

  it("never stops on a credential prompt", async () => {
    expect(await readEnv("process.env.GIT_TERMINAL_PROMPT")).toBe("0");
  });

  it("strips an inherited GIT_DIR/GIT_INDEX_FILE from the parent", async () => {
    // A Host started from a git hook or an IDE's git shell inherits these.
    // `--git-dir` beats GIT_DIR, but GIT_INDEX_FILE / GIT_OBJECT_DIRECTORY
    // would point the shadow commands at the operator's own repository.
    vi.stubEnv("GIT_DIR", "/poison/.git");
    vi.stubEnv("GIT_INDEX_FILE", "/poison/index");
    expect(await readEnv("process.env.GIT_DIR")).toBe("undefined");
    expect(await readEnv("process.env.GIT_INDEX_FILE")).toBe("undefined");
  });
});
