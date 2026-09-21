import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StartupError } from "@xrkseek/server-loader";
import { reportStartupFailure } from "../src/startup-diagnostics.js";

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(
    temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "xrk-startup-diagnostics-"));
  temps.push(dir);
  return dir;
}

function startupError(reason: unknown): StartupError {
  return new StartupError("xrkh: startup failed: 1 required plugin did not activate", [
    {
      id: "webserver",
      required: true,
      outcome: { kind: "failed", error: reason },
    },
    {
      id: "waiting",
      required: false,
      outcome: { kind: "pending", missing: ["webServer"] },
    },
  ]);
}

describe("reportStartupFailure", () => {
  it("prints summary and saves under home/logs", async () => {
    const dir = await home();
    const chunks: string[] = [];
    await reportStartupFailure(
      startupError("failed"),
      { home: dir, version: "0.0.0-test", profile: "harness" },
      (text) => {
        chunks.push(text);
      },
    );
    const out = chunks.join("");
    expect(out).toContain("xrkh: startup failed:");
    expect(out).toContain(`Full diagnostics: ${join(dir, "logs")}`);
    const files = await readdir(join(dir, "logs"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^startup-[\w.-]+\.log$/u);
    const report = await readFile(join(dir, "logs", files[0]!), "utf8");
    expect(report).toContain("WARNING: Raw diagnostics");
    expect(report).toContain("xrkVersion: '0.0.0-test'");
    expect(report).toContain("profile: 'harness'");
    expect(report).toContain("waiting");
    expect(report).toContain("webServer");
  });

  it("dumps full report when logs path is blocked", async () => {
    const dir = await home();
    await writeFile(join(dir, "logs"), "blocked");
    const chunks: string[] = [];
    await reportStartupFailure(
      startupError({ code: "CUSTOM", value: "original details" }),
      { home: dir, version: "0.0.0-test", profile: "web" },
      (text) => {
        chunks.push(text);
      },
    );
    const output = chunks.join("");
    expect(output).toContain("could not write startup diagnostics");
    expect(output).toContain("Full diagnostics:\n");
    expect(output).toContain("original details");
    expect(output).not.toMatch(/Full diagnostics: \S/);
  });

  it("creates distinct files for concurrent failures", async () => {
    const dir = await home();
    await Promise.all(
      ["first", "second"].map((reason) =>
        reportStartupFailure(
          startupError(reason),
          { home: dir, version: "0.0.0-test", profile: "web" },
          () => {},
        ),
      ),
    );
    const files = await readdir(join(dir, "logs"));
    expect(files).toHaveLength(2);
  });
});
