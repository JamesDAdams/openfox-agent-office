import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The client is exercised against a fake WebSocket and a stubbed fetch, because
 * its whole job is reacting to a frame sequence — and one frame in that
 * sequence (the `ack`) carries no session id, which is exactly the kind of
 * detail a real server is the only way to discover.
 */
const originalFetch = globalThis.fetch
const OriginalWebSocket = globalThis.WebSocket

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.WebSocket = OriginalWebSocket
  vi.restoreAllMocks()
})

class FakeSocket {
  static last: FakeSocket | undefined
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: (() => void) | null = null
  readonly sent: string[] = []
  closed = false

  constructor(readonly url: string) {
    FakeSocket.last = this
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

function stubFetch(): { calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = []
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { calls }
}

async function client() {
  const { OpenFoxClient } = await import('./client.js')
  return new OpenFoxClient('http://127.0.0.1:10470', null)
}

describe('OpenFoxClient', () => {
  it('posts the prompt once the socket acknowledges the session load', async () => {
    const { calls } = stubFetch()
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket

    const turn = (await client()).runTurn('session-1', 'do the thing', {
      onText: () => {},
      onThinking: () => {},
      onToolUse: () => {},
      onToolResult: () => {},
    })

    const socket = FakeSocket.last!
    socket.onopen?.()

    // The real server answers session.load with an `ack` that carries NO
    // session id — filtering frames by session id alone silently drops it and
    // the turn never starts.
    socket.emit({ type: 'ack', payload: { sessionId: 'session-1' } })
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/api/sessions/session-1/message'))).toBe(true),
    )

    socket.emit({ type: 'chat.delta', sessionId: 'session-1', payload: { content: 'hi' } })
    socket.emit({ type: 'chat.done', sessionId: 'session-1', payload: { reason: 'complete' } })
    await expect(turn).resolves.toBeUndefined()
  })

  it('ignores another session\'s frames', async () => {
    stubFetch()
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket

    const texts: string[] = []
    const turn = (await client()).runTurn('mine', 'go', {
      onText: (t) => texts.push(t),
      onThinking: () => {},
      onToolUse: () => {},
      onToolResult: () => {},
    })

    const socket = FakeSocket.last!
    socket.onopen?.()
    socket.emit({ type: 'ack', payload: { sessionId: 'mine' } })
    socket.emit({ type: 'chat.delta', sessionId: 'someone-else', payload: { content: 'not mine' } })
    socket.emit({ type: 'chat.delta', sessionId: 'mine', payload: { content: 'mine' } })
    socket.emit({ type: 'chat.done', sessionId: 'mine', payload: {} })

    await turn
    expect(texts).toEqual(['mine'])
  })

  it('pairs a tool result with the call it answers by call id', async () => {
    stubFetch()
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket

    const results: Array<[string, string]> = []
    const turn = (await client()).runTurn('s', 'go', {
      onText: () => {},
      onThinking: () => {},
      onToolUse: () => {},
      onToolResult: (name, text) => results.push([name, text]),
    })

    const socket = FakeSocket.last!
    socket.onopen?.()
    socket.emit({ type: 'ack', payload: {} })
    socket.emit({ type: 'chat.tool_call', sessionId: 's', payload: { callId: 'c1', tool: 'read_file', args: {} } })
    // A tool result does not always carry its tool name; the call id is what
    // pairs them, and an empty name would be reported to the office as-is.
    socket.emit({ type: 'chat.tool_result', sessionId: 's', payload: { callId: 'c1', result: { output: 'file' } } })
    socket.emit({ type: 'chat.done', sessionId: 's', payload: {} })

    await turn
    expect(results).toEqual([['read_file', 'file']])
  })
})