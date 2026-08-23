/**
 * Copy context packages from XRKbar/deepseek-harness with XRK scope remaps.
 *
 *   node scripts/resync-context-from-bar.mjs file-reference session-reference
 *   node scripts/resync-context-from-bar.mjs --client ui-reference
 *
 * Remap order matches resync-client-from-bar.mjs.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BAR =
  process.env.XRK_BAR_ROOT?.trim() ||
  path.join(process.env.USERPROFILE || "", "Desktop", "XRKbar", "deepseek-harness");
const CONTEXT = path.join(ROOT, "packages", "context");
const CLIENT = path.join(ROOT, "packages", "client");

const REMAP = [
  [/@deepseek-ai\/dsh-client-/g, "@xrkseek/client-"],
  [/@deepseek-ai\/dsh-/g, "@xrkseek/xrk-"],
  [/@deepseek-ai\/cordis/g, "@xrkseek/cordis"],
  [/@deepseek-ai\/schemastery/g, "@xrkseek/schemastery"],
  [/@deepseek-ai\//g, "@xrkseek/"],
  [/git\+https:\/\/github\.com\/deepseek-ai\/deepseek-harness/g, "git+https://github.com/xrkseek/XRK-harness"],
  [/DeepSeek Harness/g, "XRK-Harness"],
  [/"dsh"\s*:/g, '"xrk":'],
  [/process\.env\.DSH_/g, "process.env.XRK_"],
  [/__DSH_/g, "__XRK_"],
];

function remap(text) {
  let out = text;
  for (const [from, to] of REMAP) out = out.replace(from, to);
  return out;
}

function copyTree(srcDir, destDir) {
  if (!existsSync(srcDir)) throw new Error(`missing bar path: ${srcDir}`);
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  const walk = (rel) => {
    const src = path.join(srcDir, rel);
    for (const name of readdirSync(src)) {
      const relPath = rel ? `${rel}/${name}` : name;
      const srcPath = path.join(src, name);
      const destPath = path.join(destDir, relPath);
      if (statSync(srcPath).isDirectory()) {
        mkdirSync(destPath, { recursive: true });
        walk(relPath);
      } else if (/\.(ts|tsx|json|md|yaml|mjs)$/.test(name)) {
        writeFileSync(destPath, remap(readFileSync(srcPath, "utf8")), "utf8");
      } else {
        cpSync(srcPath, destPath);
      }
    }
  };
  walk("");
}

function syncPackageJson(destDir, barPkgPath) {
  const barFile = path.join(barPkgPath, "package.json");
  if (!existsSync(barFile)) return;
  const bar = JSON.parse(readFileSync(barFile, "utf8"));
  const remapped = JSON.parse(remap(JSON.stringify(bar)));
  const next = {
    ...remapped,
    private: true,
    repository: {
      type: "git",
      url: "git+https://github.com/xrkseek/XRK-harness.git",
      directory: path.relative(ROOT, destDir).replaceAll("\\", "/"),
    },
  };
  delete next.publishConfig;
  writeFileSync(path.join(destDir, "package.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function syncContext(name) {
  const barPkg = path.join(BAR, "packages", "context", name);
  const dest = path.join(CONTEXT, name);
  if (!existsSync(barPkg)) throw new Error(`bar context package missing: ${name}`);
  process.stdout.write(`\n== context/${name} ==\n`);
  for (const sub of ["src", "tests"]) {
    const barSub = path.join(barPkg, sub);
    if (!existsSync(barSub)) continue;
    copyTree(barSub, path.join(dest, sub));
    process.stdout.write(`  ${sub}/\n`);
  }
  for (const leaf of ["tsconfig.json", "README.md", "README.zh.md", "README.i18n.yaml"]) {
    const barFile = path.join(barPkg, leaf);
    if (!existsSync(barFile)) continue;
    writeFileSync(path.join(dest, leaf), remap(readFileSync(barFile, "utf8")), "utf8");
    process.stdout.write(`  ${leaf}\n`);
  }
  syncPackageJson(dest, barPkg);
  process.stdout.write("  package.json\n");
  applyHarnessPatches(dest, "context", name);
}

function syncClient(name) {
  const barPkg = path.join(BAR, "packages", "client", name);
  const dest = path.join(CLIENT, name);
  if (!existsSync(barPkg)) throw new Error(`bar client package missing: ${name}`);
  process.stdout.write(`\n== client/${name} ==\n`);
  for (const sub of ["src", "tests"]) {
    const barSub = path.join(barPkg, sub);
    if (!existsSync(barSub)) continue;
    copyTree(barSub, path.join(dest, sub));
    process.stdout.write(`  ${sub}/\n`);
  }
  for (const leaf of ["tsdown.config.ts", "tsconfig.json", "README.md", "README.zh.md", "README.i18n.yaml"]) {
    const barFile = path.join(barPkg, leaf);
    if (!existsSync(barFile)) continue;
    writeFileSync(path.join(dest, leaf), remap(readFileSync(barFile, "utf8")), "utf8");
    process.stdout.write(`  ${leaf}\n`);
  }
  syncPackageJson(dest, barPkg);
  process.stdout.write("  package.json\n");
  applyHarnessPatches(dest, "client", name);
}

/** Harness tree fixes bar resync cannot carry verbatim (paths, exports, missing peers). */
function applyHarnessPatches(destDir, kind, name) {
  if (kind === "context") {
    const faceIncludes = {
      "file-reference": ["src/types.ts", "src/grammar.ts"],
      "file-reference-local": ["src/search.ts"],
      "session-reference": ["src/types.ts", "src/config.ts", "src/uri.ts"],
    };
    const refs = {
      "file-reference-local": [{ path: "../file-reference" }],
      "session-reference": [{ path: "../../protocol" }],
    };
    writeFileSync(
      path.join(destDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          extends: "../../../tsconfig.base.json",
          compilerOptions: { composite: true, rootDir: "src", outDir: "dist" },
          include: faceIncludes[name] ?? ["src"],
          ...(refs[name] ? { references: refs[name] } : {}),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    process.stdout.write("  patched tsconfig.json\n");

    const distExport = (base) => ({
      types: `./dist/${base}.d.ts`,
      import: `./dist/${base}.js`,
      default: `./dist/${base}.js`,
    });
    const pkgPath = path.join(destDir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (name === "file-reference") {
        pkg.exports = {
          "./grammar": distExport("grammar"),
          "./types": distExport("types"),
          "./package.json": "./package.json",
        };
        pkg.files = ["dist", "README.md", "README.zh.md"];
        delete pkg.main;
        delete pkg.types;
      }
      if (name === "file-reference-local") {
        pkg.exports = {
          "./search": distExport("search"),
          "./package.json": "./package.json",
        };
        pkg.files = ["dist", "README.md", "README.zh.md"];
        pkg.dependencies = {
          "@xrkseek/xrk-file-reference": "workspace:*",
        };
        delete pkg.main;
        delete pkg.types;
        delete pkg.peerDependencies;
        delete pkg.devDependencies;
      }
      if (name === "session-reference") {
        pkg.exports = {
          "./types": distExport("types"),
          "./config": distExport("config"),
          "./uri": distExport("uri"),
          "./package.json": "./package.json",
        };
        pkg.files = ["dist", "README.md", "README.zh.md"];
        pkg.dependencies = { "@xrkseek/protocol": "workspace:*" };
        delete pkg.main;
        delete pkg.types;
        delete pkg.peerDependencies;
        delete pkg.devDependencies;
      }
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
      process.stdout.write("  patched package.json\n");
    }

    const searchPath = path.join(destDir, "src", "search.ts");
    if (existsSync(searchPath)) {
      let text = readFileSync(searchPath, "utf8");
      const next = text.replace(
        "from '@xrkseek/xrk-file-reference'",
        "from '@xrkseek/xrk-file-reference/types'",
      );
      if (next !== text) {
        writeFileSync(searchPath, next, "utf8");
        process.stdout.write("  patched src/search.ts\n");
      }
    }

    const typesPath = path.join(destDir, "src", "types.ts");
    if (existsSync(typesPath) && name === "session-reference") {
      let text = readFileSync(typesPath, "utf8");
      if (text.includes("@xrkseek/xrk-llm")) {
        text = `/**
 * Public session-reference request, candidate, and preparation records.
 * Face discovery imports stay on type-only subpaths; Cordis prepare lives in
 * \`index.ts\` (not wired on XRK Host main path).
 * @module @xrkseek/xrk-session-reference/types
 */

import type { ContentBlock, UserMessage } from '@xrkseek/protocol'

/** Opaque session id (Face path; Cordis prepare uses branded ids when wired). */
export type SessionId = string & { readonly __xrkSessionId?: unique symbol }

/** Brand a raw session id string for URI codec helpers. */
export function SessionId(id: string): SessionId {
  return id as SessionId
}

`;
        const bodyStart = readFileSync(typesPath, "utf8").indexOf("/** Durable source");
        if (bodyStart >= 0) {
          let body = readFileSync(typesPath, "utf8").slice(bodyStart);
          body = body.replace(
            /declare module '@xrkseek\/xrk-llm' \{[\s\S]*?\}\n\n/,
            "",
          );
          writeFileSync(typesPath, text + body, "utf8");
          process.stdout.write("  patched src/types.ts\n");
        }
      }
    }

    const uriPath = path.join(destDir, "src", "uri.ts");
    if (existsSync(uriPath)) {
      let text = readFileSync(uriPath, "utf8");
      text = text
        .replace(
          "from '@xrkseek/xrk-session/types'",
          "from './types.js'",
        )
        .replace(
          "from '@xrkseek/xrk-session'",
          "from './types.js'",
        )
        .replace("from './config.ts'", "from './config.js'")
        .replace("from './types.ts'", "from './types.js'");
      writeFileSync(uriPath, text, "utf8");
      process.stdout.write("  patched src/uri.ts\n");
    }

    const grammarPath = path.join(destDir, "src", "grammar.ts");
    if (existsSync(grammarPath)) {
      let text = readFileSync(grammarPath, "utf8");
      const next = text.replace("from './types.ts'", "from './types.js'");
      if (next !== text) {
        writeFileSync(grammarPath, next, "utf8");
        process.stdout.write("  patched src/grammar.ts\n");
      }
    }
  }

  if (kind === "client" && name === "ui-reference") {
    writeFileSync(
      path.join(destDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          extends: "../../../tsconfig.base.client.json",
          compilerOptions: { rootDir: "src", outDir: "lib/types", paths: {} },
          include: ["src"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    process.stdout.write("  patched tsconfig.json\n");
  }
}

const args = process.argv.slice(2);
const clientMode = args[0] === "--client";
const names = clientMode ? args.slice(1) : args;

if (!names.length) {
  console.error("usage: node scripts/resync-context-from-bar.mjs <context-pkg>...");
  console.error("       node scripts/resync-context-from-bar.mjs --client ui-reference");
  process.exit(1);
}
if (!existsSync(BAR)) {
  console.error(`bar root not found: ${BAR}`);
  process.exit(1);
}

for (const name of names) {
  if (clientMode) syncClient(name);
  else syncContext(name);
}
process.stdout.write("\ndone\n");
