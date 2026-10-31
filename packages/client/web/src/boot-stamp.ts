/**
 * Synchronous boot stamp for body-portaled workbench chrome.
 * Must run before plugin fibers activate — useEffect is too late (first paint
 * can show better-sidebar FABs above / beside the splash).
 */
export const BOOTING_ATTR = 'data-xrk-booting' as const
/** DSH-shaped alias so community CSS that gates on `data-dsh-booting` also hides. */
export const BOOTING_ATTR_DSH = 'data-dsh-booting' as const

/**
 * Stamp `<html data-xrk-booting>` (+ DSH alias, optional lang) while the splash
 * owns the viewport. Leave `#xrk-boot-skeleton` visible until {@link clearBooting}:
 * AppRoot (z=100) covers it; hiding early leaves a blank `#root` frame on remount.
 */
export function stampBooting(lang?: 'zh' | 'en' | 'ja'): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute(BOOTING_ATTR, '')
  root.setAttribute(BOOTING_ATTR_DSH, '')
  if (lang !== undefined) {
    root.setAttribute(
      'lang',
      lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja' : 'en',
    )
  }
  document.getElementById('xrk-boot-skeleton')?.removeAttribute('hidden')
}

/** Clear the boot stamp once the product UI is settled. */
export function clearBooting(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.removeAttribute(BOOTING_ATTR)
  root.removeAttribute(BOOTING_ATTR_DSH)
  document.getElementById('xrk-boot-skeleton')?.setAttribute('hidden', '')
}
