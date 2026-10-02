// @vitest-environment jsdom
/**
 * QueueDock rendering and operations: authoritative rows, inline editing,
 * collapse state, removal, strict steering, failure notices, and live retirement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@xrkseek/client-runtime/client'
import type {
  ConversationSnapshot, PendingSubmission, QueuedMessage, SessionId, SessionListState,
} from '@xrkseek/client-runtime/client'
import type { SnapshotSelectorHook } from '@xrkseek/client-ui-slots'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import { zh as commonZh } from '@xrkseek/client-locale/src/locales/zh.ts'
import type { QueueItemId } from '../src/client/contract/queue.ts'
import type { InputState } from '../src/client/input/contract.ts'
import { zh } from '../src/client/locales.ts'
import { QueueDock, queueDockEntry, type QueueDockInjected, type QueueDockProps } from '../src/client/queue/QueueDock.tsx'

afterEach(cleanup)

const SID = 's1' as SessionId
const iid = (id: string): QueueItemId => id as QueueItemId

function row(id: string, text: string, preview = text, rpcId?: string, content?: QueuedMessage['content']): QueuedMessage {
  return {
    id: iid(id), messageId: `message-${id}` as never, placement: 'queued',
    content: content ?? [{ type: 'text', text }],
    preview, text,
    ...(rpcId === undefined ? {} : { rpcId: rpcId as never }),
  }
}

function snapshotWith(
  queue: QueuedMessage[],
  pendingSubmissions: readonly PendingSubmission[] = [],
): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], pendingSubmissions, queue, running: true, composerPhase: 'active', removed: false, openState: 'open', openError: null,
    hasMore: false, loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

/** Minimal live source backing the useSession stub. */
function liveSession(initial: ConversationSnapshot) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const useSession: SnapshotSelectorHook<ConversationSnapshot> = selector =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => selector(snapshot),
    )
  return {
    useSession,
    push(next: ConversationSnapshot): void {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** InputZone owner stub (the dock reads useSession only; the zone fields satisfy the owner share). */
const INPUT_STATE: InputState = { draft: '', imageIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [] }

// Standard locale seat stub mirroring the real ns → common → key chain.
const t: QueueDockProps['t'] = makeTranslate(zh, commonZh)

function kitFor(snapshot: ConversationSnapshot, injected: Partial<QueueDockInjected> = {}) {
  return {
    sessionId: SID,
    t,
    useSessions: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<SessionListState>,
    useWorkspaces: (() => { throw new Error('unused') }) as never,
    useConnectionState: (() => undefined) as never,
    useProjection: (() => undefined) as never,
    useInput: (() => { throw new Error('unused') }) as never,
    inputActions: { setDraft: () => {}, submit: () => {} } as never,
    session: snapshot,
    input: INPUT_STATE,
    updateQueue: vi.fn(() => Promise.resolve('ok' as const)),
    notify: vi.fn(),
    loadImage: vi.fn(() => Promise.resolve('blob:queue-thumb')),
    ...injected,
  }
}

describe('QueueDock', () => {
  it('renders null while the queue is empty', () => {
    const snap = snapshotWith([])
    const source = liveSession(snap)
    const { container } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows pre-admit queued echoes as 发送中 until Host admits', () => {
    const pending: PendingSubmission = {
      requestId: 'req-local-queue' as never,
      placement: 'queued',
      time: 1,
      text: '等待上传',
      attachments: [
        {
          type: 'image',
          value: { previewUrl: 'blob:queue-preview', name: 'queue.png' },
        },
        {
          type: 'file',
          value: {
            attachmentId: 'file-local' as never,
            name: 'notes.txt',
            bytes: 2447 * 1024 * 1024,
          },
        },
      ],
    }
    const snap = snapshotWith([], [pending])
    const source = liveSession(snap)
    const props = kitFor(snap)
    const view = render(<QueueDock {...props} useSession={source.useSession} />)
    expect(view.getByText('等待上传')).toBeTruthy()
    expect(view.getByText('发送中…')).toBeTruthy()
    expect(view.container.querySelector('[data-submission-echo]')).not.toBeNull()
    for (const name of ['编辑排队消息', '删除排队消息', '立即插队']) {
      expect((view.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }

    act(() => {
      source.push(snapshotWith(
        [row('accepted', '等待上传', '等待上传', 'req-local-queue')],
        [pending],
      ))
    })
    expect(view.getAllByText('等待上传')).toHaveLength(1)
    expect(view.container.querySelector('[data-submission-echo]')).toBeNull()
    for (const name of ['编辑排队消息', '删除排队消息', '立即插队']) {
      expect((view.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false)
    }
    fireEvent.click(view.getByRole('button', { name: '编辑排队消息' }))
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('等待上传')
  })

  it.each(['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'])(
    'keeps Host-admitted queue rows through FIFO claims (%s)',
    (hostOrder) => {
      const pending: PendingSubmission[] = ['A', 'B', 'C'].map(id => ({
        requestId: id as never, placement: 'queued', time: 1_000,
        text: `input ${id}`, attachments: [],
      }))
      const initial = snapshotWith(
        pending.map(p => row(p.requestId as string, p.text, p.text, p.requestId as string)),
        pending,
      )
      const source = liveSession(initial)
      const view = render(<QueueDock {...kitFor(initial)} useSession={source.useSession} />)
      fireEvent.click(view.getByRole('button', { name: /3 条排队消息/ }))
      const order = (): string[] => [...view.container.querySelectorAll('[data-queue-dock] li')]
        .map(element => pending.find(input => element.textContent?.includes(input.text))!.requestId as string)
      expect(order()).toEqual(['A', 'B', 'C'])
      const queued = hostOrder.split('').map(id => {
        const submission = pending.find(input => input.requestId === id)!
        return row(id, submission.text, submission.text, id)
      })
      for (let claimed = 1; claimed <= queued.length; claimed++) {
        act(() => {
          source.push(snapshotWith(
            queued.slice(claimed),
            pending.filter(p => queued.slice(claimed).some(row => row.rpcId === p.requestId)),
          ))
        })
        expect(order()).toEqual(hostOrder.slice(claimed).split(''))
      }
      expect(view.container.querySelector('[data-queue-dock]')).toBeNull()
    },
  )

  it('counts pre-admit local submissions in the queue strip', () => {
    const snap = snapshotWith(
      [row('accepted', '已排队')],
      [{
        requestId: 'req-waiting' as never, placement: 'queued', time: 1,
        text: '等待发送', attachments: [],
      }],
    )
    const source = liveSession(snap)
    const view = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    const header = view.getByRole('button', { name: /2 条排队消息/ })
    expect(header).toBeTruthy()
    fireEvent.click(header)
    expect(view.getByText('已排队')).toBeTruthy()
    expect(view.getByText('等待发送')).toBeTruthy()
    expect(view.getByText('发送中…')).toBeTruthy()
  })

  it('hides the dock after Host removes an admitted row without resurfacing echoes', () => {
    const pending: PendingSubmission = {
      requestId: 'req-drop' as never, placement: 'queued', time: 1,
      text: '哈哈', attachments: [],
    }
    const admitted = snapshotWith(
      [row('qi-1', '哈哈', '哈哈', 'req-drop')],
      [pending],
    )
    const source = liveSession(admitted)
    const props = kitFor(admitted)
    const view = render(<QueueDock {...props} useSession={source.useSession} />)
    expect(view.getByText('哈哈')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '删除排队消息' }))
    expect(props.updateQueue).toHaveBeenCalledWith('qi-1', { kind: 'remove' })
    act(() => { source.push(snapshotWith([], [])) })
    expect(view.container.querySelector('[data-queue-dock]')).toBeNull()
  })

  it('leaves pending steering to the conversation flow', () => {
    const steering = { ...row('s-1', 'interrupt'), placement: 'steering' as const }
    const snap = snapshotWith([steering])
    const source = liveSession(snap)
    const { container } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders one row with a title header and defaults multiple rows to a collapsible count header', () => {
    const single = snapshotWith([row('i-1', 'one')])
    const source = liveSession(single)
    const view = render(<QueueDock {...kitFor(single)} useSession={source.useSession} />)
    const singleHeader = view.getByRole('button', { name: /1 条排队消息/ })
    expect(singleHeader).toHaveProperty('disabled', true)
    expect(singleHeader.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('排队')).toBeTruthy()
    expect(view.getByText('one')).toBeTruthy()

    act(() => { source.push(snapshotWith([row('i-1', 'one'), row('i-2', 'two')])) })
    const header = view.getByRole('button', { name: /2 条排队消息/ })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(header).toHaveProperty('disabled', false)
    expect(document.getElementById(header.getAttribute('aria-controls')!)).toBeTruthy()
    expect(view.queryByText('one')).toBeNull()
    expect(view.queryByText('two')).toBeNull()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('one')).toBeTruthy()
    expect(view.getByText('two')).toBeTruthy()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('one')).toBeNull()
  })

  it('keeps an active single-row editor visible when another item arrives', () => {
    const single = snapshotWith([row('i-edit', 'before')])
    const source = liveSession(single)
    const view = render(<QueueDock {...kitFor(single)} useSession={source.useSession} />)

    fireEvent.click(view.getByLabelText('编辑排队消息'))
    fireEvent.change(view.getByLabelText('编辑排队消息'), { target: { value: 'draft' } })
    act(() => {
      source.push(snapshotWith([row('i-edit', 'before'), row('i-2', 'second')]))
    })

    const header = view.getByRole('button', { name: /2 条排队消息/ })
    expect(header).toHaveProperty('disabled', true)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByRole('textbox', { name: '编辑排队消息' })).toHaveProperty('value', 'draft')
    expect(view.getByText('second')).toBeTruthy()

    fireEvent.click(view.getByLabelText('取消编辑'))
    expect(header).toHaveProperty('disabled', false)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('second')).toBeNull()
  })

  it('keeps an in-flight row action visible when another item arrives', async () => {
    const single = snapshotWith([row('i-remove', 'remove me')])
    const source = liveSession(single)
    let finishUpdate: (() => void) | undefined
    const updateQueue = vi.fn(() => new Promise<void>((resolve) => { finishUpdate = resolve }))
    const view = render(
      <QueueDock {...kitFor(single, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(view.getByLabelText('删除排队消息'))
    act(() => {
      source.push(snapshotWith([row('i-remove', 'remove me'), row('i-2', 'second')]))
    })

    const header = view.getByRole('button', { name: /2 条排队消息/ })
    expect(header).toHaveProperty('disabled', true)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('remove me')).toBeTruthy()
    expect(view.getByText('second')).toBeTruthy()

    expect(updateQueue).toHaveBeenCalledOnce()
    await act(async () => {
      finishUpdate?.()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(header).toHaveProperty('disabled', false)
      expect(header.getAttribute('aria-expanded')).toBe('false')
    })
  })

  it('defaults a new multi-row queue to collapsed after the prior queue empties', () => {
    const first = snapshotWith([row('i-1', 'one'), row('i-2', 'two')])
    const source = liveSession(first)
    const view = render(<QueueDock {...kitFor(first)} useSession={source.useSession} />)
    fireEvent.click(view.getByRole('button', { name: /2 条排队消息/ }))
    expect(view.getByText('one')).toBeTruthy()

    act(() => { source.push(snapshotWith([])) })
    expect(view.container.innerHTML).toBe('')
    act(() => {
      source.push(snapshotWith([row('i-3', 'three'), row('i-4', 'four')]))
    })

    const header = view.getByRole('button', { name: /2 条排队消息/ })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('three')).toBeNull()
  })

  it('renders active actions and allows editing image rows (attach on edit)', () => {
    const snap = snapshotWith([
      row('i-1', '第一条排队消息'),
      row('i-2', '', 'image [image]', undefined, [{ type: 'image', attachment: { attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } } as never]),
    ])
    const source = liveSession(snap)
    const { container, getByRole } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    fireEvent.click(getByRole('button', { name: /2 条排队消息/ }))
    expect([...container.querySelectorAll('li')].map(item => item.textContent))
      .toEqual(['第一条排队消息', 'image [image]'])
    expect(container.querySelectorAll('button')).toHaveLength(7)
    expect(container.querySelectorAll('[aria-label="编辑排队消息"]')).toHaveLength(2)
    expect(container.querySelectorAll('[aria-label="删除排队消息"]')).toHaveLength(2)
    expect(container.querySelectorAll('[aria-label="立即插队"]')).toHaveLength(2)
    expect((container.querySelectorAll('[aria-label="编辑排队消息"]')[0] as HTMLButtonElement).disabled).toBe(false)
    expect((container.querySelectorAll('[aria-label="编辑排队消息"]')[1] as HTMLButtonElement).disabled).toBe(false)
  })

  it('edits text inline with save and cancel controls, then saves with the same item identity', async () => {
    const snap = snapshotWith([row('i-edit', 'before')])
    const source = liveSession(snap)
    const updateQueue = vi.fn(() => Promise.resolve())
    const { getByLabelText, queryByLabelText } = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('编辑排队消息'))
    const editor = getByLabelText('编辑排队消息') as HTMLInputElement
    expect(getByLabelText('保存排队消息')).toBeTruthy()
    expect(getByLabelText('取消编辑')).toBeTruthy()
    expect(queryByLabelText('删除排队消息')).toBeNull()
    fireEvent.change(editor, { target: { value: 'after' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-edit'), {
        kind: 'edit',
        content: [{ type: 'text', text: 'after' }],
      })
    })
  })

  it('cancels an edit by button or Escape without mutating the queue', () => {
    const snap = snapshotWith([row('i-edit', 'before')])
    const source = liveSession(snap)
    const updateQueue = vi.fn(() => Promise.resolve())
    const { getByLabelText, getByText } = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('编辑排队消息'))
    fireEvent.change(getByLabelText('编辑排队消息'), { target: { value: 'abandoned' } })
    fireEvent.click(getByLabelText('取消编辑'))
    expect(getByText('before')).toBeTruthy()

    fireEvent.click(getByLabelText('编辑排队消息'))
    fireEvent.keyDown(getByLabelText('编辑排队消息'), { key: 'Escape' })
    expect(getByText('before')).toBeTruthy()
    expect(updateQueue).not.toHaveBeenCalled()
  })

  it('keeps editing during IME composition and disables a blank save', () => {
    const snap = snapshotWith([row('i-edit', 'before')])
    const source = liveSession(snap)
    const updateQueue = vi.fn(() => Promise.resolve())
    const { getByLabelText } = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('编辑排队消息'))
    const editor = getByLabelText('编辑排队消息')
    fireEvent.change(editor, { target: { value: '   ' } })
    expect(getByLabelText('保存排队消息')).toHaveProperty('disabled', true)
    fireEvent.change(editor, { target: { value: '输入中' } })
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(updateQueue).not.toHaveBeenCalled()
    expect(getByLabelText('编辑排队消息')).toBeTruthy()
  })

  it('removes the addressed row', async () => {
    const snap = snapshotWith([row('i-1', 'one'), row('i-2', 'two')])
    const source = liveSession(snap)
    const updateQueue = vi.fn(() => Promise.resolve())
    const { getAllByLabelText, getByRole } = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(getByRole('button', { name: /2 条排队消息/ }))
    fireEvent.click(getAllByLabelText('删除排队消息')[0]!)
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-1'), { kind: 'remove' })
    })
  })

  it('strictly steers complete row content only while the agent is running', async () => {
    const running = snapshotWith([row('i-steer', '', 'image [image]', undefined, [{ type: 'image', attachment: { attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } } as never])])
    const source = liveSession(running)
    const updateQueue = vi.fn(() => Promise.resolve('ok' as const))
    const rendered = render(
      <QueueDock {...kitFor(running, { updateQueue })} useSession={source.useSession} />,
    )

    const button = rendered.getByLabelText('立即插队')
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-steer'), { kind: 'steer' })
    })

    act(() => { source.push({ ...running, running: false }) })
    expect(rendered.getByLabelText('立即插队')).toHaveProperty('disabled', true)
    expect(rendered.getByLabelText('立即插队').getAttribute('title')).toBe('仅运行中可插队')
  })

  it('steers a focused queue row on Enter', async () => {
    const snap = snapshotWith([row('i-enter', 'steer via keyboard')])
    const source = liveSession(snap)
    const updateQueue = vi.fn(() => Promise.resolve('ok' as const))
    const { getByText } = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={source.useSession} />,
    )

    const rowEl = getByText('steer via keyboard').closest('li')!
    rowEl.focus()
    fireEvent.keyDown(rowEl, { key: 'Enter' })
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-enter'), { kind: 'steer' })
    })
  })

  it('renders ordinary queue actions for a continuable child', () => {
    const snap = {
      ...snapshotWith([row('i-subagent', 'pending child follow-up')]),
      subagent: {
        address: {
          parentSessionId: 'parent' as SessionId,
          childSessionId: SID,
          mode: 'continuable' as const,
        },
        parentAvailable: false,
      },
    }
    const source = liveSession(snap)
    const view = render(
      <QueueDock {...kitFor(snap)} useSession={source.useSession} />,
    )

    expect(view.getByText('pending child follow-up')).toBeTruthy()
    expect(view.getByLabelText('编辑排队消息')).toBeTruthy()
    expect(view.getByLabelText('删除排队消息')).toBeTruthy()
    expect(view.getByLabelText('立即插队')).toBeTruthy()
  })

  it('keeps a one-shot child Queue read-only', () => {
    const snap = {
      ...snapshotWith([row('i-subagent', 'pending child follow-up')]),
      subagent: {
        address: {
          parentSessionId: 'parent' as SessionId,
          childSessionId: SID,
          mode: 'one-shot' as const,
        },
        parentAvailable: true,
      },
    }
    const source = liveSession(snap)
    const view = render(
      <QueueDock {...kitFor(snap)} useSession={source.useSession} />,
    )

    expect(view.getByText('pending child follow-up')).toBeTruthy()
    expect(view.queryByLabelText('编辑排队消息')).toBeNull()
    expect(view.queryByLabelText('删除排队消息')).toBeNull()
    expect(view.queryByLabelText('立即插队')).toBeNull()
  })

  it('keeps the row and reports a genuine steer failure', async () => {
    const snap = snapshotWith([row('i-steer-race', 'pending steer')])
    const source = liveSession(snap)
    const notify = vi.fn()
    const updateQueue = vi.fn(() => Promise.reject(new Error('transport failed')))
    const { getByLabelText, getByText } = render(
      <QueueDock {...kitFor(snap, { updateQueue, notify })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('立即插队'))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        'error',
        '插队失败，请重试。',
      )
    })
    expect(getByText('pending steer')).toBeTruthy()
  })

  it('keeps the row and surfaces a notice when an operation loses the claim race', async () => {
    const snap = snapshotWith([row('i-race', 'pending')])
    const source = liveSession(snap)
    const notify = vi.fn()
    const updateQueue = vi.fn(() => Promise.reject(new Error('not found')))
    const { getByLabelText, getByText } = render(
      <QueueDock {...kitFor(snap, { updateQueue, notify })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('删除排队消息'))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('error', '删除失败：这条消息可能已经开始发送。')
    })
    expect(getByText('pending')).toBeTruthy()
  })

  it('follows authoritative retirement back to null', () => {
    const snap = snapshotWith([row('i-1', '在场')])
    const source = liveSession(snap)
    const { container } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    expect(container.textContent).toContain('在场')
    act(() => { source.push(snapshotWith([])) })
    expect(container.innerHTML).toBe('')
  })

  it('registers as the terminal composer-context entry', () => {
    expect(queueDockEntry.name).toBe('conversation-queue-dock')
    expect(queueDockEntry.inject).toEqual(['slots', 'conversation', 'sessions'])
    const register = vi.fn(() => () => undefined)
    const inject = vi.fn((_name: string, callback: () => () => void) => callback())
    queueDockEntry.apply({ slots: { inject, register } } as never)
    expect(inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation.input.dock', id: 'queue', order: 20 }),
      QueueDock,
    )
  })
})
