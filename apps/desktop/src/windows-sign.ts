/**
 * Windows Authenticode signing helpers (ADR-0008 · dsh `windows-sign.mjs` subset).
 * Token signing uses SafeNet CSP + public leaf CER + SignTool (not PFX in-repo).
 * Prep/package subprocesses must scrub secrets via {@link scrubDesktopSigningEnvironment}.
 */
import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { realpathSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  DESKTOP_WINDOWS_SIGNING_ENV,
  type DesktopWindowsSigningEnvironment,
} from "./desktop-signing-environment.js";

const execFileAsync = promisify(execFile);
const CODE_SIGNING_EKU = "1.3.6.1.5.5.7.3.3";
const SENSITIVE_ENVIRONMENT_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD)/iu;
const WINDOWS_SIGNING_ENVIRONMENT_PREFIX = "XRK_DESKTOP_WINDOWS_";

const WINDOWS_SIGN_SCRIPT = "windows-sign.cmd";
const WINDOWS_SIGN_SCRIPT_DIRECTORY = dirname(
  fileURLToPath(new URL("../scripts/windows-sign.cmd", import.meta.url)),
);

export interface DesktopWindowsResolvedCertificate {
  readonly path: string;
  readonly certificate: X509Certificate;
  readonly thumbprint: string;
}

export type DesktopWindowsSignHook = (configuration: {
  readonly path: string;
  readonly hash: string;
  readonly isNest: boolean;
}) => Promise<void>;

export interface CreateDesktopWindowsTokenSignerOptions
  extends DesktopWindowsSigningEnvironment {
  /** Override CMD interpreter (tests). */
  readonly commandInterpreter?: string;
  /** Injected exec for tests. */
  readonly execFile?: typeof execFileAsync;
}

/** Strip Windows signing + credential-shaped env before prep/package child processes. */
export function scrubDesktopSigningEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        !SENSITIVE_ENVIRONMENT_NAME.test(name) &&
        !name.startsWith(WINDOWS_SIGNING_ENVIRONMENT_PREFIX),
    ),
  );
}

function resolveTokenIdentity(input: DesktopWindowsSigningEnvironment): {
  readonly keyContainer: string;
  readonly tokenPin: string;
} {
  const keyContainer = input.keyContainer?.trim();
  if (!keyContainer) {
    throw new Error(
      `xrk desktop: ${DESKTOP_WINDOWS_SIGNING_ENV.keyContainer} must contain the SafeNet private-key container name`,
    );
  }
  if (/["\r\n]/u.test(keyContainer)) {
    throw new Error(
      `xrk desktop: ${DESKTOP_WINDOWS_SIGNING_ENV.keyContainer} cannot contain quotes or line breaks`,
    );
  }
  const tokenPin = input.tokenPin;
  if (tokenPin === undefined || tokenPin.length === 0) {
    throw new Error(
      `xrk desktop: ${DESKTOP_WINDOWS_SIGNING_ENV.tokenPin} must contain the SafeNet Token Password`,
    );
  }
  if (/[\]"\r\n]/u.test(tokenPin)) {
    throw new Error(
      `xrk desktop: ${DESKTOP_WINDOWS_SIGNING_ENV.tokenPin} cannot contain "]", quotes, or line breaks`,
    );
  }
  return { keyContainer, tokenPin };
}

/**
 * Load and validate a public X.509 leaf certificate for Authenticode.
 * @throws when the file is missing, CA-only, or lacks the Code Signing EKU.
 */
export function resolveDesktopWindowsCertificateFile(
  value: string | undefined,
): DesktopWindowsResolvedCertificate {
  const candidate = value?.trim();
  if (!candidate) {
    throw new Error(
      `xrk desktop: ${DESKTOP_WINDOWS_SIGNING_ENV.cerFile} must identify the public X.509 leaf certificate file`,
    );
  }
  let path: string;
  let certificate: X509Certificate;
  try {
    path = realpathSync(candidate);
    certificate = new X509Certificate(readFileSync(path));
  } catch {
    throw new Error(
      `xrk desktop: Windows code-signing certificate file is missing or invalid: ${candidate}`,
    );
  }
  if (certificate.ca || !certificate.keyUsage?.includes(CODE_SIGNING_EKU)) {
    throw new Error(
      `xrk desktop: Windows code-signing certificate must be a non-CA Code Signing leaf: ${path}`,
    );
  }
  return {
    path,
    certificate,
    thumbprint: certificate.fingerprint.replaceAll(":", ""),
  };
}

function resolveSignTool(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate) {
    throw new Error(
      `xrk desktop: ${DESKTOP_WINDOWS_SIGNING_ENV.signTool} must identify the SafeNet-compatible SignTool executable`,
    );
  }
  let path: string;
  try {
    path = realpathSync(candidate);
    if (!statSync(path).isFile() || !path.toLowerCase().endsWith(".exe")) {
      throw new Error("not an executable file");
    }
  } catch {
    throw new Error(
      `xrk desktop: ${DESKTOP_WINDOWS_SIGNING_ENV.signTool} is missing or is not an executable file: ${candidate}`,
    );
  }
  return path;
}

/**
 * Pin electron-updater publisherName to CN/O/C from the release leaf certificate.
 */
export function resolveDesktopWindowsUpdatePublisher(
  certificateFile: string,
): string {
  const { certificate } = resolveDesktopWindowsCertificateFile(certificateFile);
  const subject = certificate.toLegacyObject().subject as Record<
    string,
    string | undefined
  >;
  return (["CN", "O", "C"] as const)
    .map((key) => {
      const value = subject[key];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(
          `xrk desktop: Windows update publisher requires one nonempty ${key} certificate attribute`,
        );
      }
      const escaped = [...value]
        .map((character) => {
          const code = character.charCodeAt(0);
          if (
            code <= 0x20 ||
            character === "\\" ||
            character === '"' ||
            character === "," ||
            character === ";" ||
            character === "+"
          ) {
            return `\\${code.toString(16).padStart(2, "0")}`;
          }
          return character;
        })
        .join("");
      return `${key}=${escaped}`;
    })
    .join(",");
}

function redactedSigningOutput(
  value: unknown,
  secrets: readonly string[],
): string {
  let output = Buffer.isBuffer(value)
    ? value.toString("utf8")
    : typeof value === "string"
      ? value
      : "";
  for (const secret of secrets) {
    if (secret !== "") output = output.replaceAll(secret, "<redacted>");
  }
  return output;
}

export function createRedactedWindowsSigningError(
  error: unknown,
  path: string,
  secrets: readonly string[],
): Error {
  const record =
    error !== null && typeof error === "object"
      ? (error as { code?: number | string; stderr?: unknown })
      : undefined;
  const code =
    record?.code !== undefined
      ? ` (exit ${String(record.code)})`
      : "";
  const stderr =
    record?.stderr !== undefined
      ? redactedSigningOutput(record.stderr, secrets).trim()
      : "";
  return new Error(
    `xrk desktop: Windows release signing failed for ${path}${code}${
      stderr === "" ? "" : `: ${stderr}`
    }`,
  );
}

/** Build the minimal CMD environment for one Electron artifact (cleared by windows-sign.cmd). */
export function buildDesktopWindowsSigningEnvironment(
  environment: NodeJS.ProcessEnv,
  input: {
    readonly certificateFile: string;
    readonly signTool: string;
    readonly path: string;
    readonly isNest: boolean;
    readonly tokenPin: string;
    readonly keyContainer: string;
  },
): NodeJS.ProcessEnv {
  return {
    ...scrubDesktopSigningEnvironment(environment),
    [DESKTOP_WINDOWS_SIGNING_ENV.signTool]: input.signTool,
    [DESKTOP_WINDOWS_SIGNING_ENV.cerFile]: input.certificateFile,
    [DESKTOP_WINDOWS_SIGNING_ENV.tokenPin]: input.tokenPin,
    [DESKTOP_WINDOWS_SIGNING_ENV.keyContainer]: input.keyContainer,
    XRK_DESKTOP_WINDOWS_SIGN_TARGET: input.path,
    XRK_DESKTOP_WINDOWS_SIGN_APPEND: input.isNest ? "1" : "",
  };
}

/**
 * True when CER + SignTool + token PIN + key container are all present
 * (hardware / SafeNet token path).
 */
export function isDesktopWindowsTokenSigningReady(
  signing: DesktopWindowsSigningEnvironment | undefined,
): boolean {
  return (
    signing !== undefined &&
    Boolean(signing.certificateFile?.trim()) &&
    Boolean(signing.signTool?.trim()) &&
    Boolean(signing.tokenPin) &&
    Boolean(signing.keyContainer?.trim())
  );
}

/**
 * Assert Windows release signing identity is complete when a CER is configured.
 * CER alone is insufficient (public leaf); token identity is required.
 */
export function assertDesktopWindowsSigningReady(
  signing: DesktopWindowsSigningEnvironment | undefined,
): asserts signing is DesktopWindowsSigningEnvironment & {
  readonly signTool: string;
  readonly tokenPin: string;
  readonly keyContainer: string;
} {
  if (signing === undefined) {
    throw new Error("xrk desktop: Windows signing environment is missing");
  }
  if (!isDesktopWindowsTokenSigningReady(signing)) {
    throw new Error(
      "xrk desktop: Windows signing requires " +
        `${DESKTOP_WINDOWS_SIGNING_ENV.cerFile}, ` +
        `${DESKTOP_WINDOWS_SIGNING_ENV.signTool}, ` +
        `${DESKTOP_WINDOWS_SIGNING_ENV.tokenPin}, and ` +
        `${DESKTOP_WINDOWS_SIGNING_ENV.keyContainer} ` +
        `(or set XRK_DESKTOP_UNSIGNED=1 for unsigned Windows)`,
    );
  }
}

/**
 * Serialize SafeNet SignTool invocations for electron-builder `signtoolOptions.sign`.
 */
export function createDesktopWindowsTokenSigner(
  options: CreateDesktopWindowsTokenSignerOptions,
): DesktopWindowsSignHook {
  const { path: certificateFile } = resolveDesktopWindowsCertificateFile(
    options.certificateFile,
  );
  const signTool = resolveSignTool(options.signTool);
  const { keyContainer, tokenPin } = resolveTokenIdentity(options);
  const commandInterpreter =
    options.commandInterpreter ??
    process.env.ComSpec ??
    join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
  const run = options.execFile ?? execFileAsync;
  let pending = Promise.resolve();
  return (configuration) => {
    pending = pending.then(async () => {
      if (configuration.hash !== "sha256") {
        throw new Error(
          `xrk desktop: Windows release signing requires SHA-256, received ${configuration.hash}`,
        );
      }
      if (configuration.isNest) {
        throw new Error(
          "xrk desktop: Windows release signing does not support appended signatures",
        );
      }
      const secrets = [tokenPin];
      try {
        const result = await run(
          commandInterpreter,
          ["/d", "/v:off", "/c", WINDOWS_SIGN_SCRIPT],
          {
            cwd: WINDOWS_SIGN_SCRIPT_DIRECTORY,
            env: buildDesktopWindowsSigningEnvironment(process.env, {
              certificateFile,
              signTool,
              path: configuration.path,
              isNest: false,
              tokenPin,
              keyContainer,
            }),
            windowsHide: true,
          },
        );
        const stdout = redactedSigningOutput(result.stdout, secrets);
        const stderr = redactedSigningOutput(result.stderr, secrets);
        if (stdout !== "") process.stdout.write(stdout);
        if (stderr !== "") process.stderr.write(stderr);
      } catch (error) {
        throw createRedactedWindowsSigningError(
          error,
          configuration.path,
          secrets,
        );
      }
    });
    return pending;
  };
}
