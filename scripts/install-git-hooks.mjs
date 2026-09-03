#!/usr/bin/env node
/**
 * Install local git hooks (not versioned under .git/hooks).
 * English. / 为本机 clone 安装 git hook。
 */
import { chmodSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const stripScript = join(scriptDir, 'git-hooks', 'strip-cursor-coauthor.mjs').replace(/\\/g, '/')
const hookPath = join(root, '.git', 'hooks', 'prepare-commit-msg')

const hook = `#!/bin/sh
exec node "${stripScript}" "$1"
`

writeFileSync(hookPath, hook, 'utf8')
chmodSync(hookPath, 0o755)
console.log(`Installed ${hookPath}`)
