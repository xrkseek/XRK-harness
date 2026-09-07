import { afterEach, describe, expect, it } from "vitest";
import {
  getGlobalDispatcher,
  setGlobalDispatcher,
  Agent,
} from "undici";
import {
  hasOutboundProxyEnv,
  installOutboundHttpProxy,
  resetOutboundHttpProxyForTests,
} from "../src/http-proxy.js";

describe("installOutboundHttpProxy", () => {
  afterEach(() => {
    resetOutboundHttpProxyForTests();
  });

  it("detects conventional proxy env names", () => {
    expect(hasOutboundProxyEnv({})).toBe(false);
    expect(hasOutboundProxyEnv({ HTTP_PROXY: "http://127.0.0.1:7897" })).toBe(true);
    expect(hasOutboundProxyEnv({ https_proxy: "http://127.0.0.1:7897" })).toBe(true);
    expect(hasOutboundProxyEnv({ NO_PROXY: "localhost" })).toBe(true);
    expect(hasOutboundProxyEnv({ HTTP_PROXY: "  " })).toBe(false);
  });

  it("installs EnvHttpProxyAgent once when process proxy env is present", () => {
    const previous = getGlobalDispatcher();
    const had = process.env.HTTP_PROXY;
    try {
      process.env.HTTP_PROXY = "http://127.0.0.1:7897";
      resetOutboundHttpProxyForTests();
      expect(installOutboundHttpProxy()).toBe(true);
      expect(installOutboundHttpProxy()).toBe(false);
      expect(getGlobalDispatcher()).not.toBe(previous);
    } finally {
      if (had === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = had;
      setGlobalDispatcher(previous ?? new Agent());
      resetOutboundHttpProxyForTests();
    }
  });
});
