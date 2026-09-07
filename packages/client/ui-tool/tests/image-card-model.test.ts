import { describe, expect, it } from 'vitest'
import { imageCardModel } from '../src/client/tool/models/image-card-model.ts'
import { abbreviateHomePath, toolRowModel } from '../src/client/tool/models/tool-call-model.ts'
import type { ToolResultNode } from '@xrkseek/client-runtime/client'

function settled(partial: Partial<ToolResultNode> & Pick<ToolResultNode, 'content'>): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'c1',
    call: { name: 'read_image', argsRaw: JSON.stringify({ file_path: 'shots/ui.png' }) },
    callTime: 0,
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    meta: { path: 'shots/ui.png' },
    ...partial,
  }
}

const envelope = `<path>shots/ui.png</path>
<type>image</type>
<content>
image/png image, 10x10 px, 42 bytes
</content>`

const imageContent = [
  { type: 'text' as const, text: envelope },
  {
    type: 'image' as const,
    attachment: {
      attachmentId: 'sha256:abc' as never,
      mediaType: 'image/png' as const,
      bytes: 42,
      width: 10,
      height: 10,
      name: 'ui.png',
    },
  },
]

describe('abbreviateHomePath', () => {
  it('shortens POSIX home roots to ~', () => {
    expect(abbreviateHomePath('/home/u', '/home/u')).toBe('~')
    expect(abbreviateHomePath('/home/u/proj/a.png', '/home/u')).toBe('~/proj/a.png')
    expect(abbreviateHomePath('C:\\Users\\u\\a.png', 'C:\\Users\\u')).toBe('C:\\Users\\u\\a.png')
    expect(abbreviateHomePath('/other/a.png', '/home/u')).toBe('/other/a.png')
  })
})

describe('imageCardModel', () => {
  it('builds a gallery card from envelope + image block', () => {
    const model = imageCardModel(settled({ content: imageContent }), '/ws')
    expect(model).toEqual({
      label: 'shots/ui.png',
      text: envelope,
      images: [{
        attachment: {
          attachmentId: 'sha256:abc',
          mediaType: 'image/png',
          bytes: 42,
          width: 10,
          height: 10,
          name: 'ui.png',
        },
      }],
    })
  })

  it('abbreviates leftover home paths in the card label', () => {
    const model = imageCardModel(settled({
      content: imageContent,
      meta: { path: '/home/u/shots/ui.png' },
      call: { name: 'read_image', argsRaw: JSON.stringify({ file_path: '/home/u/shots/ui.png' }) },
    }), undefined, '/home/u')
    expect(model?.label).toBe('~/shots/ui.png')
  })

  it('falls back to file_path when meta is absent', () => {
    const model = imageCardModel(settled({
      content: imageContent,
      meta: undefined,
    }))
    expect(model?.label).toBe('shots/ui.png')
  })

  it('declines running or error results', () => {
    expect(imageCardModel({
      callId: 'c1',
      name: 'read_image',
      argsRaw: '{"file_path":"a.png"}',
      turn: 1,
      step: 1,
      time: 0,
      callView: null,
      subCalls: [],
    })).toBeNull()
    expect(imageCardModel(settled({
      isError: true,
      content: [{ type: 'text', text: 'nope' }],
    }))).toBeNull()
  })
})

describe('toolRowModel read_image title', () => {
  it('uses the Read image title', () => {
    const model = toolRowModel('read_image', {
      callId: 'c1',
      name: 'read_image',
      argsRaw: '{"file_path":"a.png"}',
      turn: 1,
      step: 1,
      time: 0,
      callView: null,
      subCalls: [],
    })
    expect(model.title).toBe('Read image')
    expect(model.variant).toBe('read')
  })
})
