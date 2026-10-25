/**
 * Localize tool-row titles through the conversation dictionary.
 * Wire names and VARIANT_TITLES stay English for tests / fallbacks; render
 * sites that hold `t` prefer these keys.
 */
import type { ToolRowVariant } from './tool-call-model.ts'

type Translate = (key: string, params?: Record<string, string | number>) => string

const VARIANT_KEYS: Record<ToolRowVariant, string> = {
  search: 'tool.variant.search',
  read: 'tool.variant.read',
  bash: 'tool.variant.bash',
  write: 'tool.variant.write',
  edit: 'tool.variant.edit',
  code: 'tool.variant.code',
  others: 'tool.variant.others',
}

/** Per-tool overrides that refine a variant title (locale keys under tool.name.*). */
const TOOL_NAME_KEYS: Record<string, string> = {
  grep: 'tool.name.grep',
  glob: 'tool.name.glob',
  web_fetch: 'tool.name.webFetch',
  web_search: 'tool.name.webSearch',
  pwsh: 'tool.name.pwsh',
  read_image: 'tool.name.readImage',
  image_generate: 'tool.name.imageGenerate',
  video_generate: 'tool.name.videoGenerate',
  present: 'tool.name.present',
  propose_skill: 'tool.name.proposeSkill',
  cordis_package_inspect: 'tool.name.cordisInspect',
  cordis_runtime_inspect: 'tool.name.cordisInspect',
  cordis_run: 'tool.name.cordisRun',
  cordis_stop: 'tool.name.cordisStop',
  cordis_undefine: 'tool.name.cordisUndefine',
}

/**
 * Prefer a tool-specific locale title, else the variant title, else the
 * English model fallback (VARIANT_TITLES / TOOL_TITLES).
 */
export function localizeToolTitle(
  toolName: string,
  variant: ToolRowVariant,
  fallback: string,
  t: Translate,
): string {
  const toolKey = TOOL_NAME_KEYS[toolName]
  if (toolKey !== undefined) {
    const labeled = t(toolKey)
    if (labeled !== toolKey) return labeled
  }
  const variantKey = VARIANT_KEYS[variant]
  const labeled = t(variantKey)
  if (labeled !== variantKey) return labeled
  return fallback
}
