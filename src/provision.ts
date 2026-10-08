import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { PluginLogger } from './types.js'
import type { OfficeSettings } from './settings.js'

const execFileP = promisify(execFile)

export const OFFICE_REPOSITORY = 'https://github.com/AgentSystemLabs/agent-office.git'

export interface ProvisionResult {
  dir: string
  prepared: boolean
}

export function hasNewerSources(dir: string, targetMtime: number): boolean {
  const srcDir = join(dir, 'src')
  if (!existsSync(srcDir)) return false
  const queue = [srcDir]
  while (queue.length > 0) {
    const current = queue.pop()!
    try {
      const entries = readdirSync(current, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const full = join(current, entry.name)
        if (entry.isDirectory()) {
          queue.push(full)
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.ts') ||
            entry.name.endsWith('.tsx') ||
            entry.name.endsWith('.js') ||
            entry.name.endsWith('.json') ||
            entry.name.endsWith('.css'))
        ) {
          const mtime = statSync(full).mtimeMs
          if (mtime > targetMtime) return true
        }
      }
    } catch {
      // ignore read errors
    }
  }
  return false
}

export function needsRebuild(dir: string): boolean {
  const cliJs = join(dir, 'dist', 'server', 'server', 'cli.js')
  if (!existsSync(cliJs)) return true
  try {
    const cliMtime = statSync(cliJs).mtimeMs
    return hasNewerSources(dir, cliMtime)
  } catch {
    return false
  }
}

export async function rebuildOffice(dir: string, logger: PluginLogger): Promise<void> {
  logger.info('Rebuilding Agent Office from source', { dir })
  if (!existsSync(join(dir, 'node_modules'))) {
    await execFileP('npm', ['install'], { cwd: dir, timeout: 900_000 })
  }
  await execFileP('npm', ['run', 'build'], { cwd: dir, timeout: 900_000 })
}

export async function checkOfficeInstallation(
  configDirectory: string,
  settings: OfficeSettings,
): Promise<{ installed: boolean; message: string }> {
  if (settings.launchMode === 'global') {
    const cmd = settings.officeCommand || 'agent-office'
    try {
      await execFileP('which', [cmd], { timeout: 5000 })
      return { installed: true, message: `Command "${cmd}" found in PATH` }
    } catch {
      return { installed: false, message: `Command "${cmd}" not found in PATH` }
    }
  }

  if (settings.launchMode === 'local' && !settings.officeDir) {
    return { installed: false, message: 'Local folder not specified (set "Local repository folder")' }
  }

  const dir =
    settings.launchMode === 'local' && settings.officeDir
      ? settings.officeDir
      : join(configDirectory, 'agent-office')

  const hasPackageJson = existsSync(join(dir, 'package.json'))
  const hasBinary = existsSync(join(dir, 'bin', 'agent-office.js'))
  const hasDist = existsSync(join(dir, 'dist', 'server', 'server', 'cli.js'))

  if (hasPackageJson && (hasBinary || hasDist)) {
    return {
      installed: true,
      message: `Installed at ${dir}`,
    }
  }

  return { installed: false, message: `Not installed or built at ${dir}` }
}

export async function ensureOffice(
  configDirectory: string,
  settingsOrDir: OfficeSettings | string,
  logger: PluginLogger,
): Promise<ProvisionResult> {
  const settings: { launchMode: 'managed' | 'global' | 'local'; officeDir: string; officeCommand: string } =
    typeof settingsOrDir === 'string'
      ? { launchMode: settingsOrDir ? 'local' : 'managed', officeDir: settingsOrDir, officeCommand: 'agent-office' }
      : settingsOrDir

  if (settings.launchMode === 'global') {
    return { dir: '', prepared: true }
  }

  const dir =
    settings.launchMode === 'local' && settings.officeDir
      ? settings.officeDir
      : join(configDirectory, 'agent-office')

  await mkdir(dir, { recursive: true }).catch(() => {})

  if (!existsSync(join(dir, 'package.json'))) {
    if (settings.launchMode === 'local') {
      throw new Error(`Local repository folder not found: ${dir}`)
    }
    logger.info('Cloning Agent Office', { dir })
    await execFileP('git', ['clone', '--depth', '1', OFFICE_REPOSITORY, dir], { timeout: 180_000 })
  }

  if (needsRebuild(dir)) {
    logger.info('Building Agent Office', { dir })
    await rebuildOffice(dir, logger)
  }

  return { dir, prepared: true }
}
