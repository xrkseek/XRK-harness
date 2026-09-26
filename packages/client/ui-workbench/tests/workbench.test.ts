/** Unit tests for workbench Host helpers and openPath yield. */
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchController } from '../src/client/controller.ts'
import { isImagePath, isPdfPath, sidebarFileUrl } from '../src/client/fs-api.ts'

describe('workbench fs helpers', () => {
  it('classifies image and pdf paths', () => {
    expect(isImagePath('a/b.png')).toBe(true)
    expect(isImagePath('note.md')).toBe(false)
    expect(isPdfPath('doc.PDF')).toBe(true)
    expect(isPdfPath('doc.txt')).toBe(false)
  })

  it('builds /sidebar/file URLs with optional sessionId', () => {
    expect(sidebarFileUrl(undefined, '/tmp/a.md')).toBe('/sidebar/file?path=%2Ftmp%2Fa.md')
    expect(sidebarFileUrl('s1', 'rel/x.ts')).toContain('sessionId=s1')
    expect(sidebarFileUrl('s1', 'rel/x.ts')).toContain('path=rel%2Fx.ts')
  })
})

describe('WorkbenchController', () => {
  it('openPath returns false when yielded or unbound', () => {
    const yielded = new WorkbenchController(() => true)
    expect(yielded.openPath('/x')).toBe(false)

    const unbound = new WorkbenchController(() => false)
    expect(unbound.openPath('/x')).toBe(false)
  })

  it('openPath shows the bound panel and returns true', () => {
    const face = new WorkbenchController(() => false)
    const show = vi.fn()
    face.bindPanel({
      show,
      hide: () => {},
      isOpen: () => true,
      focusPath: () => '/a.ts',
    })
    expect(face.openPath('/a.ts')).toBe(true)
    expect(show).toHaveBeenCalledWith('/a.ts')
    expect(face.open).toBe(true)
    expect(face.focusPath).toBe('/a.ts')
  })

  it('show is a no-op when yielded; hide/show drive the bound panel otherwise', () => {
    const yielded = new WorkbenchController(() => true)
    const show = vi.fn()
    const hide = vi.fn()
    yielded.bindPanel({
      show, hide, isOpen: () => false, focusPath: () => null,
    })
    yielded.show('/x')
    expect(show).not.toHaveBeenCalled()

    const face = new WorkbenchController(() => false)
    let open = false
    face.bindPanel({
      show: (path) => { open = true; show(path) },
      hide: () => { open = false; hide() },
      isOpen: () => open,
      focusPath: () => null,
    })
    face.show()
    expect(show).toHaveBeenCalledWith(undefined)
    expect(face.open).toBe(true)
    face.hide()
    expect(hide).toHaveBeenCalled()
    expect(face.open).toBe(false)
  })
})
