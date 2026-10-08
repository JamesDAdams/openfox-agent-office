import { findOpenFox, mintSessionToken, portCandidates } from './discover.js'
import { OfficeSupervisor, killProcessesOnPort, DEFAULT_PORT, type OfficeLaunchOptions, type OfficeStatus } from './office.js'
import { ensureOffice, checkOfficeInstallation, rebuildOffice } from './provision.js'
import { SETTINGS, readSettings, DEFAULT_SETTINGS, type OfficeSettings } from './settings.js'
import type { DeclarativeNode, PluginRegistry, PluginSettingValue, PluginSettingsSchema } from './types.js'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export * from './types.js'
export * from './settings.js'
export * from './provision.js'
export * from './office.js'

export const AGENT_OFFICE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 11h.01M15 11h.01M9 15h.01M15 15h.01"/></svg>'

export function buildHeaderButton(showHeader: boolean): DeclarativeNode {
  if (!showHeader) {
    return {
      type: 'stack',
      direction: 'row',
      children: [],
    }
  }

  return {
    type: 'button',
    id: 'agent-office-header-btn',
    label: { en: 'Agent Office', fr: 'Agent Office' },
    title: { en: 'Open Agent Office', fr: 'Ouvrir Agent Office' },
    icon: AGENT_OFFICE_ICON_SVG,
    variant: 'ghost',
    onActivate: {
      kind: 'rpc',
      method: 'office.open',
    },
  }
}

const AGENT_ENTRY = fileURLToPath(new URL('./agent.js', import.meta.url))

let activeSupervisor: OfficeSupervisor | null = null
let activeSettingsGetter: (() => OfficeSettings) | null = null
let exitHookRegistered = false

export async function register(registry: PluginRegistry): Promise<void> {
  const { context } = registry

  let supervisor: OfficeSupervisor | null = null
  let signature = ''

  const current = (): OfficeSettings => readSettings(context.settings ? context.settings() : {})
  activeSettingsGetter = current

  if (!exitHookRegistered) {
    exitHookRegistered = true
    const onExit = () => {
      try {
        const s = activeSettingsGetter ? activeSettingsGetter() : DEFAULT_SETTINGS
        if (s.killOnExit !== false) {
          activeSupervisor?.stop()
          activeSupervisor = null
          killProcessesOnPort(s.officePort || DEFAULT_PORT)
        }
      } catch {}
    }
    process.on('exit', onExit)
    process.on('SIGINT', onExit)
    process.on('SIGTERM', onExit)
    process.on('beforeExit', onExit)
  }

  const office = async (): Promise<OfficeSupervisor> => {
    const settings = current()
    const next = JSON.stringify([
      settings.launchMode,
      settings.officeDir,
      settings.officeCommand,
      settings.officeHost,
      settings.officePort,
      settings.officePassword,
    ])
    if (supervisor && next === signature && supervisor.status.running) return supervisor
    if (supervisor) {
      context.logger.info('Restarting Agent Office supervisor due to config change')
      supervisor.stop()
      supervisor = null
    }
    signature = next

    const { dir } = await ensureOffice(context.runtime.configDirectory, settings, context.logger)
    const serverUrl = await findOpenFox(portCandidates(context.runtime.mode))
    if (!serverUrl) {
      throw new Error(
        "Could not reach OpenFox. Start it, then open the office again — the office's workers run on OpenFox.",
      )
    }

    const options: OfficeLaunchOptions = {
      launchMode: settings.launchMode,
      command: settings.officeCommand,
      dir,
      host: settings.officeHost,
      port: settings.officePort,
      password: settings.officePassword,
      agentCommand: AGENT_ENTRY,
      env: {
        OPENFOX_AGENT_OFFICE_BRIDGE: JSON.stringify({
          serverUrl,
          token: await mintSessionToken(context.runtime.configDirectory),
          model: '',
          projectId: '',
        }),
      },
      logger: context.logger,
    }
    supervisor = new OfficeSupervisor(options)
    activeSupervisor = supervisor
    return supervisor
  }

  function publishOfficeState(st: OfficeStatus) {
    const isRunning = st.running
    context.publish('office-panel', 'stateText', isRunning ? 'Running' : 'Stopped')
    context.publish('office-panel', 'urlText', isRunning && st.url ? st.url : '—')
    context.publish('office-panel', 'portText', isRunning && st.port ? String(st.port) : '—')
    context.publish(
      'office-panel',
      'statusSubtitle',
      isRunning ? (st.url ? `🟢 Running at ${st.url}` : '🟢 Running') : '🔴 Stopped',
    )
  }

  registry.registerUiAction({
    id: 'open-office',
    slot: 'plugin.menu',
    label: { en: 'Agent Office', fr: 'Agent Office' },
    icon: 'building',
    tooltip: {
      en: 'Open Agent Office, where OpenFox agents work at desks',
      fr: 'Ouvrir Agent Office, où les agents OpenFox travaillent à des bureaux',
    },
    onActivate: { kind: 'rpc', method: 'office.showPanel' },
  })

  registry.registerUiComponent({
    id: 'agent-office-header-btn',
    zone: 'header.actions',
    component: buildHeaderButton(current().showHeaderButton),
    contentSource: {
      kind: 'rpc',
      method: 'office.getHeaderButton',
      refreshMs: 2000,
    },
  })

  registry.registerUiPanel({
    id: 'office-panel',
    title: { en: 'Agent Office', fr: 'Agent Office' },
    size: 'sm',
    kind: 'declarative',
    content: [
      {
        type: 'card',
        title: { en: 'Agent Office Status', fr: 'Statut d’Agent Office' },
        children: [
          {
            type: 'text',
            text: { en: '{{statusSubtitle}}', fr: '{{statusSubtitle}}' },
            muted: true,
            className: 'text-xs mb-2 font-medium',
          },
          {
            type: 'keyValue',
            items: [
              { key: { en: 'State', fr: 'État' }, value: '{{stateText}}' },
              { key: { en: 'URL', fr: 'URL' }, value: '{{urlText}}' },
              { key: { en: 'Port', fr: 'Port' }, value: '{{portText}}' },
            ],
          },
        ],
      },
      {
        type: 'stack',
        direction: 'row',
        gap: 'sm',
        align: 'center',
        justify: 'between',
        className: 'mt-4',
        children: [
          {
            type: 'button',
            label: { en: 'Start', fr: 'Lancer' },
            icon: 'play',
            variant: 'primary',
            onActivate: { kind: 'rpc', method: 'office.startPanel' },
          },
          {
            type: 'button',
            label: { en: 'Stop', fr: 'Fermer' },
            icon: 'stop',
            variant: 'danger',
            onActivate: { kind: 'rpc', method: 'office.stopPanel' },
          },
          {
            type: 'button',
            label: { en: 'Open in tab', fr: 'Ouvrir' },
            icon: 'external',
            variant: 'default',
            onActivate: { kind: 'rpc', method: 'office.openTab' },
          },
        ],
      },
    ],
  })

  let evaluatingSettings = false
  const dynamicSettings: PluginSettingsSchema = {
    get fields() {
      if (evaluatingSettings) return SETTINGS.fields
      evaluatingSettings = true
      try {
        const s = current()
        if (s.launchMode === 'managed') {
          return SETTINGS.fields
        }
        return SETTINGS.fields.filter(
          (f) => f.key !== 'officeInstall' && f.key !== 'officeRebuild',
        )
      } finally {
        evaluatingSettings = false
      }
    },
  }

  registry.registerSettings(dynamicSettings)

  registry.registerRpc('office.getHeaderButton', async () => {
    const settings = current()
    return {
      content: buildHeaderButton(settings.showHeaderButton),
    }
  })

  registry.registerRpc('office.checkStatus', async (params) => {
    try {
      const raw =
        params && typeof params === 'object' && Object.keys(params).length > 0
          ? { ...(context.settings ? context.settings() : {}), ...(params as Record<string, unknown>) }
          : context.settings
            ? context.settings()
            : {}
      const settings = readSettings(raw as Record<string, PluginSettingValue | undefined>)
      const installStatus = await checkOfficeInstallation(context.runtime.configDirectory, settings)
      const isRunning = supervisor?.status.running ?? false
      return {
        installed: installStatus.installed,
        running: isRunning,
        message: installStatus.message,
        text: installStatus.message,
        statusText: installStatus.message,
        statusTone: installStatus.installed ? 'success' : 'danger',
        url: supervisor?.status.url ?? null,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return {
        installed: false,
        running: false,
        message: errMsg,
        text: errMsg,
        statusText: errMsg,
        statusTone: 'danger',
        url: null,
      }
    }
  })

  registry.registerRpc('office.rebuild', async () => {
    const settings = current()
    const dir =
      settings.launchMode === 'local' && settings.officeDir
        ? settings.officeDir
        : join(context.runtime.configDirectory, 'agent-office')
    context.notify({
      title: { en: 'Rebuilding Agent Office', fr: 'Reconstruction d’Agent Office' },
      body: { en: `Building from source at ${dir}...`, fr: `Compilation depuis la source dans ${dir}...` },
      level: 'info',
    })
    try {
      await rebuildOffice(dir, context.logger)
      if (supervisor?.status.running) {
        await supervisor.restart()
      }
      context.notify({
        title: { en: 'Agent Office Rebuilt', fr: 'Agent Office reconstruit' },
        body: { en: `Rebuilt successfully at ${dir}`, fr: `Reconstruit avec succès dans ${dir}` },
        level: 'success',
      })
      return { success: true, dir }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      context.notify({
        title: { en: 'Rebuild failed', fr: 'Échec de la reconstruction' },
        body: { en: message, fr: message },
        level: 'error',
      })
      return { success: false, error: message }
    }
  })

  registry.registerRpc('office.install', async () => {
    const settings = current()
    context.notify({
      title: { en: 'Installing Agent Office', fr: 'Installation d’Agent Office' },
      body: {
        en: 'Cloning and building Agent Office...',
        fr: 'Clonage et compilation d’Agent Office...',
      },
      level: 'info',
    })
    try {
      const result = await ensureOffice(context.runtime.configDirectory, settings, context.logger)
      context.notify({
        title: { en: 'Agent Office Ready', fr: 'Agent Office prêt' },
        body: {
          en: `Installed successfully at ${result.dir}`,
          fr: `Installé avec succès dans ${result.dir}`,
        },
        level: 'success',
      })
      return { success: true, dir: result.dir }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      context.notify({
        title: { en: 'Installation failed', fr: 'Échec de l’installation' },
        body: { en: message, fr: message },
        level: 'error',
      })
      return { success: false, error: message }
    }
  })

  registry.registerRpc('office.showPanel', async () => {
    const running = await office()
    publishOfficeState(running.status)
    return { openPanel: 'office-panel' }
  })

  registry.registerRpc('office.startPanel', async () => {
    const running = await office()
    const url = await running.ensureRunning()
    publishOfficeState(running.status)
    context.notify({
      title: { en: 'Agent Office started', fr: 'Agent Office démarré' },
      body: { en: `Running at ${url}`, fr: `Disponible sur ${url}` },
      level: 'success',
    })
    return { status: running.status }
  })

  registry.registerRpc('office.stopPanel', async () => {
    const settings = current()
    if (supervisor) {
      supervisor.stop()
      supervisor = null
    }
    activeSupervisor?.stop()
    activeSupervisor = null
    killProcessesOnPort(settings.officePort || DEFAULT_PORT)
    const st = stopped()
    publishOfficeState(st)
    context.notify({
      title: { en: 'Agent Office stopped', fr: 'Agent Office arrêté' },
      body: { en: 'Agent Office subprocess has been stopped.', fr: 'Le sous-processus Agent Office a été arrêté.' },
      level: 'info',
    })
    return { status: st }
  })

  registry.registerRpc('office.openTab', async () => {
    const running = await office()
    const url = await running.ensureRunning()
    publishOfficeState(running.status)
    return { url, status: running.status }
  })

  registry.registerRpc('office.open', async () => {
    const running = await office()
    const url = await running.ensureRunning()
    publishOfficeState(running.status)
    return { url, status: running.status }
  })

  registry.registerRpc('office.status', async () => {
    const running = await office()
    publishOfficeState(running.status)
    return { status: running.status }
  })

  registry.registerRpc('office.restart', async () => {
    const running = await office()
    const url = await running.restart()
    publishOfficeState(running.status)
    return { url, status: running.status }
  })

  registry.registerRpc('office.stop', async () => {
    const settings = current()
    if (supervisor) {
      supervisor.stop()
      supervisor = null
    }
    activeSupervisor?.stop()
    activeSupervisor = null
    killProcessesOnPort(settings.officePort || DEFAULT_PORT)
    const st = stopped()
    publishOfficeState(st)
    return { status: st }
  })

  registry.registerTool({
    name: 'agent_office',
    description:
      'Open the Agent Office — a 3D office where OpenFox agents sit at desks — or report whether it is running.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => {
      const running = await office()
      if (!running.status.running) {
        const url = await running.ensureRunning()
        return { success: true, output: `Agent Office is up at ${url}` }
      }
      return { success: true, output: `Agent Office is already running at ${running.status.url}` }
    },
  })

  if (current().autoStart) {
    void office()
      .then((running) => running.ensureRunning())
      .then((url) => {
        publishOfficeState(supervisor?.status ?? stopped())
        context.logger.info(`Agent Office auto-started at ${url}`)
      })
      .catch((error: unknown) => {
        context.logger.warn('Could not auto-start Agent Office', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
  } else if (current().launchMode === 'managed') {
    void ensureOffice(context.runtime.configDirectory, current(), context.logger).catch((error: unknown) => {
      context.logger.warn('Could not prepare Agent Office yet', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

export function deactivate(): void {
  const s = activeSettingsGetter ? activeSettingsGetter() : DEFAULT_SETTINGS
  if (s.killOnExit !== false) {
    activeSupervisor?.stop()
    activeSupervisor = null
    killProcessesOnPort(s.officePort || DEFAULT_PORT)
  }
}

function stopped(): OfficeStatus {
  return { running: false, url: null, port: 0, pid: null, startedAt: null, lastError: null }
}
