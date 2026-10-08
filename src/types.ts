export type LocalizedString = { en: string; fr: string }

export type PluginSettingValue = string | number | boolean

export type PluginSettingScope = 'global' | 'project'

export interface PluginSettingsOption {
  value: string
  label: LocalizedString
}

export interface PluginSettingsField {
  key: string
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea' | 'path' | 'button' | 'status' | 'list'
  label: LocalizedString
  description?: LocalizedString
  default?: PluginSettingValue
  options?: PluginSettingsOption[]
  section?: LocalizedString
  secret?: boolean
  buttonLabel?: LocalizedString
  buttonVariant?: 'default' | 'primary' | 'secondary' | 'danger' | 'ghost'
  rpcMethod?: string
  visibleWhen?: { eq?: Record<string, unknown>; neq?: Record<string, unknown> }
}

export interface PluginSettingsSchema {
  fields: PluginSettingsField[]
}

export type PluginActivation =
  | { kind: 'rpc'; method: string; params?: Record<string, unknown> }
  | { kind: 'openPanel'; panelId: string }
  | { kind: 'closePanel' }
  | { kind: 'openSettings'; tab?: string }
  | { kind: 'openUrl'; url: string }

export interface PluginUiAction {
  id: string
  pluginId?: string
  slot: string
  label: LocalizedString
  icon?: string
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  tooltip?: LocalizedString
  onActivate: PluginActivation
}

export interface DeclarativeNode {
  type: string
  [key: string]: unknown
}

export interface PluginUiContentSource {
  kind?: 'rpc'
  method: string
  refreshMs?: number
}

export interface PluginUiComponent {
  id: string
  pluginId?: string
  zone: string
  position?: 'inside' | 'before' | 'after'
  order?: number
  visibleWhen?: Record<string, unknown>
  contentSource?: PluginUiContentSource
  component: DeclarativeNode
}

export interface PluginToolContext {
  sessionId: string
  workdir: string
  projectId?: string
  signal?: AbortSignal
}

export interface PluginToolResult {
  success: boolean
  output?: string
  error?: string
}

export interface PluginTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>, context: PluginToolContext) => Promise<PluginToolResult>
}

export interface PluginLogger {
  debug: (message: string, context?: Record<string, unknown>) => void
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

export interface PluginRuntime {
  readonly mode: 'production' | 'development'
  readonly configDirectory: string
}

export interface PluginContext {
  readonly id: string
  readonly version: string
  readonly runtime: PluginRuntime
  readonly logger: PluginLogger
  readonly storage: {
    get(key: string): PluginSettingValue | undefined
    set(key: string, value: PluginSettingValue): void
  }
  settings(scope?: PluginSettingScope, projectId?: string): Record<string, PluginSettingValue>
  notify(request: {
    title: LocalizedString
    body?: LocalizedString
    level?: 'info' | 'success' | 'warning' | 'error'
  }): void
  publish(panelId: string | undefined, key: string, value: unknown): void
}

export type PluginRpcHandler = (
  params: Record<string, unknown>,
  context: PluginToolContext,
) => unknown | Promise<unknown>

export interface PluginUiPanel {
  id: string
  title: LocalizedString
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full'
  kind: 'declarative' | 'iframe'
  content?: DeclarativeNode[]
  url?: string
}

export interface PluginRegistry {
  readonly context: PluginContext
  registerTool(tool: PluginTool): void
  registerCommand(command: { id: string; name: string; prompt: string; agentMode?: string }): void
  registerSettings(schema: PluginSettingsSchema): void
  registerUiAction(action: PluginUiAction): void
  registerUiComponent(component: PluginUiComponent): void
  registerUiPanel(panel: PluginUiPanel): void
  registerRpc(method: string, handler: PluginRpcHandler): void
}
