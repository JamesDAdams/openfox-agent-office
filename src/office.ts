import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginLogger } from './types.js'
import type { LaunchMode } from './settings.js'

export interface OfficeLaunchOptions {
  launchMode?: LaunchMode
  command?: string
  dir: string
  host?: string
  port: number
  password: string
  agentCommand: string
  env: Record<string, string>
  logger: PluginLogger
}

export interface OfficeStatus {
  running: boolean
  url: string | null
  port: number
  pid: number | null
  startedAt: number | null
  lastError: string | null
}

export const DEFAULT_PORT = 4600

export function killProcessesOnPort(port: number): void {
  if (!port || port <= 0) return
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      for (const line of out.split('\n')) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/)
          const pid = Number(parts[parts.length - 1])
          if (pid && pid !== process.pid) {
            try {
              execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' })
            } catch {}
          }
        }
      }
    } catch {}
    return
  }

  try {
    const out = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const pids = out.trim().split(/\s+/).filter(Boolean).map(Number)
    for (const pid of pids) {
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
    }
  } catch {}
}

export class OfficeSupervisor {
  private child: ChildProcess | null = null
  private startedAt: number | null = null
  private lastError: string | null = null

  constructor(private readonly options: OfficeLaunchOptions) {
    this.options = { ...options, port: options.port || DEFAULT_PORT }
  }

  get port(): number {
    return this.options.port
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  get status(): OfficeStatus {
    return {
      running: this.child !== null && this.child.exitCode === null,
      url: this.child ? this.url : null,
      port: this.port,
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      lastError: this.lastError,
    }
  }

  async ensureRunning(): Promise<string> {
    if (this.status.running) {
      if (await this.serving()) return this.url
      if (Date.now() - (this.startedAt ?? 0) < BOOT_TIMEOUT_MS) return this.awaitBoot()
    }
    return this.start()
  }

  async restart(): Promise<string> {
    this.stop()
    return this.start()
  }

  stop(): void {
    const child = this.child
    this.child = null
    this.startedAt = null
    if (child) {
      child.removeAllListeners()
      try {
        if (process.platform !== 'win32' && child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM')
          } catch {
            child.kill('SIGTERM')
          }
        } else {
          child.kill('SIGTERM')
        }
      } catch {
        /* already gone */
      }
      setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) {
            process.kill(-child.pid, 'SIGKILL')
          } else {
            child.kill('SIGKILL')
          }
        } catch {}
      }, 300)
    }
    killProcessesOnPort(this.port)
  }

  private start(): Promise<string> {
    // Ensure any stale process on the target port is terminated before starting
    killProcessesOnPort(this.port)

    const baseArgs = [
      '--no-open',
      '--host',
      this.options.host || '127.0.0.1',
      '--port',
      String(this.options.port),
      '--agent',
      this.options.agentCommand,
      ...(this.options.password ? ['--password', this.options.password] : []),
    ]

    this.lastError = null
    this.startedAt = Date.now()

    let child: ChildProcess
    if (this.options.launchMode === 'global') {
      const command = this.options.command || 'agent-office'
      child = spawn(command, baseArgs, {
        cwd: this.options.dir || process.cwd(),
        detached: process.platform !== 'win32',
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...this.options.env,
          CI: '1',
        },
        windowsHide: true,
      })
    } else {
      const entry = join(this.options.dir, 'bin', 'agent-office.js')
      if (!existsSync(entry)) {
        return Promise.reject(
          new Error(`Agent Office is not built at ${entry}. Run "npm install && npm run build" in that checkout.`),
        )
      }

      child = spawn(process.execPath, [entry, ...baseArgs], {
        cwd: this.options.dir,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...this.options.env,
          CI: '1',
        },
        windowsHide: true,
      })
    }

    this.child = child

    const log = (chunk: Buffer) => {
      const line = chunk.toString().trimEnd()
      if (line) this.options.logger.debug(`[agent-office] ${line}`)
    }
    child.stdout?.on('data', log)
    child.stderr?.on('data', log)
    child.on('error', (error) => {
      this.lastError = error.message
      this.options.logger.error('Agent Office process error', { error: error.message })
    })
    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null
        this.startedAt = null
      }
      this.options.logger.warn('Agent Office exited', { code, signal })
    })

    return this.awaitBoot()
  }

  private async awaitBoot(): Promise<string> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (!this.child) throw new Error(this.lastError ?? 'Agent Office stopped before it started serving.')
      if (await this.serving()) return this.url
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
    this.stop()
    throw new Error(`Agent Office did not answer on port ${this.port} in time.`)
  }

  private async serving(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/api/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      return res.ok
    } catch {
      return false
    }
  }
}

const POLL_MS = 500
const BOOT_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 500
