import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_HOST_PACKAGE,
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  desktopCorePackageOverrides,
  desktopSha512Integrity,
  parseDesktopCorePackageSet,
  verifyDesktopCorePackageSet,
} from "../src/core-package-set.js";
import {
  prepareDesktopPackageSet,
  prepareDesktopSeedPackageArtifacts,
  selectDesktopPackageClosure,
} from "../src/prepare-package-set.js";
import {
  verifyDesktopSeedIntegrity,
} from "../src/seed-integrity.js";

describe("desktop core package set", () => {
  it("parses sorted records and requires Host", () => {
    const body = Buffer.from("tarball-bytes");
    const record = {
      name: DESKTOP_HOST_PACKAGE,
      version: "0.0.0",
      file: "host.tgz",
      bytes: body.byteLength,
      integrity: desktopSha512Integrity(body),
    };
    const set = parseDesktopCorePackageSet({
      schemaVersion: 1,
      packages: [record],
    });
    expect(set.packages).toHaveLength(1);
    expect(desktopCorePackageOverrides(set)[DESKTOP_HOST_PACKAGE]).toBe(
      `file:./${DESKTOP_PACKAGES_DIR}/host.tgz`,
    );
    expect(() =>
      parseDesktopCorePackageSet({ schemaVersion: 1, packages: [] }),
    ).toThrow(/missing/u);
  });
});

describe("prepareDesktopPackageSet + seed integrity", () => {
  it("copies first-party tarballs, writes descriptor and integrity.json", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "xrk-desktop-pkgset-"));
    try {
      const input = path.join(root, "input");
      mkdirSync(input);
      const hostBody = Buffer.from("host-tgz-body");
      const depBody = Buffer.from("dep-tgz-body");
      writeFileSync(path.join(input, "host.tgz"), hostBody);
      writeFileSync(path.join(input, "dep.tgz"), depBody);

      const manifests = new Map<string, Record<string, unknown>>([
        [
          "host.tgz",
          {
            name: DESKTOP_HOST_PACKAGE,
            version: "0.0.0",
            dependencies: { "@xrkseek/server-config": "workspace:*" },
          },
        ],
        [
          "dep.tgz",
          {
            name: "@xrkseek/server-config",
            version: "1.2.3",
          },
        ],
      ]);

      const output = path.join(root, "package-set");
      const packageSet = prepareDesktopPackageSet({
        inputDirs: [input],
        outputDir: output,
        expectedHostVersion: "0.0.0",
        readTarballManifest: (tarball) => {
          const file = path.basename(tarball);
          const manifest = manifests.get(file);
          if (manifest === undefined) throw new Error(`missing ${file}`);
          return manifest;
        },
        listTarballFiles: (tarball) => {
          if (path.basename(tarball) !== "host.tgz") return ["package/package.json"];
          return ["package/package.json", "package/dist/index.js"];
        },
      });

      expect(packageSet.packages.map((entry) => entry.name)).toEqual([
        DESKTOP_HOST_PACKAGE,
        "@xrkseek/server-config",
      ]);
      verifyDesktopCorePackageSet(output, "0.0.0");

      const seed = path.join(root, "seed");
      const { integrity } = prepareDesktopSeedPackageArtifacts({
        packageSetDir: output,
        seedDir: seed,
        expectedHostVersion: "0.0.0",
      });
      expect(integrity.files.some((f) => f.path === DESKTOP_PACKAGE_SET_FILE)).toBe(
        true,
      );
      expect(
        integrity.files.some((f) => f.path.startsWith(`${DESKTOP_PACKAGES_DIR}/`)),
      ).toBe(true);
      verifyDesktopSeedIntegrity(seed);
      expect(
        JSON.parse(
          readFileSync(path.join(seed, DESKTOP_PACKAGE_SET_FILE), "utf8"),
        ).packages,
      ).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("selectDesktopPackageClosure refuses missing first-party deps", () => {
    const available = new Map([
      [
        DESKTOP_HOST_PACKAGE,
        {
          tarball: "host.tgz",
          manifest: {
            name: DESKTOP_HOST_PACKAGE,
            version: "0.0.0",
            dependencies: { "@xrkseek/missing-leaf": "workspace:*" },
          },
        },
      ],
    ]);
    expect(() => selectDesktopPackageClosure(available)).toThrow(/unpacked/u);
  });
});
