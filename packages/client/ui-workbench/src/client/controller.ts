/**
 * Workbench face: panel bind + openPath gate. Community `xrkh-better-sidebar`
 * claims `ctx.betterSidebar`; when present {@link openPath} returns false so
 * chat falls through to workspaces.openPath.
 */
import type { WorkbenchFace } from './fs-api.ts'

/** Panel callbacks registered while the overlay entry is mounted. */
export interface WorkbenchPanelBind {
  show(path?: string): void
  hide(): void
  isOpen(): boolean
  focusPath(): string | null
}

/** Mutable face provided on `ctx.workbench`. */
export class WorkbenchController implements WorkbenchFace {
  private panel: WorkbenchPanelBind | null = null

  /**
   * @param isYielded - true when a community workbench owns the surface
   * (checked live so late-loaded plugins still win).
   */
  constructor(private readonly isYielded: () => boolean = () => false) {}

  /**
   * InputBar-style bind: the mounted panel registers its DOM verbs.
   * @param panel - live panel implementation.
   * @returns disposer.
   */
  bindPanel(panel: WorkbenchPanelBind): () => void {
    this.panel = panel
    return () => {
      if (this.panel === panel) this.panel = null
    }
  }

  get open(): boolean {
    if (this.isYielded()) return false
    return this.panel?.isOpen() ?? false
  }

  get focusPath(): string | null {
    return this.panel?.focusPath() ?? null
  }

  show(path?: string): void {
    if (this.isYielded()) return
    this.panel?.show(path)
  }

  hide(): void {
    this.panel?.hide()
  }

  openPath(path: string): boolean {
    if (this.isYielded() || this.panel === null) return false
    this.panel.show(path)
    return true
  }
}
