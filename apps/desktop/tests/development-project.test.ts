import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_CLI_PACKAGE,
  DESKTOP_HOST_PACKAGE,
} from "../src/core-package-set.js";
import {
  prepareDesktopDevelopmentProject,
} from "../src/development-project.js";
import { DESKTOP_HOST_PROTOCOL_VERSION } from "../src/host-protocol.js";
import {
  createDesktopRelease,
  type DesktopRelease,
} from "../src/release.js";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "xrk-desktop-development-test-"));
  roots.push(root);
  return root;
}

function release(version = "1.2.3"): DesktopRelease {
  return createDesktopRelease({
    version,
    nodeVersion: "26.8.1",
    pnpmVersion: "11.22.0",
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("desktop development project projection", () => {
  it("projects Host and dependency graph into a disposable project", () => {
    const root = temporaryRoot();
    const host = join(root, "apps", "desktop-host");
    const cli = join(root, "apps", "cli");
    const dependencies = join(root, "workspace-dependencies");
    mkdirSync(join(host, "dist"), { recursive: true });
    mkdirSync(join(cli, "dist"), { recursive: true });
    mkdirSync(join(dependencies, "@scope"), { recursive: true });
    mkdirSync(join(dependencies, "@xrkseek", "harness-desktop-host"), {
      recursive: true,
    });
    writeFileSync(
      join(host, "package.json"),
      `{"name":"${DESKTOP_HOST_PACKAGE}","version":"1.2.3"}\n`,
    );
    writeFileSync(join(host, "dist", "index.js"), "");
    writeFileSync(
      join(cli, "package.json"),
      `{"name":"${DESKTOP_CLI_PACKAGE}","version":"9.9.9"}\n`,
    );
    writeFileSync(
      join(dependencies, "@xrkseek", "harness-desktop-host", "package.json"),
      "{}\n",
    );
    mkdirSync(join(dependencies, "plain-dependency"));
    writeFileSync(join(dependencies, "plain-dependency", "package.json"), "{}\n");
    mkdirSync(join(dependencies, "@scope", "dependency"));
    writeFileSync(
      join(dependencies, "@scope", "dependency", "package.json"),
      "{}\n",
    );

    const project = prepareDesktopDevelopmentProject({
      projectDir: join(root, "development"),
      hostDir: host,
      cliDir: cli,
      dependencyDir: dependencies,
      release: release(),
    });

    expect(
      realpathSync(join(project, "node_modules", ...DESKTOP_HOST_PACKAGE.split("/"))),
    ).toBe(realpathSync(host));
    expect(
      realpathSync(join(project, "node_modules", ...DESKTOP_CLI_PACKAGE.split("/"))),
    ).toBe(realpathSync(cli));
    expect(
      realpathSync(join(project, "node_modules", "plain-dependency")),
    ).toBe(realpathSync(join(dependencies, "plain-dependency")));
    expect(
      realpathSync(join(project, "node_modules", "@scope", "dependency")),
    ).toBe(realpathSync(join(dependencies, "@scope", "dependency")));

    const manifest = JSON.parse(
      readFileSync(join(project, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies[DESKTOP_HOST_PACKAGE]).toBe("1.2.3");
    expect(manifest.dependencies[DESKTOP_CLI_PACKAGE]).toBe("1.2.3");

    const written = JSON.parse(
      readFileSync(join(project, "desktop-release.json"), "utf8"),
    ) as DesktopRelease;
    expect(written.hostProtocolVersion).toBe(DESKTOP_HOST_PROTOCOL_VERSION);
    expect(written.version).toBe("1.2.3");
  });

  it("rejects a Desktop Host package from another release", () => {
    const root = temporaryRoot();
    const host = join(root, "apps", "desktop-host");
    const dependencies = join(root, "workspace-dependencies");
    mkdirSync(join(host, "dist"), { recursive: true });
    mkdirSync(dependencies, { recursive: true });
    writeFileSync(
      join(host, "package.json"),
      `{"name":"${DESKTOP_HOST_PACKAGE}","version":"2.0.0"}\n`,
    );
    writeFileSync(join(host, "dist", "index.js"), "");
    expect(() =>
      prepareDesktopDevelopmentProject({
        projectDir: join(root, "development"),
        hostDir: host,
        dependencyDir: dependencies,
        release: release("1.2.3"),
      }),
    ).toThrow(
      new RegExp(
        `${DESKTOP_HOST_PACKAGE.replace("/", "\\/")}@1\\.2\\.3`,
        "u",
      ),
    );
  });

  it("rejects a missing Host runtime entry", () => {
    const root = temporaryRoot();
    const host = join(root, "apps", "desktop-host");
    const dependencies = join(root, "workspace-dependencies");
    mkdirSync(host, { recursive: true });
    mkdirSync(dependencies, { recursive: true });
    writeFileSync(
      join(host, "package.json"),
      `{"name":"${DESKTOP_HOST_PACKAGE}","version":"1.2.3"}\n`,
    );
    expect(() =>
      prepareDesktopDevelopmentProject({
        projectDir: join(root, "development"),
        hostDir: host,
        dependencyDir: dependencies,
        release: release(),
      }),
    ).toThrow(/dist\/index\.js is missing/u);
  });
});
