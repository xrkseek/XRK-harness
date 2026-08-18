import { describe, expect, it } from "vitest";
import {
  DSH_ENV_PREFIX,
  SENSITIVE_ENV_PATTERN,
  XRK_ENV_PREFIX,
  childEnv,
  scrubbedParentEnv,
} from "../src/env.js";

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
});
