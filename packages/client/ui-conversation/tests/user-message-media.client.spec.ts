import { describe, expect, it } from 'vitest'
import {
  clipboardTextForUserMessage,
  durableAttachmentsIn,
  promptPartsFromDurableAttachments,
  userMessageHasMedia,
  userMessageText,
} from '../src/client/chat/user-message-media.ts'

const file = {
  type: 'file' as const,
  attachment: {
    attachmentId: 'sha256:deadbeef',
    name: '第七章实验报告封面.docx',
    bytes: 12_288,
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
}

describe('user-message-media', () => {
  it('keeps reader text and durable media for edit/copy', () => {
    const content = [
      { type: 'text', text: '人工智能作业都加上封面，你看看', modelOnly: true },
      { type: 'text', text: '人工智能作业都加上封面，你看看' },
      file,
    ]
    expect(userMessageText(content)).toBe('人工智能作业都加上封面，你看看')
    expect(userMessageHasMedia(content)).toBe(true)
    expect(durableAttachmentsIn(content)).toEqual([{ kind: 'file', attachment: file.attachment }])
    expect(clipboardTextForUserMessage(content)).toBe(
      '人工智能作业都加上封面，你看看\n[文件附件 第七章实验报告封面.docx]',
    )
    expect(promptPartsFromDurableAttachments(durableAttachmentsIn(content))).toEqual([
      { type: 'file', attachmentId: 'sha256:deadbeef' },
    ])
  })

  it('skips modelOnly handle captions in clipboard text', () => {
    const content = [
      { type: 'text', text: '[文件附件 cover.docx（sha256:abc）]', modelOnly: true },
      file,
    ]
    expect(clipboardTextForUserMessage(content)).toBe('[文件附件 第七章实验报告封面.docx]')
  })

  it('joins multiple prose blocks with a newline for edit seed', () => {
    expect(
      userMessageText([
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ]),
    ).toBe('第一段\n第二段')
  })

  it('carries image display name into regenerate prompt parts', () => {
    const image = {
      type: 'image' as const,
      attachment: {
        attachmentId: 'sha256:abcd',
        name: 'xrk-e2e-sample2.png',
        bytes: 64,
        mediaType: 'image/png',
        width: 1,
        height: 1,
      },
    }
    expect(promptPartsFromDurableAttachments(durableAttachmentsIn([image]))).toEqual([
      { type: 'image', attachmentId: 'sha256:abcd', name: 'xrk-e2e-sample2.png' },
    ])
  })
})
