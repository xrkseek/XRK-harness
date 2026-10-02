/** Live chat-tool expand preference shared across ToolRow / Bash registrants. */
import { createContext, useContext } from 'react'

/**
 * Initial expand state for tool rows. ToolCallTree provides the Settings-
 * backed value; absent provider keeps the DSH default (collapsed).
 */
export const ToolDefaultExpandedContext = createContext(false)

/** Read whether tool rows should mount expanded. */
export function useToolDefaultExpanded(): boolean {
  return useContext(ToolDefaultExpandedContext)
}
