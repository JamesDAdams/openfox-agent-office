import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { readStdin, runTurn, type BridgeOptions } from './bridge.js'

/** readStdin reads process.stdin; point it at a stream for the test. */
function readStdinOn(stream: PassThrough, onMessage: (text: string) => void): () => void {
  Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
  return readStdin(onMessage)
}

describe('readStdin', () => {
  const closers: Array<() => void> = []
  afterEach(() => {
    while (closers.length) closers.pop()?.()
  })

  function feed(lines: string[]): string[] {
    const stream = new PassThrough()
    const received: string[] = []
    closers.push(readStdinOn(stream, (text) => received.push(text)))
    for (const line of lines) stream.write(`${line}\n`)
    return received
  }

  it('joins a bracketed paste into one message', () => {
    const received = feed(['\x1b[200~first', 'second', 'third\x1b[201~'])
    expect(received).toEqual(['first\nsecond\nthird'])
  })

  it('joins a paste that opens on one line and closes on a later read', () => {
    const stream = new PassThrough()
    const received: string[] = []
    closers.push(readStdinOn(stream, (text) => received.push(text)))
    stream.write('\x1b[200~one\n')
    expect(received).toEqual([])
    stream.write('two\x1b[201~\n')
    expect(received).toEqual(['one\ntwo'])
  })

  it('still takes a plain typed line, and ignores blank ones', () => {
    const received = feed(['just a task', '', '   ', 'another'])
    expect(received).toEqual(['just a task', 'another'])
  })

  it('does not split a paste on a line that looks like a bracket', () => {
    const received = feed(['\x1b[200~a\x1b[201~'])
    expect(received).toEqual(['a'])
  })
})

describe('runTurn session embed url reporting', () => {
  it('creates project/session and reports embed_url to office hook', async () => {
    const reportedHooks: Array<{ event: string; payload: any }> = []

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/projects')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ projects: [{ id: 'proj-openfox-test', workdir: '/test/workdir' }] }),
        } as Response
      }
      if (u.includes('/api/sessions') && !u.includes('/message')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ session: { id: 'sess-openfox-456' } }),
        } as Response
      }
      if (u.includes('/hooks/claude')) {
        const payload = init?.body ? JSON.parse(String(init.body)) : {}
        const event = new URL(u).searchParams.get('event') ?? ''
        reportedHooks.push({ event, payload })
        return { ok: true, status: 200, json: async () => ({}) } as Response
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response
    })

    const options: BridgeOptions = {
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      serverUrl: 'http://127.0.0.1:10469',
      token: 'tok-123',
      model: '',
      projectId: 'proj-openfox-test',
      workdir: '/test/workdir',
      hookUrl: 'http://127.0.0.1:4600',
      hookToken: 'hook-tok',
      workerId: 'w-1',
    }

    try {
      const write = vi.fn()
      const ctrl = new AbortController()
      ctrl.abort()

      await runTurn(options, 'hello world', write, ctrl.signal).catch(() => {})

      const startHook = reportedHooks.find((h) => h.event === 'SessionStart' && h.payload.session_id === 'sess-openfox-456')
      expect(startHook).toBeDefined()
      expect(startHook?.payload.embed_url).toBe('http://127.0.0.1:10469/p/proj-openfox-test/s/sess-openfox-456')
      expect(startHook?.payload.web_url).toBe('http://127.0.0.1:10469/p/proj-openfox-test/s/sess-openfox-456')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
