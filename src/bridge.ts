/**
 * The bridge an office worker runs as its agent.
 *
 * Agent Office hires agents by launching a CLI in a PTY and reading Claude
 * Code's hooks to know what the agent is doing. It has a `custom` provider for
 * "run this command as it is", which reports on that hook route — so the whole
 * surface we need is: take a task on argv, then speak those hooks.
 *
 * That is exactly what this does, with OpenFox as the engine:
 *
 *   task on argv  ->  an OpenFox session  ->  the turn rendered into the PTY
 *   hooks posted  ->  the office's loopback hook server
 *
 * The worker is an ordinary OpenFox session, so it gets OpenFox's tools,
 * providers, agents and modes — not a raw completion call.
 */
import { createInterface } from 'node:readline'
import { basename } from 'node:path'
import { OpenFoxClient } from './client.js'
import { ensureProject } from './project.js'
import type { PluginLogger } from './types.js'

/**
 * The Claude Code hook events the office's provider actually switches on
 * (src/server/providers/claude.ts). Speaking its dialect is the whole
 * integration: the office then tracks status, activity, tools and tasks for
 * free, exactly as it does for a real Claude Code worker.
 */
const HOOK = {
  sessionStart: 'SessionStart',
  userPrompt: 'UserPromptSubmit',
  preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  notification: 'Notification',
  stop: 'Stop',
} as const

/** The office's `claudeBlocked` reads the screen for these; we never show them. */
export interface BridgeOptions {
  logger: PluginLogger
  serverUrl: string
  token: string | null
  model: string
  projectId: string
  workdir: string
  /** Per-worker wiring the office hands every worker it starts. */
  hookUrl: string
  hookToken: string
  workerId: string
}

/**
 * Report one hook event to the office.
 *
 * Best-effort by construction: the office is decoration over OpenFox, so a
 * failed hook must never take the worker's turn down with it.
 */
export async function reportHook(options: BridgeOptions, event: string, payload: unknown): Promise<void> {
  if (!options.hookUrl || !options.workerId) return
  const url = new URL(`${options.hookUrl}/hooks/claude`)
  url.searchParams.set('worker', options.workerId)
  url.searchParams.set('event', event)
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.hookToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // The office may be restarting; the next event tries again.
  }
}

/**
 * Run one worker turn, streaming OpenFox's output into the PTY.
 *
 * Resolves when the turn settles (done, or failed).
 */
export async function runTurn(
  options: BridgeOptions,
  prompt: string,
  write: (text: string) => void,
  signal?: AbortSignal,
  existingSessionId?: string,
): Promise<string> {
  const client = new OpenFoxClient(options.serverUrl, options.token)

  try {
    const projectId = await ensureProject(
      options.serverUrl,
      options.token,
      options.workdir,
      basename(options.workdir) || 'agent-office',
    )
    const sessionId = existingSessionId || (await client.createSession(projectId, options.model))
    const webUrl = `${options.serverUrl.replace(/\/$/, '')}/p/${encodeURIComponent(projectId)}/s/${encodeURIComponent(sessionId)}`

    await reportHook(options, HOOK.sessionStart, {
      session_id: sessionId,
      embed_url: webUrl,
      web_url: webUrl,
      source: 'startup',
      cwd: options.workdir,
    })
    await reportHook(options, HOOK.userPrompt, { session_id: sessionId, prompt })
    write(`\r\n\x1b[2m> ${prompt}\x1b[0m\r\n\r\n`)

    await client.runTurn(
      sessionId,
      prompt,
      {
        onText: (text) => write(text),
        onThinking: (text) => write(`\x1b[2m\x1b[3m${text}\x1b[0m`),
        onToolUse: (name, input) => {
          write(`\r\n\x1b[36m▸ ${name}\x1b[0m\r\n`)
          void reportHook(options, HOOK.preToolUse, {
            session_id: sessionId,
            tool_name: name,
            tool_input: input,
          })
        },
        onToolResult: (name, text) => {
          write(`${text}\r\n`)
          void reportHook(options, HOOK.postToolUse, {
            session_id: sessionId,
            tool_name: name,
            tool_response: text,
          })
        },
      },
      signal,
    )

    write('\r\n')
    await reportHook(options, HOOK.stop, { session_id: sessionId })
    return sessionId
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    write(`\r\n\x1b[31m${message}\x1b[0m\r\n`)
    await reportHook(options, HOOK.notification, {
      session_id: options.workerId,
      notification_type: 'error',
      message,
    })
    throw error
  }
}

/**
 * Read stdin the way an interactive agent CLI does.
 *
 * The office types a follow-up prompt into the worker's terminal, bracketed
 * (`ESC [ 200 ~ … ESC [ 201 ~`), so a multi-line task arrives as one message
 * rather than one per row. Plain lines still work for someone typing by hand.
 */
export function readStdin(onMessage: (text: string) => void): () => void {
  const input = createInterface({ input: process.stdin, terminal: false })
  const START = '\x1b[200~'
  const END = '\x1b[201~'
  let paste: string | null = null

  input.on('line', (line) => {
    if (paste !== null) {
      const next = paste + '\n' + line
      if (next.endsWith(END)) {
        paste = null
        onMessage(next.slice(0, -END.length))
      } else {
        paste = next
      }
      return
    }

    if (line.startsWith(START)) {
      if (line.endsWith(END)) {
        onMessage(line.slice(START.length, -END.length))
      } else {
        paste = line.slice(START.length)
      }
      return
    }

    if (!line.trim()) return
    onMessage(line)
  })

  return () => input.close()
}
