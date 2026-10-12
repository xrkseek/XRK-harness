/** Live chat-tool expand preference shared across ToolRow / Bash registrants. */
import { createContext, useContext, useEffect, useRef, useState } from 'react'

/**
 * Initial expand state for tool rows. ToolCallTree provides the Settings-
 * backed value; absent provider keeps the DSH default (collapsed).
 */
export const ToolDefaultExpandedContext = createContext(false)

/** Read whether tool rows should mount expanded. */
export function useToolDefaultExpanded(): boolean {
  return useContext(ToolDefaultExpandedContext)
}

/**
 * Expand state that follows Settings until the reader toggles once.
 * Covers Host hydrate (store false → true after first paint) without
 * fighting a manual collapse/expand.
 */
export function useToolExpandState(): [boolean, () => void] {
  const defaultExpanded = useToolDefaultExpanded()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) setExpanded(defaultExpanded)
  }, [defaultExpanded])
  const toggle = (): void => {
    touched.current = true
    setExpanded(value => !value)
  }
  return [expanded, toggle]
}
