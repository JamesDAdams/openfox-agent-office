import { describe, expect, it, vi } from 'vitest'
import { buildHeaderButton, register } from './index.js'
import type { PluginRegistry, PluginUiComponent } from './types.js'

function createRegistry(settings: Record<string, string | number | boolean> = {}) {
  const calls: Record<string, unknown[]> = {}
  const record = (key: string) => (value: unknown) => {
    calls[key] = [...(calls[key] ?? []), value]
  }
  const rpcHandlers = new Map<string, (params?: any, context?: any) => Promise<any> | any>()

  const registry = {
    context: {
      id: 'openfox-agent-office',
      version: '1.0.0',
      runtime: { mode: 'development' as const, configDirectory: '/tmp/openfox-agent-office-test' },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      storage: { get: () => undefined, set: vi.fn() },
      settings: () => settings,
      notify: vi.fn(),
      publish: vi.fn(),
    },
    registerTool: record('tool'),
    registerCommand: record('command'),
    registerSettings: record('settings'),
    registerUiAction: record('uiAction'),
    registerUiComponent: record('uiComponent'),
    registerUiPanel: record('uiPanel'),
    registerRpc: (method: string, handler: any) => {
      record('rpc')(method)
      rpcHandlers.set(method, handler)
    },
  }
  return { registry, calls, rpcHandlers }
}

describe('openfox-agent-office', () => {
  it('builds a header button when enabled, and empty stack when disabled', () => {
    const enabledNode = buildHeaderButton(true)
    expect(enabledNode.type).toBe('button')
    expect(enabledNode['id']).toBe('agent-office-header-btn')
    expect(enabledNode['onActivate']).toEqual({ kind: 'rpc', method: 'office.open' })

    const disabledNode = buildHeaderButton(false)
    expect(disabledNode.type).toBe('stack')
    expect(disabledNode['children']).toEqual([])
  })

  it('puts its own row in the plugins menu, opening the status and control modal', async () => {
    const { registry, calls } = createRegistry()
    await register(registry as unknown as PluginRegistry)

    const action = (calls.uiAction as Array<{ id: string; slot: string; onActivate: { kind: string; method: string } }>)[0]!
    expect(action.id).toBe('open-office')
    expect(action.slot).toBe('plugin.menu')
    expect(action.onActivate).toEqual({ kind: 'rpc', method: 'office.showPanel' })

    const panels = calls.uiPanel as Array<{ id: string; kind: string }>
    expect(panels.some((p) => p.id === 'office-panel')).toBe(true)
  })

  it('registers a UI component in header.actions zone with dynamic RPC contentSource', async () => {
    const { registry, calls, rpcHandlers } = createRegistry({ showHeaderButton: true })
    await register(registry as unknown as PluginRegistry)

    const components = calls.uiComponent as PluginUiComponent[]
    expect(components).toHaveLength(1)
    expect(components[0]?.id).toBe('agent-office-header-btn')
    expect(components[0]?.zone).toBe('header.actions')
    expect(components[0]?.contentSource).toEqual({
      kind: 'rpc',
      method: 'office.getHeaderButton',
      refreshMs: 2000,
    })

    const headerRpc = rpcHandlers.get('office.getHeaderButton')
    expect(headerRpc).toBeDefined()
    const result = (await headerRpc?.()) as { content: { type: string } }
    expect(result.content.type).toBe('button')
  })

  it('registers the office RPC methods and the agent_office tool', async () => {
    const { registry, calls } = createRegistry()
    await register(registry as unknown as PluginRegistry)

    const methods = (calls.rpc as string[])
    expect(methods).toEqual(
      expect.arrayContaining([
        'office.open',
        'office.status',
        'office.restart',
        'office.stop',
        'office.showPanel',
        'office.startPanel',
        'office.stopPanel',
        'office.openTab',
        'office.getHeaderButton',
        'office.checkStatus',
        'office.install',
      ]),
    )
    expect((calls.tool as Array<{ name: string }>).map((t) => t.name)).toEqual(['agent_office'])
  })

  it('declares the settings the office needs, and asks for nothing it cannot use', async () => {
    const { registry, calls } = createRegistry()
    await register(registry as unknown as PluginRegistry)

    const schema = (calls.settings as Array<{ fields: Array<{ key: string; type: string }> }>)[0]!
    const byKey = new Map(schema.fields.map((f) => [f.key, f.type]))
    expect(byKey.get('showHeaderButton')).toBe('boolean')
    expect(byKey.get('launchMode')).toBe('select')
    expect(byKey.get('officeDir')).toBe('path')
    expect(byKey.get('officeCommand')).toBe('text')
    expect(byKey.get('officeStatus')).toBe('status')
    expect(byKey.get('officeInstall')).toBe('button')
    expect(byKey.get('officeRebuild')).toBe('button')
    expect(byKey.get('officeHost')).toBe('text')
    expect(byKey.get('officePort')).toBe('number')
    expect(byKey.get('officePassword')).toBe('password')
  })

  it('hides officeInstall and officeRebuild when launchMode is not managed', async () => {
    const localReg = createRegistry({ launchMode: 'local' })
    await register(localReg.registry as unknown as PluginRegistry)
    const localSchema = (localReg.calls.settings as Array<{ fields: Array<{ key: string; type: string }> }>)[0]!
    const localKeys = localSchema.fields.map((f) => f.key)
    expect(localKeys).not.toContain('officeInstall')
    expect(localKeys).not.toContain('officeRebuild')

    const globalReg = createRegistry({ launchMode: 'global' })
    await register(globalReg.registry as unknown as PluginRegistry)
    const globalSchema = (globalReg.calls.settings as Array<{ fields: Array<{ key: string; type: string }> }>)[0]!
    const globalKeys = globalSchema.fields.map((f) => f.key)
    expect(globalKeys).not.toContain('officeInstall')
    expect(globalKeys).not.toContain('officeRebuild')

    const managedReg = createRegistry({ launchMode: 'managed' })
    await register(managedReg.registry as unknown as PluginRegistry)
    const managedSchema = (managedReg.calls.settings as Array<{ fields: Array<{ key: string; type: string }> }>)[0]!
    const managedKeys = managedSchema.fields.map((f) => f.key)
    expect(managedKeys).toContain('officeInstall')
    expect(managedKeys).toContain('officeRebuild')
  })

  it('handles office.checkStatus and returns installed status with text and statusTone', async () => {
    const { registry, rpcHandlers } = createRegistry({ launchMode: 'managed' })
    await register(registry as unknown as PluginRegistry)

    const checkStatus = rpcHandlers.get('office.checkStatus')
    expect(checkStatus).toBeDefined()
    const res = (await checkStatus?.()) as { installed: boolean; running: boolean; message: string; text: string; statusTone: string }
    expect(typeof res.installed).toBe('boolean')
    expect(typeof res.running).toBe('boolean')
    expect(typeof res.message).toBe('string')
    expect(typeof res.text).toBe('string')
    expect(res.statusTone).toBe(res.installed ? 'success' : 'danger')
  })
})
