import { describe, expect, it } from "vitest";
import {
  DSH_ENV_PREFIX,
  SENSITIVE_ENV_PATTERN,
  XRK_ENV_PREFIX,
  childEnv,
  createLocalSubprocess,
  scrubbedParentEnv,
} from "../src/index.js";

describe("scrubbedParentEnv", () => {
  it("drops credential-shaped and XRK_/DSH_ names but keeps PATH", () => {
    const env = scrubbedParentEnv({
      PATH: "/bin",
      HOME: "/home/u",
      API_KEY: "secret",
      my_password: "x",
      XRK_SHELL: "1",
      xrk_pty_session_id: "leak",
      DSH_SESSION_ID: "peer",
      OPENAI_TOKEN: "t",
      LD_PRELOAD: "/tmp/evil.so",
      DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
      SAFE_VAR: "ok",
    });
    expect(env.PATH).toBe("/bin");
    expect(env.HOME).toBe("/home/u");
    expect(env.SAFE_VAR).toBe("ok");
    expect(env.API_KEY).toBeUndefined();
    expect(env.my_password).toBeUndefined();
    expect(env.XRK_SHELL).toBeUndefined();
    expect(env.xrk_pty_session_id).toBeUndefined();
    expect(env.DSH_SESSION_ID).toBeUndefined();
    expect(env.OPENAI_TOKEN).toBeUndefined();
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(SENSITIVE_ENV_PATTERN.test("API_KEY")).toBe(true);
    expect(XRK_ENV_PREFIX).toBe("XRK_");
    expect(DSH_ENV_PREFIX).toBe("DSH_");
  });
});

describe("childEnv", () => {
  it("merges explicit overrides after the scrub", () => {
    const env = childEnv(
      { XRK_SHELL: "1", PATH: "/custom" },
      { PATH: "/bin", API_SECRET: "nope", XRK_LEAK: "1" },
    );
    expect(env.XRK_SHELL).toBe("1");
    expect(env.PATH).toBe("/custom");
    expect(env.API_SECRET).toBeUndefined();
    expect(env.XRK_LEAK).toBeUndefined();
  });

  it("drops a key when the explicit value is undefined", () => {
    const env = childEnv(
      { PATH: undefined, KEEP: "1" },
      { PATH: "/bin", KEEP: "0" },
    );
    expect(env.PATH).toBeUndefined();
    expect(env.KEEP).toBe("1");
  });
});

describe("createLocalSubprocess env scrub", () => {
  it("omitted opts.env strips sensitive names from process.env", async () => {
    const NODE = process.execPath;
    const key = "XRK_TEST_SCRUB_KEY_" + String(Date.now());
    const token = "LEAK_TOKEN_" + String(Date.now());
    process.env[key] = "secret-value";
    process.env[token] = "token-value";
    try {
      const subprocess = createLocalSubprocess();
      const result = await subprocess.spawn([
        NODE,
        "-e",
        `const e=process.env;console.log([e[${JSON.stringify(key)}]||'',e[${JSON.stringify(token)}]||'',e.PATH? 'hasPATH':''].join('|'))`,
      ]);
      expect(result.exitCode).toBe(0);
      // KEY/TOKEN-shaped ambient names gone; PATH kept.
      expect(result.stdout.trim()).toBe("||hasPATH");
    } finally {
      delete process.env[key];
      delete process.env[token];
    }
  });
});
