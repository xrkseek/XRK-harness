/**
 * Kernel boot-hint copy: progressive plugin counts + Host/Face phase labels (zh/en).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOOT_HOST_TIP_INTERVAL_MS,
  bootConnectionHint,
  bootFailedTitle,
  bootHostPhaseHint,
  bootPluginHint,
  bootSessionsHint,
  resolveBootLang,
} from '../src/boot-hints.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveBootLang', () => {
  it('prefers product Settings over Desktop and navigator', () => {
    expect(resolveBootLang({
      productLocaleId: 'zh',
      desktopLocaleId: 'en',
      navigatorLanguages: ['en-US'],
    })).toBe('zh')
    expect(resolveBootLang({
      productLocaleId: 'en',
      desktopLocaleId: 'zh-CN',
    })).toBe('en')
  })

  it('falls back through Desktop then navigator', () => {
    expect(resolveBootLang({ desktopLocaleId: 'zh-CN' })).toBe('zh')
    expect(resolveBootLang({ navigatorLanguages: ['zh-Hans-CN', 'en'] })).toBe('zh')
    expect(resolveBootLang({ navigatorLanguages: ['fr-FR'] })).toBe('en')
  })
})

describe('bootPluginHint', () => {
  it('starts with the bare plugin tier label', () => {
    expect(bootPluginHint({})).toBe('Summoning plugins…')
    expect(bootPluginHint({}, 'zh')).toBe('正在召唤插件…')
  })

  it('counts active and failed against the projected entry total', () => {
    expect(bootPluginHint({
      a: 'active',
      b: 'loading',
      c: 'failed',
      d: 'pending',
    })).toBe('Summoning plugins… 2/4')
    expect(bootPluginHint({
      a: 'active',
      b: 'loading',
    }, 'zh')).toBe('正在召唤插件… 1/2')
  })
})

describe('bootHostPhaseHint', () => {
  it('matches Desktop IPC wire phases only', () => {
    expect(bootHostPhaseHint(undefined)).toBe('Waking Host…')
    expect(bootHostPhaseHint('attaching')).toBe('Tucking Host into the shell…')
    expect(bootHostPhaseHint('ready')).toBe('Knocking on Face…')
    expect(bootHostPhaseHint('starting', 'zh')).toBe('正在唤醒 Host…')
    expect(bootHostPhaseHint('attaching', 'zh')).toBe('正在把 Host 塞进壳里…')
    expect(bootHostPhaseHint('ready', 'zh')).toBe('正在敲 Face 的门…')
  })

  it('rotates tips by elapsed time inside the same wire phase', () => {
    expect(bootHostPhaseHint('attaching', 'en', {
      elapsedMs: BOOT_HOST_TIP_INTERVAL_MS,
    })).toBe('Threading the IPC pipes…')
    expect(bootHostPhaseHint('attaching', 'en', {
      elapsedMs: BOOT_HOST_TIP_INTERVAL_MS * 2,
    })).toBe('Host is assembling the stack…')
    expect(bootHostPhaseHint('attaching', 'zh', {
      elapsedMs: BOOT_HOST_TIP_INTERVAL_MS,
    })).toBe('正在打通 IPC 管道…')
    expect(bootHostPhaseHint('attaching', 'zh', {
      elapsedMs: BOOT_HOST_TIP_INTERVAL_MS * 6,
    })).toBe('还在炖着，马上出锅…')
  })
})

describe('bootConnectionHint', () => {
  it('maps handshake phases to splash copy', () => {
    expect(bootConnectionHint(undefined)).toBe('Knocking on Face…')
    expect(bootConnectionHint('handshake:host')).toBe('Waking Host…')
    expect(bootConnectionHint('handshake:describe')).toBe('Asking Host who it is…')
    expect(bootConnectionHint('handshake:streams')).toBe('Opening the event firehose…')
    expect(bootConnectionHint('retry:backoff')).toBe('Taking a breath, then retry…')
    expect(bootConnectionHint('retry:halted')).toMatch(/Host stopped/)
  })

  it('mirrors Chinese connection phases', () => {
    expect(bootConnectionHint('handshake:describe', { lang: 'zh' })).toBe('正在问 Host 你是谁…')
    expect(bootConnectionHint('handshake:streams', { lang: 'zh' })).toBe('正在打开事件流…')
    expect(bootConnectionHint('retry:halted', { lang: 'zh' })).toMatch(/Host 已停/)
    expect(bootSessionsHint('zh')).toBe('正在排队你的会话…')
    expect(bootFailedTitle('zh')).toBe('插件加载失败')
  })

  it('never says Starting Host after Fetch is attached', () => {
    expect(bootConnectionHint('handshake:host', { hostAttached: true })).toBe('Knocking on Face…')
    expect(bootConnectionHint('handshake:host', { hostAttached: true, lang: 'zh' })).toBe('正在敲 Face 的门…')
  })
})
