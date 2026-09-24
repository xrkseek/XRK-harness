/**
 * Gitignore-aware WorkspaceFileSearch (composer @file / Face fileReferences).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceFileSearch } from '../src/search.js'

const roots: string[] = []
const searches: WorkspaceFileSearch[] = []

afterEach(async () => {
  for (const instance of searches.splice(0)) instance.dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function gitWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'xrk-file-search-gi-'))
  roots.push(root)
  await mkdir(join(root, '.git'), { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'README.md'), 'ok')
  await writeFile(join(root, '.gitignore'), 'dist/\n*.log\n!keep.log\n')
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist', 'bundle.js'), 'ignored')
  await writeFile(join(root, 'noise.log'), 'ignored')
  await writeFile(join(root, 'keep.log'), 'kept')
  await mkdir(join(root, 'src', 'nested'), { recursive: true })
  await writeFile(join(root, 'src', 'nested', '.gitignore'), 'secret.ts\n')
  await writeFile(join(root, 'src', 'nested', 'secret.ts'), 'secret')
  await writeFile(join(root, 'src', 'nested', 'visible.ts'), 'ok')
  return root
}

describe('WorkspaceFileSearch gitignore', () => {
  it('honors nested .gitignore inside a git tree', async () => {
    const root = await gitWorkspace()
    const files = new WorkspaceFileSearch(root, {
      maxResults: 20,
      maxEntries: 10_000,
      excludedDirectories: ['.git', 'node_modules'],
      respectGitignore: true,
    })
    searches.push(files)
    const signal = new AbortController().signal

    expect(await files.list('bundle', signal)).toEqual([])
    expect(await files.list('noise', signal)).toEqual([])
    expect(await files.list('keep', signal)).toEqual([{ path: 'keep.log', kind: 'file' }])
    expect(await files.list('secret', signal)).toEqual([])
    expect(await files.list('visible', signal)).toEqual([
      { path: 'src/nested/visible.ts', kind: 'file' },
    ])
    expect(await files.list('dist/', signal)).toEqual([])
    expect(await files.list('src/nested/', signal)).toEqual([
      { path: 'src/nested/visible.ts', kind: 'file' },
    ])
    expect(await files.list('README', signal)).toEqual([{ path: 'README.md', kind: 'file' }])
  })

  it('skips gitignore when respectGitignore is false', async () => {
    const root = await gitWorkspace()
    const files = new WorkspaceFileSearch(root, {
      maxResults: 20,
      maxEntries: 10_000,
      excludedDirectories: ['.git', 'node_modules'],
      respectGitignore: false,
    })
    searches.push(files)
    const signal = new AbortController().signal
    expect(await files.list('bundle', signal)).toEqual([
      { path: 'dist/bundle.js', kind: 'file' },
    ])
  })
})
