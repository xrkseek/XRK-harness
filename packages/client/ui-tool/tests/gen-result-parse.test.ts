import { describe, expect, it } from 'vitest'
import {
  parseImageGenResultText,
  parseVideoGenResultText,
} from '../src/client/tool/models/gen-result-parse.ts'
import { imageGenCardModel } from '../src/client/tool/models/image-gen-card-model.ts'
import { videoGenResultModel } from '../src/client/tool/models/video-gen-card-model.ts'
import type { ToolResultNode } from '@xrkseek/client-runtime/client'

describe('parseImageGenResultText', () => {
  it('strips image_base64 and collects attachmentIds', () => {
    const text = [
      'provider=openai delivery=inline modality=text images=2',
      '--- image 1 ---',
      'mime=image/png bytes=1200',
      'attachmentId=sha256:aaa',
      'image_base64=iVBORw0KGgo…(4000 chars)',
      '--- image 2 ---',
      'mime=image/jpeg bytes=800',
      'attachmentId=sha256:bbb',
      'image_base64=zzzz',
    ].join('\n')
    const parsed = parseImageGenResultText(text)
    expect(parsed.images).toEqual([
      { attachmentId: 'sha256:aaa', mime: 'image/png', bytes: 1200 },
      { attachmentId: 'sha256:bbb', mime: 'image/jpeg', bytes: 800 },
    ])
    expect(parsed.displayText).not.toContain('image_base64=')
    expect(parsed.displayText).toContain('attachmentId=sha256:aaa')
    expect(parsed.providerLine).toMatch(/^provider=/)
  })

  it('parses the host single-line packing mime=X bytes=N per image', () => {
    // Exact shape produced by packages/exec/image-gen/src/tools.ts:182.
    const text = [
      'provider=memory delivery=inline modality=text images=1',
      '--- image 1 ---',
      'mime=image/png bytes=4096',
      'attachmentId=sha256:ccc',
      'image_base64=iVBOR…(98 chars)',
    ].join('\n')
    const parsed = parseImageGenResultText(text)
    expect(parsed.images).toEqual([
      { attachmentId: 'sha256:ccc', mime: 'image/png', bytes: 4096 },
    ])
  })

  it('keeps spaced single-KV values intact (revised_prompt)', () => {
    const text = [
      'provider=openai delivery=inline modality=text images=1',
      '--- image 1 ---',
      'mime=image/png bytes=1200',
      'revised_prompt=a cat with a hat on a boat',
      'attachmentId=sha256:ddd',
      'image_base64=zzzz',
    ].join('\n')
    const parsed = parseImageGenResultText(text)
    expect(parsed.images).toEqual([
      { attachmentId: 'sha256:ddd', mime: 'image/png', bytes: 1200, revisedPrompt: 'a cat with a hat on a boat' },
    ])
  })
})

describe('parseVideoGenResultText', () => {
  it('builds status summary from job lines', () => {
    const text = [
      'jobId=job_1',
      'status=completed',
      'progress=100',
      'attachmentId=sha256:vid',
      'file=video_generate_job_1.mp4',
      'mime=video/mp4 bytes=2048',
    ].join('\n')
    const parsed = parseVideoGenResultText(text)
    expect(parsed.jobId).toBe('job_1')
    expect(parsed.status).toBe('completed')
    expect(parsed.attachmentId).toBe('sha256:vid')
    expect(parsed.file).toBe('video_generate_job_1.mp4')
    expect(parsed.statusSummary).toBe('completed · 100% · job_1 · video_generate_job_1.mp4')
  })
})

function settledImage(content: string): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'c1',
    call: { name: 'image_generate', argsRaw: JSON.stringify({ prompt: 'a cat' }) },
    callTime: 0,
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    content: [{ type: 'text', text: content }],
  }
}

describe('imageGenCardModel', () => {
  it('builds gallery stubs from attachmentId lines', () => {
    const model = imageGenCardModel(settledImage([
      'provider=memory delivery=inline images=1',
      '--- image 1 ---',
      'mime=image/png bytes=42',
      'attachmentId=sha256:abc',
      'image_base64=AAAA',
    ].join('\n')))
    expect(model?.label).toBe('1 image')
    expect(model?.images).toHaveLength(1)
    expect(model?.images[0]?.attachment.attachmentId).toBe('sha256:abc')
    expect(model?.text).not.toContain('image_base64=')
  })

  it('returns null without attachmentId', () => {
    expect(imageGenCardModel(settledImage('provider=memory images=0'))).toBeNull()
  })
})

describe('videoGenResultModel', () => {
  it('parses settled video_generate content', () => {
    const block: ToolResultNode = {
      kind: 'tool-result',
      seq: 2,
      time: 0,
      callId: 'c2',
      call: { name: 'video_generate', argsRaw: '{"action":"status","job_id":"j1"}' },
      callTime: 0,
      isError: false,
      callView: null,
      resultView: null,
      subCalls: [],
      content: [{ type: 'text', text: 'jobId=j1\nstatus=in_progress\nprogress=40' }],
    }
    expect(videoGenResultModel(block)?.statusSummary).toBe('in_progress · 40% · j1')
  })
})
