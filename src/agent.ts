#!/usr/bin/env node
/**
 * The agent executable an office worker runs.
 *
 * Agent Office starts this with the worker's task on argv, then types further
 * prompts into the PTY. Everything needed to reach OpenFox arrives in the
 * environment the plugin set when it launched the office, so this process has
 * no configuration of its own.
 */
import { basename } from 'node:path'
import { readStdin, runTurn, reportHook, type BridgeOptions } from './bridge.js'
import { OpenFoxClient } from './client.js'
import { ensureProject } from './project.js'

interface BridgeConfig {
  serverUrl: string
  token: string | null
  model: string
  projectId: string
}

/**
 * Read the configuration the plugin passed down.
 *
 * The worker is a separate process from OpenFox, so nothing here reaches back
 * into the plugin — everything it needs travelled in the environment.
 */
function bridgeConfig(): BridgeConfig {
  const raw = process.env['OPENFOX_AGENT_OFFICE_BRIDGE']
  if (!raw) {
    throw new Error(
      'OPENFOX_AGENT_OFFICE_BRIDGE is not set: this command is run by the OpenFox Agent Office plugin.',
    )
  }
  return JSON.parse(raw) as BridgeConfig
}

/** A logger that goes to stderr, which the office renders as the terminal's. */
const logger = {
  debug: (message: string, context?: Record<string, unknown>) => line('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => line('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => line('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => line('error', message, context),
}

function line(level: string, message: string, context?: Record<string, unknown>): void {
  process.stderr.write(`[openfox-agent-office ${level}] ${message}${context ? ` ${JSON.stringify(context)}` : ''}\n`)
}

async function main(): Promise<void> {
  const config = bridgeConfig()
  const options: BridgeOptions = {
    logger,
    serverUrl: config.serverUrl,
    token: config.token,
    model: config.model,
    projectId: config.projectId,
    workdir: process.cwd(),
    hookUrl: process.env['AGENT_OFFICE_HOOK_URL'] ?? '',
    hookToken: process.env['AGENT_OFFICE_HOOK_TOKEN'] ?? '',
    workerId: process.env['AGENT_OFFICE_WORKER_ID'] ?? '',
  }

  if (!options.hookUrl || !options.workerId) {
    process.stderr.write('This command is meant to be run as an Agent Office worker (no office context).\n')
    process.exit(2)
  }

  const argv = process.argv.slice(2)
  const resumeIdx = argv.indexOf('--resume')
  const resumeSessionId = resumeIdx >= 0 ? argv[resumeIdx + 1] : undefined
  const separator = argv.indexOf('--')
  const task = separator >= 0 ? argv.slice(separator + 1).join(' ') : ''

  const write = (text: string) => process.stdout.write(text)

  let activeSessionId = resumeSessionId
  try {
    const projectId = await ensureProject(
      options.serverUrl,
      options.token,
      options.workdir,
      basename(options.workdir) || 'agent-office',
    )
    if (!activeSessionId) {
      const client = new OpenFoxClient(options.serverUrl, options.token)
      activeSessionId = await client.createSession(projectId, options.model)
    }
    const webUrl = `${options.serverUrl.replace(/\/$/, '')}/p/${encodeURIComponent(projectId)}/s/${encodeURIComponent(activeSessionId)}`
    await reportHook(options, 'SessionStart', {
      session_id: activeSessionId,
      embed_url: webUrl,
      web_url: webUrl,
      source: 'startup',
      cwd: options.workdir,
    })
  } catch (err) {
    logger.warn('Could not initialize session on startup', { error: (err as Error).message })
  }

  if (task.trim()) {
    activeSessionId = await runTurn(options, task, write, undefined, activeSessionId).catch((error: unknown) => {
      reportFailure(write, error)
      return activeSessionId
    })
  }

  readStdin((text) => {
    void runTurn(options, text, write, undefined, activeSessionId)
      .then((id) => {
        if (id) activeSessionId = id
      })
      .catch((error: unknown) => reportFailure(write, error))
  })

  process.stdin.on('end', () => process.exit(0))
}

function reportFailure(write: (text: string) => void, error: unknown): void {
  write(`\r\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`openfox-agent-office bridge failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
