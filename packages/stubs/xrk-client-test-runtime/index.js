/**
 * Minimal browser-test helpers. Ports the dsh `makeTranslate` double so client
 * specs can stub the locale `t` seat without a full test-runtime assembly.
 */

/**
 * Build a translate stub resolving through `dicts` in order (namespace first,
 * then shared vocab), falling back to the key. Interpolates `{name}` params.
 * @param dicts - dictionaries consulted in order.
 * @returns a translate function assignable to locale `t` seats.
 */
export function makeTranslate(
  ...dicts
) {
  return (key, params) => {
    let template = key
    for (const dict of dicts) {
      const hit = dict[key]
      if (hit !== undefined) {
        template = hit
        break
      }
    }
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      name in params ? String(params[name]) : match)
  }
}
