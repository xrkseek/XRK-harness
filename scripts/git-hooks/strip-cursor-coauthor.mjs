#!/usr/bin/env node
/**
 * prepare-commit-msg helper: drop Cursor agent co-author trailers.
 * English. / 从 commit message 去掉 Cursor co-author 行。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) process.exit(0)

const original = readFileSync(file, 'utf8')
const cleaned = original
  .split(/\r?\n/)
  .filter((line) => !/cursoragent@cursor\.com/i.test(line))
  .join('\n')

if (cleaned !== original) {
  const out = cleaned.endsWith('\n') || cleaned.length === 0 ? cleaned : `${cleaned}\n`
  writeFileSync(file, out)
}
