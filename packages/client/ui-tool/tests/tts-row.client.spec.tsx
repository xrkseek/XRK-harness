// @vitest-environment jsdom
// text_to_speech row: the pure TTS card model (durable file block vs truncated
// base64 preview) and the playback row it feeds — collapsed summary, expanded
// bar, honest "not playable" fallback, and the auto-play contract (one live
// clip, once per session + attachment, newest wins).

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { RunningToolCall, ToolResultNode } from '@xrkseek/client-runtime/client'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import { zh as commonZh } from '@xrkseek/client-locale/src/locales/zh.ts'
import { zh } from '@xrkseek/client-ui-conversation/src/client/locales.ts'
import { TtsRow, ttsToolview } from '../src/client/tool/toolviews/tts-row.tsx'
import {
  formatClipSummary, formatClipTime, ttsCardModel, voiceDisplayName,
} from '../src/client/tool/models/tts-card-model.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)

const ARGS = '{"text":"今天天气不错，适合出门走走。","voice":"zh-CN-XiaoxiaoNeural"}'

/**
 * Envelope shape the Host writes next to the durable file block: several
 * `key=value` tokens on the first line, then the storage facts on their own.
 */
const ENVELOPE = [
  'provider=edge delivery=edge mime=audio/mpeg voice=zh-CN-XiaoxiaoNeural',
  'bytes=42800 name=tts-1.mp3 attachmentId=sha256:abc123',
].join('\n')

/** The pre-store shape: a truncated preview, nothing playable. */
const TRUNCATED = [
  'provider=edge delivery=edge mime=audio/mpeg voice=zh-CN-XiaoxiaoNeural',
  'audio_base64=SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4…(1132 chars)',
  '(full base64 omitted — no attachment store on this Host, so the audio cannot be played)',
].join('\n')

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'text_to_speech', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, callView: null, subCalls: [], ...over,
})

const settled = (content: ToolResultNode['content'], over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'text_to_speech', argsRaw: ARGS },
  callTime: 1_000,
  content, isError: false, callView: null, resultView: null, subCalls: [], ...over,
})

/** Durable result: envelope text plus the stored clip. */
const settledClip = (attachmentId = 'sha256:abc123', over?: Partial<ToolResultNode>): ToolResultNode => settled([
  { type: 'text', text: ENVELOPE.replace('sha256:abc123', attachmentId) },
  {
    type: 'file',
    attachment: {
      attachmentId,
      name: 'tts-1.mp3',
      bytes: 42800,
      mediaType: 'audio/mpeg',
    },
  },
], over)

type RowProps = Parameters<typeof TtsRow>[0]

const rowProps = (
  block: RunningToolCall | ToolResultNode,
  loadAttachment = vi.fn(async () => 'blob:tts-1'),
  sessionId = 's1',
): RowProps => ({
  callId: block.callId,
  toolName: 'text_to_speech',
  block,
  openFile: vi.fn(),
  loadAttachment,
  sessionId,
  t,
  // The standard kit (useSession/useProjection) is unused by this row; the
  // cast supplies the owner slice plus the locale seat, as sibling suites do.
} as unknown as RowProps)

let play: MockInstance<() => Promise<void>>
let pause: MockInstance<() => void>

beforeEach(() => {
  // jsdom has no media stack: the row's contract is "call play once", not
  // "decode audio", so the element methods are the seam under test.
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tts-card-model', () => {
  it('prefers the durable file block and reads the envelope facts', () => {
    const model = ttsCardModel(settledClip())
    expect(model?.attachment).toEqual({
      attachmentId: 'sha256:abc123', name: 'tts-1.mp3', bytes: 42800, mediaType: 'audio/mpeg',
    })
    expect(model?.provider).toBe('edge')
    expect(model?.voice).toBe('zh-CN-XiaoxiaoNeural')
    expect(model?.mime).toBe('audio/mpeg')
    expect(model?.truncated).toBe(false)
    // Ids and base64 never reach the visible meta line.
    expect(model?.meta).not.toContain('sha256:')
    expect(model?.meta).toContain('edge')
  })

  it('falls back to the envelope attachment id when the file block is absent', () => {
    const model = ttsCardModel(settled([{ type: 'text', text: ENVELOPE }]))
    expect(model?.attachment?.attachmentId).toBe('sha256:abc123')
    expect(model?.attachment?.mediaType).toBe('audio/mpeg')
    expect(model?.truncated).toBe(false)
  })

  it('reads the voice from the call args when the envelope does not echo it', () => {
    const model = ttsCardModel(settled([
      { type: 'text', text: 'provider=edge delivery=edge mime=audio/mpeg' },
    ]))
    expect(model?.voice).toBe('zh-CN-XiaoxiaoNeural')
    expect(model?.attachment).toBeNull()
    expect(model?.truncated).toBe(false)
  })

  it('marks a truncated base64 preview as unplayable', () => {
    const model = ttsCardModel(settled([{ type: 'text', text: TRUNCATED }]))
    expect(model?.attachment).toBeNull()
    expect(model?.truncated).toBe(true)
    // The preview itself is never part of the model surface.
    expect(JSON.stringify(model)).not.toContain('SUQzBAAAAAAAI1RTU0U')
  })

  it('ignores running, failed, and foreign tool calls', () => {
    expect(ttsCardModel(running())).toBeNull()
    expect(ttsCardModel(settledClip('sha256:abc123', { isError: true }))).toBeNull()
    expect(ttsCardModel(settledClip('sha256:abc123', {
      call: { name: 'web_search', argsRaw: '{}' },
    }))).toBeNull()
  })

  it('formats the voice and the clip length for the summary', () => {
    expect(voiceDisplayName('zh-CN-XiaoxiaoNeural')).toBe('晓晓')
    expect(voiceDisplayName('zh-CN-liaoning-XiaobeiNeural')).toBe('晓北')
    expect(voiceDisplayName('en-US-AriaNeural')).toBe('Aria')
    expect(voiceDisplayName(null)).toBeNull()
    expect(formatClipSummary(7.34)).toBe('7.3s')
    expect(formatClipSummary(7)).toBe('7s')
    expect(formatClipSummary(67)).toBe('1:07')
    expect(formatClipSummary(0)).toBe('0s')
    expect(formatClipTime(7.9)).toBe('0:07')
    expect(formatClipTime(3601)).toBe('60:01')
  })
})

describe('tts row', () => {
  it('keeps the playback bar visible (forceExpanded) with voice summary', async () => {
    const view = render(<TtsRow {...rowProps(settledClip())} />)
    // Summary names the voice, never the base64 / attachment id.
    expect(view.container.textContent).toContain('晓晓')
    expect(view.container.textContent).not.toContain('sha256:')

    // Loaded clip: the audio element gets the session-authorized URL.
    await waitFor(() => {
      expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('blob:tts-1')
    })

    // Spoken clips stay expanded — no disclosure gate before play.
    expect(view.container.querySelector('[data-tts-player]')).not.toBeNull()
    expect(view.getByLabelText('播放')).toBeTruthy()
    expect(view.getByLabelText('下载音频')).toBeTruthy()
    // Envelope facts stay as a muted caption under the bar.
    expect(view.getByText(/edge · audio\/mpeg/)).toBeTruthy()
  })

  it('degrades to an honest line when the Host stored no audio', () => {
    const view = render(<TtsRow {...rowProps(settled([{ type: 'text', text: TRUNCATED }]))} />)
    expect(view.container.textContent).toContain('音频未落地')
    expect(view.getByText('音频未落地：Host 没有附件存储，聊天里无法播放')).toBeTruthy()
    expect(view.container.querySelector('[data-tts-player]')).toBeNull()
  })

  it('says so when a settled call produced no audio at all', () => {
    const view = render(<TtsRow {...rowProps(settled([{ type: 'text', text: 'provider=edge' }]))} />)
    expect(view.getByText('没有可播放的音频')).toBeTruthy()
  })

  it('auto-plays a live arrival once, and never replays the same clip', async () => {
    const load = vi.fn(async () => 'blob:tts-live')
    const view = render(<TtsRow {...rowProps(running(), load)} />)
    expect(play).not.toHaveBeenCalled()

    view.rerender(<TtsRow {...rowProps(settledClip(), load)} />)
    await waitFor(() => { expect(play).toHaveBeenCalledTimes(1) })

    // Leaving and re-entering the session remounts the row; the module-level
    // key set is what keeps the clip from speaking again.
    view.unmount()
    const again = render(<TtsRow {...rowProps(running(), load)} />)
    again.rerender(<TtsRow {...rowProps(settledClip(), load)} />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('does not speak a clip that was already settled on first mount', async () => {
    // History replay: the transcript loads older rows with their audio already
    // stored. Those must stay silent until the reader presses play.
    const load = vi.fn(async () => 'blob:tts-history')
    const view = render(<TtsRow {...rowProps(settledClip('sha256:def456'), load)} />)
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(play).not.toHaveBeenCalled()
  })

  it('shows the autoplay-blocked hint when play() rejects', async () => {
    play.mockRejectedValueOnce(new DOMException('NotAllowedError'))
    const view = render(<TtsRow {...rowProps(settledClip('sha256:blocked1'))} />)
    await waitFor(() => {
      expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('blob:tts-1')
    })
    fireEvent.click(view.getByLabelText('播放'))
    await waitFor(() => {
      expect(view.getByText('浏览器拦截了自动播放，点播放即可')).toBeTruthy()
    })
  })

  it('stops the previous clip when a newer one arrives in the same session', async () => {
    const first = render(<TtsRow {...rowProps(running(), vi.fn(async () => 'blob:tts-a'), 's2')} />)
    first.rerender(<TtsRow {...rowProps(settledClip('sha256:aaa111'), vi.fn(async () => 'blob:tts-a'), 's2')} />)
    await waitFor(() => { expect(play).toHaveBeenCalledTimes(1) })

    const second = render(<TtsRow {...rowProps(running(), vi.fn(async () => 'blob:tts-b'), 's2')} />)
    second.rerender(<TtsRow {...rowProps(settledClip('sha256:bbb222'), vi.fn(async () => 'blob:tts-b'), 's2')} />)
    await waitFor(() => { expect(play).toHaveBeenCalledTimes(2) })
    // The first element is paused (not merely abandoned) when the newer clip
    // starts, so two synthesized replies can never talk over each other.
    expect(pause).toHaveBeenCalled()
  })
})

describe('tts toolview registration', () => {
  it('claims text_to_speech on the keyed toolview slot with the conversation locale', () => {
    const registered: { name: string; key?: string; locale?: string; component?: unknown }[] = []
    const ctx = {
      slots: {
        inject: (_name: string, fn: () => void) => fn(),
        register: (options: { name: string; key?: string; locale?: string }, component: unknown) => {
          registered.push({ ...options, component })
          return () => {}
        },
      },
    } as unknown as import('@xrkseek/cordis').Context
    ttsToolview.apply(ctx)
    expect(registered).toHaveLength(1)
    expect(registered[0]?.key).toBe('text_to_speech')
    expect(registered[0]?.locale).toBe('conversation')
    expect(registered[0]?.component).toBe(TtsRow)
    expect(ttsToolview.inject).toEqual(['slots'])
  })
})
