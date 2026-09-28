/**
 * `dsh-email` — `/_dsh/dsh-email/settings` action bridge + whale asset.
 * IMAP/SMTP/OAuth dial stays deferred; account settings persist under ~/.xrk.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface DshEmailOptions {
  readonly xrkHome?: string;
}

interface EmailSettingsValue {
  accountsYaml: string;
  defaultAccount: string;
  serverPresets: string;
  [key: string]: unknown;
}

interface EmailDoc {
  value: EmailSettingsValue;
  revision: number;
}

const WHALE_ASSET_ROUTE = "/_dsh/dsh-email/assets/whale";

const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const PROVIDER_PRESETS: Record<
  string,
  {
    imap: { host: string; port: number; secure: boolean };
    smtp: { host: string; port: number; secure: boolean };
  }
> = {
  qq: {
    imap: { host: "imap.qq.com", port: 993, secure: true },
    smtp: { host: "smtp.qq.com", port: 465, secure: true },
  },
  "163": {
    imap: { host: "imap.163.com", port: 993, secure: true },
    smtp: { host: "smtp.163.com", port: 465, secure: true },
  },
  "126": {
    imap: { host: "imap.126.com", port: 993, secure: true },
    smtp: { host: "smtp.126.com", port: 465, secure: true },
  },
  sina: {
    imap: { host: "imap.sina.com", port: 993, secure: true },
    smtp: { host: "smtp.sina.com", port: 465, secure: true },
  },
  aliyun: {
    imap: { host: "imap.aliyun.com", port: 993, secure: true },
    smtp: { host: "smtp.aliyun.com", port: 465, secure: true },
  },
  gmail: {
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  },
  outlook: {
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
  },
  icloud: {
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
  },
};

const STORE = createXrkDocStore<EmailDoc>(["dsh-email", "settings.json"], {
  value: {
    accountsYaml: "",
    defaultAccount: "",
    serverPresets: "",
  },
  revision: 0,
});

export function isDshEmailPath(pathname: string): boolean {
  return (
    pathname === "/_dsh/dsh-email" ||
    pathname.startsWith("/_dsh/dsh-email/") ||
    pathname === "/_dsh/dsh-aimail" ||
    pathname.startsWith("/_dsh/dsh-aimail/")
  );
}

function presetsSnapshot(): Record<string, unknown> {
  const builtin: Record<string, unknown> = {};
  for (const [name, preset] of Object.entries(PROVIDER_PRESETS)) {
    builtin[name] = {
      imap: { ...preset.imap },
      smtp: { ...preset.smtp },
    };
  }
  return { builtin };
}

function accountNamesFromYaml(text: string): string[] {
  if (!text.trim()) return [];
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_.@+-]+):\s*$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (key === "defaultAccount" || key === "accounts") continue;
    names.push(key);
  }
  return names;
}

function parseAccountsDraft(
  text: string,
  rowDefault: string,
): {
  list: Array<Record<string, unknown>>;
  defaultAccount?: string;
  error?: string;
} {
  if (!text.trim()) {
    return {
      list: [],
      ...(rowDefault ? { defaultAccount: rowDefault } : {}),
    };
  }
  try {
    const names = accountNamesFromYaml(text);
    const list = names.map((name) => {
      const providerMatch = new RegExp(
        `^${name}:[\\s\\S]*?^\\s+provider:\\s*([^\\s#]+)`,
        "m",
      ).exec(text);
      const userMatch = new RegExp(
        `^${name}:[\\s\\S]*?^\\s+user:\\s*([^\\s#]+)`,
        "m",
      ).exec(text);
      const provider = providerMatch?.[1]?.replace(/['"]/g, "") ?? "";
      const user = userMatch?.[1]?.replace(/['"]/g, "") ?? "";
      const authKind =
        provider === "outlook" ||
        text.includes("outlook.office365.com")
          ? "oauth2"
          : "password";
      return {
        name,
        provider,
        user,
        authKind,
        password: undefined,
        oauthState: "none",
      };
    });
    const defaultMatch = /^defaultAccount:\s*(.+)\s*$/m.exec(text);
    const defaultAccount =
      defaultMatch?.[1]?.trim().replace(/['"]/g, "") ||
      rowDefault ||
      names[0];
    return {
      list,
      ...(defaultAccount ? { defaultAccount } : {}),
    };
  } catch (error) {
    return {
      list: [],
      error: error instanceof Error ? error.message : "accountsYaml parse failed",
    };
  }
}

function serializeAccountsYaml(
  cards: Array<Record<string, unknown>>,
  defaultAccount: string,
): string {
  const lines: string[] = [];
  if (defaultAccount) lines.push(`defaultAccount: ${defaultAccount}`);
  for (const card of cards) {
    const name = String(card.name ?? "").trim();
    if (!name) continue;
    lines.push(`${name}:`);
    if (typeof card.provider === "string" && card.provider) {
      lines.push(`  provider: ${card.provider}`);
    }
    if (typeof card.user === "string" && card.user) {
      lines.push(`  user: ${JSON.stringify(card.user)}`);
    }
    if (typeof card.password === "string") {
      lines.push(`  password: ${JSON.stringify(card.password)}`);
    }
    if (typeof card.authKind === "string" && card.authKind) {
      lines.push(`  authKind: ${card.authKind}`);
    }
    if (card.imap && typeof card.imap === "object") {
      const imap = card.imap as Record<string, unknown>;
      lines.push("  imap:");
      if (typeof imap.host === "string") lines.push(`    host: ${imap.host}`);
      if (typeof imap.port === "number") lines.push(`    port: ${imap.port}`);
      if (typeof imap.secure === "boolean") {
        lines.push(`    secure: ${imap.secure}`);
      }
    }
    if (card.smtp && typeof card.smtp === "object") {
      const smtp = card.smtp as Record<string, unknown>;
      lines.push("  smtp:");
      if (typeof smtp.host === "string") lines.push(`    host: ${smtp.host}`);
      if (typeof smtp.port === "number") lines.push(`    port: ${smtp.port}`);
      if (typeof smtp.secure === "boolean") {
        lines.push(`    secure: ${smtp.secure}`);
      }
    }
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

function normalizeValue(raw: unknown): EmailSettingsValue {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    ...obj,
    accountsYaml:
      typeof obj.accountsYaml === "string" ? obj.accountsYaml : "",
    defaultAccount:
      typeof obj.defaultAccount === "string" ? obj.defaultAccount : "",
    serverPresets:
      typeof obj.serverPresets === "string" ? obj.serverPresets : "",
  };
}

function snapshot(xrkHome: string | undefined): Record<string, unknown> {
  const doc = STORE.read(xrkHome).data;
  const value = doc.value;
  const draft = parseAccountsDraft(value.accountsYaml, value.defaultAccount);
  const accounts = draft.list.map((c) => String(c.name));
  return {
    settings: {
      value,
      revision: doc.revision,
      applies: "live",
    },
    writable: true,
    accounts,
    accountsDetail: {
      ...(draft.defaultAccount !== undefined
        ? { defaultAccount: draft.defaultAccount }
        : {}),
      list: draft.list,
      ...(draft.error !== undefined ? { error: draft.error } : {}),
    },
    presets: presetsSnapshot(),
    whale: {
      url: WHALE_ASSET_ROUTE,
      skin: false,
      credit: "XRK placeholder",
    },
    adapter: DSH_COMPAT_ADAPTER,
  };
}

function fail(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, status, {
    ok: false,
    error: { code, message },
    adapter: DSH_COMPAT_ADAPTER,
  });
}

function sendWhale(res: ServerResponse, method: string): void {
  res.writeHead(200, {
    "content-type": "image/png",
    "content-length": String(PLACEHOLDER_PNG.length),
    "cache-control": "no-store",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(PLACEHOLDER_PNG);
}

export async function handleDshEmailHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: DshEmailOptions = {},
): Promise<boolean> {
  if (!isDshEmailPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;
  const norm = pathname.replace(/^\/_dsh\/dsh-aimail/, "/_dsh/dsh-email");

  if (
    norm === WHALE_ASSET_ROUTE ||
    norm === "/_dsh/dsh-email/assets/whale/"
  ) {
    if (method !== "GET" && method !== "HEAD") {
      fail(res, 405, "method-not-allowed", "Use GET");
      return true;
    }
    sendWhale(res, method);
    return true;
  }

  if (
    norm !== "/_dsh/dsh-email/settings" &&
    norm !== "/_dsh/dsh-email/settings/"
  ) {
    sendJson(res, 200, {
      ok: true,
      plugin: "dsh-email",
      path: pathname,
      adapter: DSH_COMPAT_ADAPTER,
      note: "Use /_dsh/dsh-email/settings for the settings action bridge.",
    });
    return true;
  }

  if (method === "GET" || method === "HEAD") {
    sendJson(res, 200, { ok: true, value: snapshot(xrkHome) });
    return true;
  }

  if (method !== "POST") {
    fail(res, 405, "method-not-allowed", "Use GET or POST");
    return true;
  }

  const body = await parseJsonBody(req);
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "oauthLogin" || action === "oauthPoll") {
      sendJson(res, 200, {
        ok: false,
        status: "unavailable",
        message:
          "Outlook device-code OAuth is not embedded on XRK-Harness; configure IMAP passwords or run with Cordis email host.",
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }

    if (action === "save") {
      const expected = body.expectedRevision;
      if (!Number.isSafeInteger(expected)) {
        throw Object.assign(
          new Error("expectedRevision must be a non-negative integer"),
          { code: "rejected" },
        );
      }
      const current = STORE.read(xrkHome).data;
      if (expected !== current.revision) {
        const err = new Error("settings revision conflict");
        (err as { code?: string }).code = "SETTINGS_CONFLICT";
        throw err;
      }
      const nextValue = normalizeValue(body.value);
      STORE.write(xrkHome, {
        value: nextValue,
        revision: current.revision + 1,
      });
      sendJson(res, 200, { ok: true, value: snapshot(xrkHome) });
      return true;
    }

    if (action === "test") {
      const value = normalizeValue(body.value);
      const draft = parseAccountsDraft(
        value.accountsYaml,
        value.defaultAccount,
      );
      const requested =
        typeof body.account === "string" ? body.account.trim() : "";
      const name = requested || draft.defaultAccount || draft.list[0]?.name;
      if (!name || typeof name !== "string") {
        throw new Error("no account to test");
      }
      const card = draft.list.find((c) => c.name === name);
      const provider =
        typeof card?.provider === "string" ? card.provider : "";
      const preset = PROVIDER_PRESETS[provider];
      fail(
        res,
        400,
        "imap-unavailable",
        `IMAP dial for "${name}" (${preset?.imap.host ?? "unknown host"}) is not embedded on XRK-Harness; settings still persist.`,
      );
      return true;
    }

    if (action === "watch") {
      sendJson(res, 200, {
        ok: true,
        value: {
          newCount: 0,
          messages: [],
          deferred: true,
          adapter: DSH_COMPAT_ADAPTER,
          note: "email_watch needs IMAP pool; not embedded.",
        },
      });
      return true;
    }

    if (action === "parseAccounts") {
      const text =
        typeof (body.value as { accountsYaml?: unknown } | undefined)
          ?.accountsYaml === "string"
          ? (body.value as { accountsYaml: string }).accountsYaml
          : "";
      const draft = parseAccountsDraft(
        text,
        STORE.read(xrkHome).data.value.defaultAccount,
      );
      sendJson(res, 200, {
        ok: true,
        value: {
          ok: draft.error === undefined,
          ...(draft.error !== undefined ? { error: draft.error } : {}),
          ...(draft.defaultAccount !== undefined
            ? { defaultAccount: draft.defaultAccount }
            : {}),
          list: draft.list,
        },
      });
      return true;
    }

    if (action === "serializeAccounts") {
      if (!Array.isArray(body.accounts)) {
        throw new Error("accounts must be an array");
      }
      const cards: Array<Record<string, unknown>> = [];
      for (const entry of body.accounts) {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          throw new Error("each accounts entry must be an object");
        }
        const row = entry as Record<string, unknown>;
        const name = typeof row.name === "string" ? row.name.trim() : "";
        if (!name) throw new Error("each accounts entry needs a non-empty name");
        if (name === "defaultAccount") {
          throw new Error("account name cannot be defaultAccount");
        }
        cards.push({ ...row, name });
      }
      const chosen =
        typeof body.defaultAccount === "string"
          ? body.defaultAccount.trim()
          : "";
      const accountsYaml = serializeAccountsYaml(cards, chosen);
      sendJson(res, 200, {
        ok: true,
        value: {
          accountsYaml,
          commentsDropped: true,
        },
      });
      return true;
    }

    // Unknown action → return current snapshot (GET-equivalent).
    sendJson(res, 200, { ok: true, value: snapshot(xrkHome) });
    return true;
  } catch (error) {
    const conflict =
      error instanceof Error &&
      (error as { code?: string }).code === "SETTINGS_CONFLICT";
    fail(
      res,
      conflict ? 409 : 400,
      conflict ? "settings-conflict" : "rejected",
      error instanceof Error ? error.message : "unknown error",
    );
    return true;
  }
}
