import { describe, expect, it } from "vitest";
import {
  REDACTED_SECRET,
  createMemorySecretStore,
  createOsKeyringStore,
  loadSlotFromSecretStore,
  redactSecrets,
  resolveSecretStore,
  syncSlotToSecretStore,
  wrapLoggerForSecrets,
} from "../src/index.js";

describe("@xrkseek/secrets", () => {
  it("redactSecrets strips keys, bearer, and assignments", () => {
    expect(redactSecrets("key sk-abcdefghijklmnopqrst")).toContain(REDACTED_SECRET);
    expect(redactSecrets("Bearer abcdefghijklmnopqr")).toBe(
      `Bearer ${REDACTED_SECRET}`,
    );
    expect(redactSecrets("AKIAABCDEFGHIJKLMNOP")).toBe(REDACTED_SECRET);
    expect(redactSecrets("api_key=supersecretvalue")).toContain(REDACTED_SECRET);
    expect(redactSecrets("hello world")).toBe("hello world");
  });

  it("wrapLoggerForSecrets redacts before write", () => {
    const lines: string[] = [];
    const logger = wrapLoggerForSecrets({
      error: (m) => lines.push(m),
      warn: (m) => lines.push(m),
      info: (m) => lines.push(m),
      debug: (m) => lines.push(m),
    });
    logger.info("got sk-abcdefghijklmnopqrst from provider");
    expect(lines[0]).toContain(REDACTED_SECRET);
    expect(lines[0]).not.toContain("sk-abcdefghijklmnopqrst");
  });

  it("memory store round-trips", async () => {
    const store = createMemorySecretStore();
    expect(store.available).toBe(true);
    await store.save("svc", "acct", "secret-value");
    expect(await store.load("svc", "acct")).toBe("secret-value");
    expect(await store.delete("svc", "acct")).toBe(true);
    expect(await store.load("svc", "acct")).toBeUndefined();
  });

  it("syncSlotToSecretStore dual-writes Face slots", async () => {
    const store = createMemorySecretStore();
    await syncSlotToSecretStore(store, "llm.deepseek", "sk-test");
    expect(await loadSlotFromSecretStore(store, "llm.deepseek")).toBe("sk-test");
    await syncSlotToSecretStore(store, "llm.deepseek", null);
    expect(await loadSlotFromSecretStore(store, "llm.deepseek")).toBeUndefined();
  });

  it("resolveSecretStore respects XRK_SECRETS_BACKEND", async () => {
    expect(await resolveSecretStore({})).toBeUndefined();
    expect(await resolveSecretStore({ XRK_SECRETS_BACKEND: "file" })).toBeUndefined();
    const mem = await resolveSecretStore({ XRK_SECRETS_BACKEND: "memory" });
    expect(mem?.kind).toBe("memory");
    const keyring = await resolveSecretStore({ XRK_SECRETS_BACKEND: "keyring" });
    expect(keyring?.providerName).toBe("os-keyring");
    // Without keytar installed, store is unavailable but still returned.
    expect(keyring?.kind === "os-keyring" || keyring?.kind === "unavailable").toBe(
      true,
    );
  });

  it("createOsKeyringStore is honest when keytar is missing", async () => {
    const store = await createOsKeyringStore();
    expect(store.providerName).toBe("os-keyring");
    if (!store.available) {
      expect(store.unavailableMessage).toMatch(/keytar/i);
      await expect(store.save("s", "a", "v")).rejects.toMatchObject({
        code: "SECRET_UNAVAILABLE",
      });
    }
  });
});
