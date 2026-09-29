/**
 * Synchronous boot stamp for body-portaled workbench chrome.
 * Must run before plugin fibers activate — useEffect is too late (first paint
 * can show better-sidebar FABs above / beside the splash).
 */
export const BOOTING_ATTR = 'data-xrk-booting' as const

/** Stamp `<html data-xrk-booting>` (+ optional lang) while the splash owns the viewport. */
export function stampBooting(lang?: 'zh' | 'en'): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute(BOOTING_ATTR, '')
  if (lang !== undefined) root.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en')
}

/** Clear the boot stamp once the product UI is settled. */
export function clearBooting(): void {
  if (typeof document === 'undefined') return
  document.documentElement.removeAttribute(BOOTING_ATTR)
}
