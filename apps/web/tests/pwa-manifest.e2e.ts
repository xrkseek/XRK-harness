import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
  expect(index).toContain('XRK Harness')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toMatchObject({
    id: '/',
    name: 'XRK Harness',
    short_name: 'XRK',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
  })
  const icons = (manifest as { icons: Array<{ src: string }> }).icons
  expect(icons.some((i) => i.src === '/favicon.svg')).toBe(true)
  expect(icons.some((i) => i.src === '/favicon.png')).toBe(true)
})

it('ships a favicon that switches under dark color scheme', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)/)
  expect(favicon).toContain('class="accent"')
})
