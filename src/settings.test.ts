import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, readSettings, SETTINGS } from './settings.js'
import { portCandidates } from './discover.js'

describe('readSettings', () => {
  it('falls back to the office defaults when nothing is set', () => {
    expect(readSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('reads showHeaderButton setting and aliases', () => {
    expect(readSettings({ showHeaderButton: true }).showHeaderButton).toBe(true)
    expect(readSettings({ showInHeader: true }).showHeaderButton).toBe(true)
    expect(readSettings({ headerButton: true }).showHeaderButton).toBe(true)
    expect(readSettings({ showHeaderButton: false }).showHeaderButton).toBe(false)
  })

  it('reads launchMode and falls back to managed for unknown values', () => {
    expect(readSettings({ launchMode: 'managed' }).launchMode).toBe('managed')
    expect(readSettings({ launchMode: 'global' }).launchMode).toBe('global')
    expect(readSettings({ launchMode: 'command' }).launchMode).toBe('global')
    expect(readSettings({ launchMode: 'installed' }).launchMode).toBe('global')
    expect(readSettings({ launchMode: 'local' }).launchMode).toBe('local')
    expect(readSettings({ launchMode: 'custom' }).launchMode).toBe('local')
    expect(readSettings({ launchMode: 'invalid' }).launchMode).toBe('managed')
  })

  it('trims the checkout path and ignores a port that is not one', () => {
    expect(readSettings({ officeDir: '  /src/agent-office  ', officePort: 4600 })).toMatchObject({
      officeDir: '/src/agent-office',
      officePort: 4600,
    })
    for (const port of [0, -1, 70000, Number.NaN]) {
      expect(readSettings({ officePort: port }).officePort).toBe(0)
    }
  })

  it('reads custom officeHost or falls back to AGENT_OFFICE_HOST env var then 127.0.0.1', () => {
    expect(readSettings({ officeHost: '  0.0.0.0  ' }).officeHost).toBe('0.0.0.0')
    expect(readSettings({ officeHost: '192.168.1.50' }).officeHost).toBe('192.168.1.50')
    expect(readSettings({}).officeHost).toBe('127.0.0.1')
  })

  it('reads custom officeCommand', () => {
    expect(readSettings({ officeCommand: '  /custom/bin/agent-office  ' }).officeCommand).toBe(
      '/custom/bin/agent-office',
    )
  })

  it('keeps the password verbatim, spaces and all', () => {
    expect(readSettings({ officePassword: ' correct horse ' }).officePassword).toBe(' correct horse ')
  })

  it('reads killOnExit and autoStart settings with true as default', () => {
    expect(readSettings({}).killOnExit).toBe(true)
    expect(readSettings({}).autoStart).toBe(true)
    expect(readSettings({ killOnExit: false }).killOnExit).toBe(false)
    expect(readSettings({ autoStart: false }).autoStart).toBe(false)
    expect(readSettings({ killOnExit: true }).killOnExit).toBe(true)
    expect(readSettings({ autoStart: true }).autoStart).toBe(true)
  })

  it('defines settings schema with sections and all required fields', () => {
    const keys = SETTINGS.fields.map((f) => f.key)
    expect(keys).toContain('showHeaderButton')
    expect(keys).toContain('killOnExit')
    expect(keys).toContain('autoStart')
    expect(keys).toContain('launchMode')
    expect(keys).toContain('officeDir')
    expect(keys).toContain('officeCommand')
    expect(keys).toContain('officeStatus')
    expect(keys).toContain('officeInstall')
    expect(keys).toContain('officePort')
    expect(keys).toContain('officePassword')

    const launchModeField = SETTINGS.fields.find((f) => f.key === 'launchMode')
    expect(launchModeField?.type).toBe('select')
    expect(launchModeField?.options?.map((o) => o.value)).toEqual(['managed', 'global', 'local'])
  })
})

describe('portCandidates', () => {
  it('tries the mode default then the increments a dev server takes', () => {
    expect(portCandidates('production')[0]).toBe(10369)
    expect(portCandidates('development')[0]).toBe(10469)
    expect(portCandidates('development')).toContain(10470)
  })
})
