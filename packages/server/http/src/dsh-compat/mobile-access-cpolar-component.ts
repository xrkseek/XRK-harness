/**
 * cpolar official component install — mirrors dsh-mobile CpolarComponentManager.
 */
import {
  createHash,
  randomBytes,
} from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { dataPath } from "./underlying/json-store.js";

const execFileAsync = promisify(execFile);

/** Official cpolar 3.3.18 win32 x64 release (dsh-mobile CPOLAR_COMPONENT_RELEASE). */
export const CPOLAR_COMPONENT_RELEASE = {
  version: "3.3.18",
  platform: "win32",
  arch: "x64",
  downloadUrl:
    "https://www.cpolar.com/static/downloads/releases/3.3.18/cpolar-stable-windows-amd64-setup.zip",
  downloadBytes: 7603505,
  downloadSha256:
    "fb8cf60289058ee26079f995d2eeea0b21768a742d90c93015afe96e83428830",
  executableBytes: 19637680,
  executableSha256:
    "b2d865ee505e842d22ceca5493a872efa893a79b079a7a8ee2bd3aa5343a5c41",
  downloadPage: "https://www.cpolar.com/download",
  signupUrl: "https://dashboard.cpolar.com/signup",
  dashboardUrl: "https://dashboard.cpolar.com/auth",
  termsUrl: "https://www.cpolar.com/tos",
} as const;

function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function sha256File(file: string): Promise<string> {
  const buf = await readFile(file);
  return createHash("sha256").update(buf).digest("hex");
}

async function regularFile(file: string, expectedBytes?: number): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    const st = await stat(file);
    return (
      st.isFile() &&
      (expectedBytes === undefined || st.size === expectedBytes)
    );
  } catch {
    return false;
  }
}

async function runExe(file: string, args: string[]): Promise<void> {
  await execFileAsync(file, args, {
    windowsHide: true,
    timeout: 120_000,
  });
}

export interface CpolarComponentStatus {
  supported: boolean;
  installed: boolean;
  configured: boolean;
  version: string;
  downloadBytes: number;
  installedBytes: number;
  sourceUrl: string;
  downloadPage: string;
  signupUrl: string;
  dashboardUrl: string;
  termsUrl: string;
  storagePath: string;
  errorCode?: string;
}

export class CpolarComponentManager {
  readonly executable: string;
  readonly configFile: string;
  readonly componentRoot: string;
  private readonly componentStorage: string;
  private readonly stateRoot: string;
  private readonly logRoot: string;
  private readonly stagingRoot: string;
  private readonly stateDirectory: string;
  installed = false;
  configured = false;
  errorCode: string | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(xrkHome: string | undefined) {
    this.stateDirectory = dataPath(xrkHome, "mobile-access");
    this.componentRoot = path.join(
      this.stateDirectory,
      "components",
      "cpolar",
    );
    this.componentStorage = path.join(
      this.componentRoot,
      CPOLAR_COMPONENT_RELEASE.version,
    );
    this.executable = path.join(this.componentStorage, "cpolar.exe");
    this.stateRoot = path.join(this.stateDirectory, "state", "cpolar");
    this.configFile = path.join(this.stateRoot, "cpolar.yml");
    this.logRoot = path.join(this.stateDirectory, "logs", "cpolar");
    this.stagingRoot = path.join(this.stateDirectory, "staging", "cpolar");
    for (const child of [
      this.componentRoot,
      this.componentStorage,
      this.stateRoot,
      this.logRoot,
      this.stagingRoot,
    ]) {
      if (!inside(this.stateDirectory, child)) {
        throw new Error("cpolar path escaped state directory");
      }
    }
  }

  async initialize(): Promise<void> {
    this.installed = await regularFile(
      this.executable,
      CPOLAR_COMPONENT_RELEASE.executableBytes,
    );
    if (
      this.installed &&
      (await sha256File(this.executable)) !==
        CPOLAR_COMPONENT_RELEASE.executableSha256
    ) {
      this.installed = false;
      this.errorCode = "cpolar_component_invalid";
    }
    this.configured = await regularFile(this.configFile);
  }

  status(): CpolarComponentStatus {
    const platform = process.platform;
    const arch = process.arch;
    return {
      supported:
        platform === CPOLAR_COMPONENT_RELEASE.platform &&
        arch === CPOLAR_COMPONENT_RELEASE.arch,
      installed: this.installed,
      configured: this.configured,
      version: CPOLAR_COMPONENT_RELEASE.version,
      downloadBytes: CPOLAR_COMPONENT_RELEASE.downloadBytes,
      installedBytes: CPOLAR_COMPONENT_RELEASE.executableBytes,
      sourceUrl: CPOLAR_COMPONENT_RELEASE.downloadUrl,
      downloadPage: CPOLAR_COMPONENT_RELEASE.downloadPage,
      signupUrl: CPOLAR_COMPONENT_RELEASE.signupUrl,
      dashboardUrl: CPOLAR_COMPONENT_RELEASE.dashboardUrl,
      termsUrl: CPOLAR_COMPONENT_RELEASE.termsUrl,
      storagePath: this.componentRoot,
      ...(this.errorCode ? { errorCode: this.errorCode } : {}),
    };
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const task = this.queue.then(op, op);
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async install(): Promise<void> {
    return this.enqueue(async () => {
      if (
        process.platform !== CPOLAR_COMPONENT_RELEASE.platform ||
        process.arch !== CPOLAR_COMPONENT_RELEASE.arch
      ) {
        throw new Error("cpolar_component_unsupported");
      }
      await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
      const staging = await mkdtemp(
        path.join(this.stagingRoot, "install-"),
      );
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);
        timeout.unref();
        const response = await fetch(CPOLAR_COMPONENT_RELEASE.downloadUrl, {
          redirect: "error",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) {
          throw new Error(`cpolar_download_http_${response.status}`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength !== CPOLAR_COMPONENT_RELEASE.downloadBytes) {
          throw new Error("cpolar_download_size_mismatch");
        }
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (hash !== CPOLAR_COMPONENT_RELEASE.downloadSha256) {
          throw new Error("cpolar_download_hash_mismatch");
        }
        const archive = path.join(staging, "cpolar.zip");
        await writeFile(archive, bytes, { mode: 0o600 });
        await this.extractWindowsInstaller(archive, staging);
        const extracted = path.join(staging, "cpolar.exe");
        if (
          !await regularFile(
            extracted,
            CPOLAR_COMPONENT_RELEASE.executableBytes,
          ) ||
          (await sha256File(extracted)) !==
            CPOLAR_COMPONENT_RELEASE.executableSha256
        ) {
          throw new Error("cpolar_executable_hash_mismatch");
        }
        const candidate = path.join(
          this.componentRoot,
          `.install-${randomBytes(12).toString("hex")}`,
        );
        await mkdir(candidate, { recursive: true, mode: 0o700 });
        await copyFile(extracted, path.join(candidate, "cpolar.exe"));
        await rm(this.componentStorage, { recursive: true, force: true });
        await rename(candidate, this.componentStorage);
        this.installed = true;
        this.errorCode = undefined;
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    });
  }

  private async extractWindowsInstaller(
    archive: string,
    destination: string,
  ): Promise<void> {
    const unpacked = path.join(destination, "archive");
    const administrative = path.join(destination, "administrative");
    await mkdir(unpacked, { recursive: true, mode: 0o700 });
    await mkdir(administrative, { recursive: true, mode: 0o700 });
    await runExe("tar.exe", ["-xf", archive, "-C", unpacked]);
    const entries = await readdir(unpacked, { recursive: true });
    const msiRel = entries.find((e) =>
      String(e).toLowerCase().endsWith(".msi"),
    );
    if (!msiRel) throw new Error("cpolar_installer_missing");
    const msiPath = path.join(unpacked, String(msiRel));
    await runExe("msiexec.exe", [
      "/a",
      msiPath,
      "/qn",
      `TARGETDIR=${administrative}`,
    ]);
    const adminEntries = await readdir(administrative, { recursive: true });
    const exeRel = adminEntries.find(
      (e) => path.basename(String(e)).toLowerCase() === "cpolar.exe",
    );
    if (!exeRel) throw new Error("cpolar_executable_missing");
    await copyFile(
      path.join(administrative, String(exeRel)),
      path.join(destination, "cpolar.exe"),
    );
  }

  async configure(authtoken: string): Promise<void> {
    return this.enqueue(async () => {
      const token = authtoken.trim();
      if (
        token.length < 20 ||
        token.length > 512 ||
        [...token].some((ch) => {
          const code = ch.codePointAt(0) ?? 0;
          return code <= 0x1f || code === 0x7f || /\s/u.test(ch);
        })
      ) {
        throw new Error("cpolar_authtoken_invalid");
      }
      await mkdir(this.stateRoot, { recursive: true, mode: 0o700 });
      const temporary = path.join(
        this.stateRoot,
        `.cpolar.${randomBytes(12).toString("hex")}.tmp`,
      );
      const body = `authtoken: ${JSON.stringify(token)}\nconsole_ui: false\nupdate: false\ninspect_db_size: -1\n`;
      try {
        await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.configFile);
      } catch (err) {
        await rm(temporary, { force: true });
        throw err;
      }
      this.configured = true;
      this.errorCode = undefined;
    });
  }

  async purge(): Promise<void> {
    return this.enqueue(async () => {
      await Promise.all([
        rm(this.componentRoot, { recursive: true, force: true }),
        rm(this.stateRoot, { recursive: true, force: true }),
        rm(this.logRoot, { recursive: true, force: true }),
        rm(this.stagingRoot, { recursive: true, force: true }),
      ]);
      this.installed = false;
      this.configured = false;
      this.errorCode = undefined;
    });
  }
}
