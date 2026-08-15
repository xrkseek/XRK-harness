# LLM Provider Registry R0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@xrkseek/llm-registry` with `resolve` → `createAdapter` single path, OpenAI-chat BrandEntries, and host/env wiring — not a bare constants table.

**Architecture:** New package under `packages/llm/registry` registers protocol factories (`openai-chat` → `createOpenAiCompatibleAdapter`) and BrandEntries from the product table. Callers only use `createProviderRegistry` + `resolve` + `createAdapter`. Server/host must not import vendor SDKs; they depend on this package + secrets from env.

**Tech Stack:** TypeScript · Vitest · existing `@xrkseek/llm-openai-compatible` · pnpm workspace

**Specs:** [docs/llm-provider-registry.md](../../llm-provider-registry.md) · [docs/llm-provider-presets.md](../../llm-provider-presets.md) · [docs/learn/provider-registry.md](../../learn/provider-registry.md)

**Depends on:** nothing new (uses existing openai-compatible)

**Unblocks:** Host Face U1 `session.models` / `llm.providers` ([2026-08-15-host-face-u1.md](./2026-08-15-host-face-u1.md))

## Global Constraints

- Node `>=20`; packageManager `pnpm@9.15.0`
- Package name `@xrkseek/llm-registry`; private workspace package like siblings
- No secrets in repo; `apiKey` only via `createAdapter(..., secrets)`
- Builtin≠compat: R0 only registers protocol `openai-chat`; do not silently map future anthropic brands to openai-chat
- `pnpm check` must stay green (tsc → eslint → vitest → kernel coverage)
- Do **not** `git commit` unless the user explicitly asks

---

## File map

| Path | Role |
|------|------|
| `packages/llm/registry/package.json` | Package manifest |
| `packages/llm/registry/tsconfig.json` | Composite project |
| `packages/llm/registry/src/types.ts` | Binding / BrandEntry / ResolveInput |
| `packages/llm/registry/src/brands-openai-chat.ts` | BrandEntries data (locked URLs) |
| `packages/llm/registry/src/registry.ts` | `createProviderRegistry` |
| `packages/llm/registry/src/index.ts` | Public exports |
| `packages/llm/registry/tests/registry.test.ts` | Resolve + brand snapshot + createAdapter mock |
| `packages/llm/registry/README.md` | Status + non-goals |
| `vitest.config.ts` | Alias `@xrkseek/llm-registry` |
| `tsconfig.json` | Project reference |
| `packages/server/config` / host or CLI | `XRK_LLM_PRESET` wiring (Task 4) |
| `docs/status.md` · `docs/llm-provider-presets.md` | Mark R0 code checkboxes |

---

### Task 1: Package skeleton + types + BrandEntries snapshot tests

**Files:**
- Create: `packages/llm/registry/package.json`
- Create: `packages/llm/registry/tsconfig.json`
- Create: `packages/llm/registry/src/types.ts`
- Create: `packages/llm/registry/src/brands-openai-chat.ts`
- Create: `packages/llm/registry/src/index.ts` (re-export brands + types only for this task)
- Create: `packages/llm/registry/tests/brands.test.ts`
- Create: `packages/llm/registry/README.md`
- Modify: `vitest.config.ts` (add alias)
- Modify: `tsconfig.json` (add reference)

**Interfaces:**
- Produces: `BrandEntry`, `OPENAI_CHAT_BRANDS`, `getOpenAiChatBrand(id)`

- [ ] **Step 1: Add package.json**

```json
{
  "name": "@xrkseek/llm-registry",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "dependencies": {
    "@xrkseek/llm": "workspace:*",
    "@xrkseek/llm-openai-compatible": "workspace:*"
  }
}
```

- [ ] **Step 2: Add tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../llm" },
    { "path": "../openai-compatible" }
  ]
}
```

- [ ] **Step 3: Write types.ts**

```ts
export type ProtocolId = "openai-chat";

export type AuthMode = "bearer" | "api-key";

export interface BrandEntry {
  readonly id: string;
  readonly displayName: string;
  readonly protocol: ProtocolId;
  readonly baseUrl?: string;
  readonly path?: string;
  readonly authMode?: AuthMode;
  readonly apiKeyEnv?: string;
  readonly defaultModel?: string;
  readonly notes?: string;
}

export interface ResolveInput {
  readonly provider?: string;
  readonly model?: string;
  readonly llm?: string;
  readonly profile?: string;
  readonly defaultProvider?: string;
  /** Override brand baseUrl (required for custom/newapi/cherryin/azure-openai). */
  readonly baseUrl?: string;
  readonly path?: string;
  readonly allowDefaultAliases?: boolean;
}

export interface ProviderBinding {
  readonly provider: string;
  readonly protocol: ProtocolId;
  readonly factoryKind: "compat";
  readonly model: string;
  readonly baseUrl: string;
  readonly path: string;
  readonly authMode: AuthMode;
  readonly apiKeyEnv?: string;
  readonly displayName: string;
}
```

- [ ] **Step 4: Write brands-openai-chat.ts** with exact rows (lock in tests):

| id | baseUrl | authMode | path | apiKeyEnv |
|----|---------|----------|------|-----------|
| openai | `https://api.openai.com/v1` | bearer | `/chat/completions` | OPENAI_API_KEY |
| deepseek | `https://api.deepseek.com` | bearer | `/chat/completions` | DEEPSEEK_API_KEY |
| openrouter | `https://openrouter.ai/api/v1` | bearer | `/chat/completions` | OPENROUTER_API_KEY |
| groq | `https://api.groq.com/openai/v1` | bearer | `/chat/completions` | GROQ_API_KEY |
| fireworks | `https://api.fireworks.ai/inference/v1` | bearer | `/chat/completions` | FIREWORKS_API_KEY |
| together | `https://api.together.xyz/v1` | bearer | `/chat/completions` | TOGETHER_API_KEY |
| github-models | `https://models.inference.ai.azure.com` | bearer | `/chat/completions` | GITHUB_TOKEN |
| ollama | `http://127.0.0.1:11434/v1` | bearer | `/chat/completions` | (omit) |
| azure-openai | undefined | api-key | `/chat/completions` | AZURE_OPENAI_API_KEY |
| newapi | undefined | bearer | `/chat/completions` | NEWAPI_API_KEY |
| cherryin | undefined | bearer | `/chat/completions` | CHERRYIN_API_KEY |
| custom | undefined | bearer | `/chat/completions` | OPENAI_API_KEY |

Export `OPENAI_CHAT_BRANDS: readonly BrandEntry[]` and `getOpenAiChatBrand(id: string): BrandEntry | undefined`.

- [ ] **Step 5: Write failing/passing brands.test.ts** that snapshots every id’s `baseUrl`/`authMode`/`path`/`apiKeyEnv`/`protocol`.

- [ ] **Step 6: Wire vitest alias + root tsconfig reference**

In `vitest.config.ts` add:
`pkg("llm-registry", "packages/llm/registry/src/index.ts")`

In root `tsconfig.json` `references` add `{ "path": "packages/llm/registry" }`.

- [ ] **Step 7: README** — Status: R0 BrandEntries; full registry in Task 2; non-goals R1 protocols.

- [ ] **Step 8: Run tests**

```bash
pnpm exec vitest run packages/llm/registry/tests/brands.test.ts
```

Expected: PASS

- [ ] **Step 9: Commit only if user asked**

---

### Task 2: `createProviderRegistry` resolve + createAdapter

**Files:**
- Create: `packages/llm/registry/src/registry.ts`
- Modify: `packages/llm/registry/src/index.ts`
- Create: `packages/llm/registry/tests/registry.test.ts`

**Interfaces:**
- Consumes: `BrandEntry`, `OPENAI_CHAT_BRANDS`, `createOpenAiCompatibleAdapter`
- Produces:

```ts
function createProviderRegistry(options?: {
  brands?: readonly BrandEntry[];
  defaultProvider?: string;
  defaultModel?: string;
}): ProviderRegistry;

interface ProviderRegistry {
  registerBrand(entry: BrandEntry): void;
  resolve(input: ResolveInput): ProviderBinding;
  createAdapter(
    binding: ProviderBinding,
    secrets: { apiKey?: string },
    extras?: { id?: string; fetch?: typeof fetch; model?: string },
  ): LlmAdapter;
  listBrands(): readonly BrandEntry[];
  listRoutable(secretsEnv?: NodeJS.ProcessEnv): readonly {
    id: string;
    displayName: string;
    active: boolean;
  }[];
}
```

- [ ] **Step 1: Write failing tests** in `registry.test.ts`:

1. `resolve({ provider: "openrouter", model: "x" })` → binding with OpenRouter baseUrl, model `x`
2. `resolve({})` with `defaultProvider: "deepseek"` → deepseek binding + defaultModel `deepseek-chat` if brand has it (set `defaultModel: "deepseek-chat"` on deepseek brand)
3. `resolve({ provider: "nope" })` throws `/unknown provider/i`
4. `resolve({ provider: "custom" })` without baseUrl throws `/baseUrl required/i`
5. `resolve({ provider: "custom", baseUrl: "https://gw.example/v1" })` works
6. Skipping `default`/`auto` when they are the only candidate and no defaultProvider → throw
7. `createAdapter` with mock fetch returns chat content; adapter.id defaults to `binding.provider`

- [ ] **Step 2: Run tests — expect FAIL** (registry missing)

```bash
pnpm exec vitest run packages/llm/registry/tests/registry.test.ts
```

- [ ] **Step 3: Implement registry.ts**

Resolve order (copy from spec): `provider` → `llm` → `profile` → `defaultProvider` → registry option `defaultProvider`. Normalize keys with `trim` + lowercase. Skip empty, and skip `default`/`auto` unless `allowDefaultAliases === true` **and** that name exists as a brand (R0: still skip — no brand named default).

For brand without `baseUrl`, require `input.baseUrl`. Merge `input.path` over brand path over `/chat/completions`. Model: `input.model` ?? brand.defaultModel ?? `"gpt-4o-mini"` (document constant `REGISTRY_FALLBACK_MODEL`).

`createAdapter`: only `openai-chat` → `createOpenAiCompatibleAdapter({ id: extras?.id ?? binding.provider, baseUrl, path, authMode: binding.authMode === "api-key" ? "api-key" : "bearer", apiKey: secrets.apiKey, model: extras?.model ?? binding.model, fetch: extras?.fetch })`.

`listRoutable`: each brand; `active` = has baseUrl (or always true for ollama) AND (no apiKeyEnv OR env has non-empty key). Optional `secretsEnv` defaults to `process.env`.

- [ ] **Step 4: Export from index.ts**

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit only if user asked**

---

### Task 3: Env helper `resolveLlmFromEnv`

**Files:**
- Create: `packages/llm/registry/src/from-env.ts`
- Modify: `packages/llm/registry/src/index.ts`
- Create: `packages/llm/registry/tests/from-env.test.ts`

**Interfaces:**
- Produces:

```ts
function resolveLlmFromEnv(
  env: NodeJS.ProcessEnv,
  registry?: ProviderRegistry,
): { binding: ProviderBinding; adapter: LlmAdapter } | undefined;
```

Semantics:
- Read `XRK_LLM_PRESET` (provider id). If missing, return `undefined` (caller keeps prior behavior).
- Read `XRK_LLM_MODEL`, `XRK_LLM_BASE_URL` (optional overrides).
- `registry.resolve({ provider: preset, model, baseUrl })`.
- `apiKey` from `binding.apiKeyEnv` → `env[apiKeyEnv]`.
- Return `{ binding, adapter: registry.createAdapter(binding, { apiKey }) }`.

- [ ] **Step 1: Failing test** — env with `XRK_LLM_PRESET=groq`, `GROQ_API_KEY=sk`, `XRK_LLM_MODEL=llama` → binding.provider `groq`, adapter.id `groq`.

- [ ] **Step 2: Implement + pass**

- [ ] **Step 3: Commit only if user asked**

---

### Task 4: Wire serve / agent factory (minimal)

**Files:**
- Find current factory that constructs LLM (search `createOpenAiCompatibleAdapter` / `createDeepSeekAdapter` / `llm-replay` in `apps/cli`, `presets/*`, `packages/sdk`).
- Modify that call site to prefer `resolveLlmFromEnv(process.env)` when preset set; else existing path.
- Modify: `packages/server/config` if env schema lists known keys — add `XRK_LLM_PRESET` / `XRK_LLM_MODEL` / `XRK_LLM_BASE_URL` docs only or typed fields.
- Modify: `docs/http-api.md` env table
- Modify: `docs/llm-provider-presets.md` implementation checkboxes
- Modify: `docs/status.md` Partial → note R0 shipped when done
- Modify: `docs/llm-provider-registry.md` checkboxes

**Interfaces:**
- Consumes: `resolveLlmFromEnv`
- Produces: serve path uses Registry when env set

- [ ] **Step 1: Locate factory with Grep** — list files touched in the PR description inside the commit message body later.

- [ ] **Step 2: Add a focused integration test** if one exists for host spawn; otherwise unit-test a small exported `createLlmFromHostEnv(env)` in registry (already Task 3) and call it from factory with a 5-line change.

- [ ] **Step 3: Update docs env tables**

- [ ] **Step 4: Run `pnpm check`**

Expected: green

- [ ] **Step 5: Commit only if user asked**

---

### Task 5: Spec self-check + SDK export (optional thin)

**Files:**
- Modify: `packages/sdk/package.json` + `packages/sdk/src/index.ts` to re-export registry public API if SDK already re-exports llm packages
- Modify: `packages/sdk/tsconfig.json` reference

- [ ] **Step 1: Mirror deepseek/openai-compatible export pattern**

- [ ] **Step 2: `pnpm check`**

- [ ] **Step 3: Tick checkboxes in `docs/llm-provider-registry.md` §7 for R0 items done**

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| resolve → createAdapter | 2 |
| BrandEntries table | 1 |
| listRoutable / listBrands | 2 |
| Host env XRK_LLM_* | 3–4 |
| No secrets in binding | 2 |
| Tests lock URLs | 1 |
| Face llm.* | Host Face plan (not this plan) |

## Placeholder scan

None intentional. `REGISTRY_FALLBACK_MODEL` must be a real exported const in Task 2.
