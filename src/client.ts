/**
 * Minimal REST + WebSocket client for OpenFox.
 *
 * Speaks exactly what OpenFox's own web client speaks — create a session over
 * REST, load it over the socket, post the message over REST, read the turn off
 * the socket — so a bridge worker behaves like a session someone started in
 * OpenFox's own UI. No OpenFox-internal imports, and nothing in the host that
 * knows this plugin exists.
 */
export interface TurnHandlers {
  onText(text: string): void
  onThinking(text: string): void
  onToolUse(name: string, input: Record<string, unknown>): void
  onToolResult(name: string, text: string): void
}

interface Wire {
  type: string
  sessionId?: string
  payload?: Record<string, unknown>
}

export class OpenFoxClient {
  constructor(
    private readonly serverUrl: string,
    private readonly token: string | null,
  ) {}

  private headers(): Record<string, string> {
    return this.token ? { 'content-type': 'application/json', 'x-session-token': this.token } : { 'content-type': 'application/json' }
  }

  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${this.serverUrl}${path}`, { ...init, headers: this.headers() })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `OpenFox request failed (${res.status})`)
    }
    return res.status === 204 ? undefined : res.json()
  }

  /** Start a session in a project, optionally pinned to a provider/model. */
  async createSession(projectId: string, model?: string): Promise<string> {
    const body = (await this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    })) as { session?: { id?: string } }
    const id = body.session?.id
    if (!id) throw new Error('OpenFox did not return a session id')

    if (model) {
      // OpenFox names a model as `providerId/model`. A bare model id means
      // "the active provider, this model" — and an unknown one is not fatal:
      // the session just runs on OpenFox's active selection.
      const slash = model.indexOf('/')
      await this.request(`/api/sessions/${id}/provider`, {
        method: 'POST',
        body: JSON.stringify(
          slash > 0 ? { providerId: model.slice(0, slash), model: model.slice(slash + 1) } : { model },
        ),
      }).catch(() => undefined)
    }
    return id
  }

  /**
   * Run one turn: subscribe, post the prompt, resolve when it settles.
   *
   * OpenFox routes events per session, so the socket must be loaded onto the
   * session before the message lands — otherwise the turn runs (the office's
   * worker would appear idle) with nobody listening.
   */
  async runTurn(sessionId: string, prompt: string, handlers: TurnHandlers, signal?: AbortSignal): Promise<void> {
    await this.listen(sessionId, prompt, handlers, signal)
  }

  private listen(
    sessionId: string,
    prompt: string,
    handlers: TurnHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.socketUrl())
      let settled = false
      let posted = false
      // Tool name per call id, for the results that arrive without one.
      const toolNames = new Map<string, string>()

      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(guard)
        signal?.removeEventListener('abort', onAbort)
        try {
          socket.close()
        } catch {
          /* already closing */
        }
        if (error) reject(error)
        else resolve()
      }

      const onAbort = () => finish(new Error('Stopped.'))
      signal?.addEventListener('abort', onAbort, { once: true })

      // A turn that never reports done would hang the office's worker forever.
      const guard = setTimeout(() => finish(new Error('OpenFox did not finish the turn in time.')), TURN_TIMEOUT_MS)

      socket.onerror = () => finish(new Error('Could not reach the OpenFox event stream.'))
      socket.onclose = () => finish()

      socket.onmessage = (event) => {
        const message = parse(event.data)
        if (!message) return
        const payload = message.payload ?? {}
        // `ack` is the answer to our own session.load and carries no session
        // id, so it is the one frame accepted without one; everything else is
        // this session's or another worker's and must not be mixed in.
        if (message.type !== 'ack' && message.sessionId !== sessionId) return

        switch (message.type) {
          case 'ack':
            // The session is loaded; now the prompt can be posted.
            if (!posted) {
              posted = true
              void this.request(`/api/sessions/${sessionId}/message`, {
                method: 'POST',
                body: JSON.stringify({ content: prompt }),
              }).catch((error: unknown) =>
                finish(error instanceof Error ? error : new Error(String(error))),
              )
            }
            break
          case 'chat.delta':
            handlers.onText(string(payload, 'content'))
            break
          case 'chat.thinking':
            handlers.onThinking(string(payload, 'content'))
            break
          case 'chat.tool_call': {
            const callId = string(payload, 'callId')
            const name = string(payload, 'tool') || 'tool'
            if (callId) toolNames.set(callId, name)
            handlers.onToolUse(name, object(payload, 'args') ?? {})
            break
          }
          case 'chat.tool_result': {
            const result = object(payload, 'result')
            // A tool result carries its call id but not always its name, so the
            // name the call announced is what pairs them up.
            const callId = string(payload, 'callId')
            const name = string(payload, 'tool') || (callId ? toolNames.get(callId) : undefined) || 'tool'
            if (callId) toolNames.delete(callId)
            handlers.onToolResult(name, (result && (string(result, 'output') || string(result, 'error'))) || '')
            break
          }
          case 'chat.done':
            finish()
            break
          case 'chat.error':
            finish(new Error(string(payload, 'error') || 'OpenFox turn failed.'))
            break
          default:
            break
        }
      }

      socket.onopen = () => {
        socket.send(JSON.stringify({ id: 'load', type: 'session.load', payload: { sessionId } }))
      }
    })
  }

  private socketUrl(): string {
    const url = new URL(this.serverUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/ws'
    url.search = ''
    if (this.token) url.searchParams.set('token', this.token)
    return url.toString()
  }
}

/** Generous: a long agent turn with big tool calls is normal, not stuck. */
const TURN_TIMEOUT_MS = 30 * 60 * 1000

function string(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

function object(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = payload[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function parse(data: unknown): Wire | null {
  try {
    const value = JSON.parse(typeof data === 'string' ? data : String(data)) as {
      type?: unknown
      sessionId?: unknown
      payload?: unknown
    }
    if (typeof value.type !== 'string') return null
    const payload = value.payload
    return {
      type: value.type,
      ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
      payload: payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {},
    }
  } catch {
    return null
  }
}