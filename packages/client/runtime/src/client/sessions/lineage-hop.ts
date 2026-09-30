/**
 * Parent↔child (or sibling under the same parent) Session hop.
 * Used by Overview open/paint memory so delegation does not hard-reset chrome.
 */
export function isSessionLineageHop(
  fromId: string,
  fromParentId: string | undefined,
  toId: string,
  toParentId: string | undefined,
): boolean {
  if (fromId === toId) return false
  if (fromParentId === toId || toParentId === fromId) return true
  if (fromParentId !== undefined && fromParentId === toParentId) return true
  return false
}
