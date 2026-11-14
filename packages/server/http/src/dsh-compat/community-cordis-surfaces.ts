/**
 * Shared Cordis surface bridges for community host halves.
 *
 * Tools / skills / systemPrompt are Cordis {@link Service}s so registrations
 * bind to the *caller* fiber (nekowhale remounts Agent on settings change and
 * must drop stale tools). Settings / index-inject stay plain collectors.
 */
import { Context, Service } from "@xrkseek/cordis";
import type { ToolDefinition as CoreToolDefinition } from "@xrkseek/core-tools";
import type { ToolDefinition as XrkToolDefinition } from "@xrkseek/xrk-tools";
import { adaptXrkToolToCore } from "./community-cordis-tool-adapt.js";
import type {
  CommunityIndexGlobal,
  CommunityPromptSection,
} from "./community-host-registry.js";

export type CommunityToolsBridge = {
  register(definition: XrkToolDefinition): () => void;
  list(): readonly XrkToolDefinition[];
  toCoreTools(): readonly CoreToolDefinition[];
};

export type CommunitySkillsBridge = {
  registerProvider(provider: unknown): () => void;
  providers(): readonly unknown[];
  skillDirs(): readonly string[];
  addSkillDir(dir: string): void;
};

export type CommunitySystemPromptBridge = {
  section(input: {
    readonly name: string;
    readonly order?: number;
    readonly text: string | (() => string | Promise<string>);
  }): () => void;
  sections(): readonly CommunityPromptSection[];
};

export type CommunitySettingsBridge = {
  installSection(
    _ctx: unknown,
    namespace: string,
    _schema: unknown,
    base: Record<string, unknown>,
    options?: {
      setSource?: (current: () => Record<string, unknown>) => void;
      onChange?: () => void;
    },
  ): () => void;
  configure(_opts?: unknown, _fiber?: unknown): () => void;
  update(): Promise<void>;
  peek(namespace: string): Record<string, unknown>;
};

export type CommunitySettingsStore = {
  ensure(
    namespace: string,
    defaults?: Record<string, unknown>,
  ): {
    get(): Record<string, unknown>;
    set(patch: Record<string, unknown>): void;
  };
};

export type CommunityIndexInjectBridge = {
  globals(): readonly CommunityIndexGlobal[];
  push(global: CommunityIndexGlobal): void;
  emit(root: Context): void;
};

/**
 * Tools seat: fiber-scoped register (caller ctx via Service tracker).
 * Without effect binding, nekowhale remount leaves meme_render after templates off.
 */
class CommunityToolsService extends Service implements CommunityToolsBridge {
  private readonly tools = new Map<string, XrkToolDefinition>();
  /** Cache adapt results while the source Map identity set is unchanged. */
  private adaptedCache:
    | {
        readonly sources: readonly XrkToolDefinition[];
        readonly core: readonly CoreToolDefinition[];
      }
    | undefined;

  constructor(ctx: Context) {
    super(ctx, "tools");
  }

  register(definition: XrkToolDefinition): () => void {
    const name = definition?.name?.trim();
    if (!name) {
      throw new TypeError("tools.register: tool name required");
    }
    // this.ctx is the *caller* fiber (Agent remount), not the root provider.
    const dispose = this.ctx.effect(() => {
      this.tools.set(name, definition);
      this.adaptedCache = undefined;
      return () => {
        if (this.tools.get(name) === definition) {
          this.tools.delete(name);
          this.adaptedCache = undefined;
        }
      };
    }, `tools.register(${JSON.stringify(name)})`);
    return () => {
      void dispose();
    };
  }

  list(): readonly XrkToolDefinition[] {
    return [...this.tools.values()];
  }

  toCoreTools(): readonly CoreToolDefinition[] {
    const sources = this.list();
    const cached = this.adaptedCache;
    if (
      cached &&
      cached.sources.length === sources.length &&
      cached.sources.every((tool, i) => tool === sources[i])
    ) {
      return cached.core;
    }
    const core = sources.map(adaptXrkToolToCore);
    this.adaptedCache = { sources, core };
    return core;
  }
}

class CommunitySkillsService extends Service implements CommunitySkillsBridge {
  private readonly providerList: unknown[] = [];
  /** Manual dirs (staged SKILL.md trees) — never auto-removed. */
  private readonly manualDirs = new Set<string>();
  /** Dirs harvested per provider — removed when that provider's fiber ends. */
  private readonly dirsByProvider = new Map<unknown, Set<string>>();

  constructor(ctx: Context) {
    super(ctx, "skills");
  }

  registerProvider(provider: unknown): () => void {
    const dispose = this.ctx.effect(() => {
      this.providerList.push(provider);
      const harvested = new Set<string>();
      this.dirsByProvider.set(provider, harvested);
      harvestSkillDirs(provider, harvested);
      void Promise.resolve()
        .then(async () => {
          if (!this.dirsByProvider.has(provider)) return;
          const list = (provider as { list?: () => unknown }).list;
          if (typeof list !== "function") return;
          const rows = await list();
          if (!Array.isArray(rows)) return;
          for (const row of rows) harvestSkillDirs(row, harvested);
        })
        .catch(() => undefined);
      return () => {
        const i = this.providerList.indexOf(provider);
        if (i >= 0) this.providerList.splice(i, 1);
        this.dirsByProvider.delete(provider);
      };
    }, "skills.registerProvider()");
    return () => {
      void dispose();
    };
  }

  providers(): readonly unknown[] {
    return [...this.providerList];
  }

  skillDirs(): readonly string[] {
    const out = new Set<string>(this.manualDirs);
    for (const dirs of this.dirsByProvider.values()) {
      for (const d of dirs) out.add(d);
    }
    return [...out];
  }

  addSkillDir(dir: string): void {
    const d = dir.trim();
    if (d) this.manualDirs.add(d);
  }
}

class CommunitySystemPromptService
  extends Service
  implements CommunitySystemPromptBridge
{
  private readonly byName = new Map<string, CommunityPromptSection>();

  constructor(ctx: Context) {
    super(ctx, "systemPrompt");
  }

  section(input: {
    readonly name: string;
    readonly order?: number;
    readonly text: string | (() => string | Promise<string>);
  }): () => void {
    const name = input.name.trim();
    if (!name) throw new TypeError("systemPrompt.section: name required");
    const row: CommunityPromptSection = {
      name,
      order: typeof input.order === "number" ? input.order : 0,
      text:
        typeof input.text === "function"
          ? input.text
          : () => String(input.text ?? ""),
    };
    const dispose = this.ctx.effect(() => {
      this.byName.set(name, row);
      return () => {
        if (this.byName.get(name) === row) this.byName.delete(name);
      };
    }, `systemPrompt.section(${JSON.stringify(name)})`);
    return () => {
      void dispose();
    };
  }

  sections(): readonly CommunityPromptSection[] {
    return [...this.byName.values()];
  }
}

function harvestSkillDirs(provider: unknown, into: Set<string>): void {
  if (!provider || typeof provider !== "object") return;
  const resourceBase = (provider as { resourceBase?: { path?: string } })
    .resourceBase;
  if (typeof resourceBase?.path === "string" && resourceBase.path.trim()) {
    into.add(resourceBase.path.trim());
  }
}

export function createCommunitySettingsBridge(
  store?: CommunitySettingsStore,
): CommunitySettingsBridge {
  const memory = new Map<string, Record<string, unknown>>();
  const onChanges = new Map<string, () => void>();

  const slot = (namespace: string, defaults?: Record<string, unknown>) => {
    // Always wrap so Face/memory set() still fires installSection onChange
    // (nekowhale remounts Agent on settings flip).
    if (store) {
      const inner = store.ensure(namespace, defaults);
      return {
        get: () => inner.get(),
        set(patch: Record<string, unknown>) {
          inner.set(patch);
          onChanges.get(namespace)?.();
        },
      };
    }
    let current = memory.get(namespace);
    if (!current) {
      current = { ...(defaults ?? {}) };
      memory.set(namespace, current);
    } else if (defaults) {
      current = { ...defaults, ...current };
      memory.set(namespace, current);
    }
    return {
      get: () => ({ ...(memory.get(namespace) ?? {}) }),
      set(patch: Record<string, unknown>) {
        const next = { ...(memory.get(namespace) ?? {}), ...patch };
        memory.set(namespace, next);
        onChanges.get(namespace)?.();
      },
    };
  };

  return {
    installSection(_ctx, namespace, _schema, base, options) {
      const ns = namespace.trim();
      if (!ns) return () => undefined;
      const s = slot(ns, base);
      const existing = s.get();
      const seed: Record<string, unknown> = { ...base };
      for (const [k, v] of Object.entries(existing)) {
        if (v !== undefined) seed[k] = v;
      }
      s.set(seed);
      options?.setSource?.(() => s.get());
      if (options?.onChange) onChanges.set(ns, options.onChange);
      options?.onChange?.();
      return () => {
        onChanges.delete(ns);
      };
    },
    configure() {
      return () => undefined;
    },
    async update() {
      return undefined;
    },
    peek(namespace) {
      return slot(namespace.trim()).get();
    },
  };
}

export function createCommunityIndexInjectBridge(): CommunityIndexInjectBridge {
  const byName = new Map<string, CommunityIndexGlobal>();
  return {
    globals() {
      return [...byName.values()];
    },
    push(global) {
      const name = global.name.trim();
      if (!name) return;
      byName.set(name, { name, value: global.value });
    },
    emit(root) {
      const table: Array<{ kind?: string; name?: string; value?: unknown }> = [];
      try {
        // Community host halves listen on this Cordis event; not in stock Events.
        (root as Context & {
          emit(name: string, ...args: unknown[]): void;
        }).emit("webserver/index-inject", table);
      } catch {
        /* plugins that do not listen are fine */
      }
      for (const row of table) {
        const name = typeof row?.name === "string" ? row.name.trim() : "";
        if (!name) continue;
        byName.set(name, { name, value: row.value });
      }
    },
  };
}

/**
 * Provide tools / skills / systemPrompt / settings on a Cordis root.
 * Tools/skills/prompt are Services (fiber-scoped). Index-inject harvested after apply.
 */
export function provideCommunityAgentSurfaces(
  root: Context,
  options?: {
    readonly settingsStore?: CommunitySettingsStore;
    readonly settingsConfigure?: boolean;
    /** Fired after installSection onChange (Settings remount → republish). */
    readonly onSettingsChange?: (namespace: string) => void;
  },
): {
  readonly tools: CommunityToolsBridge;
  readonly skills: CommunitySkillsBridge;
  readonly systemPrompt: CommunitySystemPromptBridge;
  readonly settings: CommunitySettingsBridge;
  readonly indexInject: CommunityIndexInjectBridge;
} {
  const tools = new CommunityToolsService(root);
  const skills = new CommunitySkillsService(root);
  const systemPrompt = new CommunitySystemPromptService(root);
  const settings = createCommunitySettingsBridge(options?.settingsStore);
  const indexInject = createCommunityIndexInjectBridge();
  const onSettingsChange = options?.onSettingsChange;

  const installSection: CommunitySettingsBridge["installSection"] = (
    ctx,
    namespace,
    schema,
    base,
    sectionOptions,
  ) => {
    const userOnChange = sectionOptions?.onChange;
    return settings.installSection(ctx, namespace, schema, base, {
      ...sectionOptions,
      onChange: () => {
        userOnChange?.();
        onSettingsChange?.(namespace.trim());
      },
    });
  };

  const settingsFace: CommunitySettingsBridge = {
    ...settings,
    installSection,
  };

  root.provide(
    "settings",
    options?.settingsConfigure !== false
      ? settingsFace
      : {
          installSection: settingsFace.installSection.bind(settingsFace),
          update: settingsFace.update.bind(settingsFace),
        },
  );

  return {
    tools,
    skills,
    systemPrompt,
    settings: settingsFace,
    indexInject,
  };
}
