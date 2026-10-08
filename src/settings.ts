import type { PluginSettingsSchema, PluginSettingValue } from './types.js'

export type LaunchMode = 'managed' | 'global' | 'local'

export const SETTINGS: PluginSettingsSchema = {
  fields: [
    {
      section: { en: 'Display', fr: 'Affichage' },
      key: 'showHeaderButton',
      type: 'boolean',
      label: { en: 'Header button', fr: 'Bouton dans l’en-tête' },
      description: {
        en: 'Display a direct quick-access button to Agent Office in the top navigation header.',
        fr: 'Afficher un bouton d’accès rapide direct à Agent Office dans l’en-tête supérieur.',
      },
      default: false,
    },
    {
      section: { en: 'Lifecycle & Process Management', fr: 'Cycle de vie et gestion du processus' },
      key: 'killOnExit',
      type: 'boolean',
      label: { en: 'Kill Agent Office when OpenFox is closed', fr: 'Fermer Agent Office à la fermeture d’OpenFox' },
      description: {
        en: 'Automatically terminate the Agent Office subprocess and free the port when OpenFox shuts down or exits.',
        fr: 'Arrête automatiquement le sous-processus Agent Office et libère le port lorsque OpenFox s’arrête ou se ferme.',
      },
      default: true,
    },
    {
      key: 'autoStart',
      type: 'boolean',
      label: { en: 'Auto-start Agent Office', fr: 'Lancer automatiquement Agent Office' },
      description: {
        en: 'Automatically start Agent Office in the background when OpenFox is launched.',
        fr: 'Démarrer automatiquement Agent Office en arrière-plan au lancement d’OpenFox.',
      },
      default: true,
    },
    {
      section: { en: 'Installation & Launch Mode', fr: 'Mode d’installation et de lancement' },
      key: 'launchMode',
      type: 'select',
      label: { en: 'Agent Office source', fr: 'Source d’Agent Office' },
      description: {
        en: 'Choose how Agent Office is provided: managed by OpenFox, using an existing globally installed command, or from a local cloned directory.',
        fr: 'Choisissez comment Agent Office est fourni : géré par OpenFox, via une commande installée globalement ou depuis un dossier local cloné.',
      },
      options: [
        {
          value: 'managed',
          label: { en: 'Managed by OpenFox (Automatic install)', fr: 'Géré par OpenFox (Installation automatique)' },
        },
        {
          value: 'global',
          label: { en: 'Already installed command (Global CLI)', fr: 'Commande déjà installée (CLI globale)' },
        },
        {
          value: 'local',
          label: { en: 'Local folder (Cloned repository)', fr: 'Dossier local (Dépôt cloné)' },
        },
      ],
      default: 'managed',
    },
    {
      key: 'officeDir',
      type: 'path',
      label: { en: 'Local repository folder', fr: 'Dossier local du dépôt' },
      description: {
        en: 'Path to your local cloned Agent Office repository (used when source is "Local folder").',
        fr: 'Chemin vers le dépôt Agent Office cloné localement (utilisé quand la source est "Dossier local").',
      },
      default: '',
    },
    {
      key: 'officeCommand',
      type: 'text',
      label: { en: 'Installed command / CLI path', fr: 'Commande installée / Chemin CLI' },
      description: {
        en: 'Command name or executable path to run Agent Office (used when source is "Already installed command").',
        fr: 'Nom de la commande ou chemin de l’exécutable pour lancer Agent Office (utilisé quand la source est "Commande déjà installée").',
      },
      default: 'agent-office',
    },
    {
      key: 'officeStatus',
      type: 'status',
      label: { en: 'Installation status', fr: 'Statut de l’installation' },
      description: {
        en: 'Checks if Agent Office is installed and ready to run.',
        fr: 'Vérifie si Agent Office est installé et prêt à être lancé.',
      },
      rpcMethod: 'office.checkStatus',
    },
    {
      key: 'officeInstall',
      type: 'button',
      label: { en: 'Install / Rebuild Agent Office', fr: 'Installer / Reconstruire Agent Office' },
      buttonLabel: { en: 'Install now', fr: 'Installer maintenant' },
      buttonVariant: 'primary',
      description: {
        en: 'Clone and build the latest Agent Office in the OpenFox configuration directory.',
        fr: 'Cloner et compiler la dernière version d’Agent Office dans le dossier de configuration OpenFox.',
      },
      rpcMethod: 'office.install',
      visibleWhen: { eq: { launchMode: 'managed' } },
    },
    {
      key: 'officeRebuild',
      type: 'button',
      label: { en: 'Rebuild from source', fr: 'Reconstruire depuis la source' },
      buttonLabel: { en: 'Rebuild now', fr: 'Reconstruire maintenant' },
      buttonVariant: 'secondary',
      description: {
        en: 'Recompile Agent Office from source files.',
        fr: 'Recompiler Agent Office depuis les fichiers sources.',
      },
      rpcMethod: 'office.rebuild',
      visibleWhen: { eq: { launchMode: 'managed' } },
    },
    {
      section: { en: 'Server Configuration', fr: 'Configuration du serveur' },
      key: 'officeHost',
      type: 'text',
      label: { en: 'Office host', fr: 'Hôte du bureau' },
      description: {
        en: 'Host/IP address the office listens on (e.g. 127.0.0.1 for local only, 0.0.0.0 for LAN access).',
        fr: 'Adresse hôte/IP sur laquelle le bureau écoute (ex. 127.0.0.1 pour local uniquement, 0.0.0.0 pour accès réseau).',
      },
      default: '127.0.0.1',
    },
    {
      key: 'officePort',
      type: 'number',
      label: { en: 'Office port', fr: 'Port du bureau' },
      description: {
        en: 'Port the office listens on. 0 picks a free one.',
        fr: 'Port sur lequel le bureau écoute. 0 en choisit un libre.',
      },
      default: 0,
    },
    {
      key: 'officePassword',
      type: 'password',
      label: { en: 'Office password', fr: 'Mot de passe du bureau' },
      description: {
        en: 'Leave empty to let the office generate one and keep it in its own data directory.',
        fr: 'Videz pour que le bureau en génère un et le conserve dans son propre répertoire de données.',
      },
      secret: true,
      default: '',
    },
  ],
}

export interface OfficeSettings {
  showHeaderButton: boolean
  killOnExit: boolean
  autoStart: boolean
  launchMode: LaunchMode
  officeDir: string
  officeCommand: string
  officeHost: string
  officePort: number
  officePassword: string
}

export const DEFAULT_SETTINGS: OfficeSettings = {
  showHeaderButton: false,
  killOnExit: true,
  autoStart: true,
  launchMode: 'managed',
  officeDir: '',
  officeCommand: 'agent-office',
  officeHost: '127.0.0.1',
  officePort: 0,
  officePassword: '',
}

export function readSettings(raw: Record<string, PluginSettingValue | undefined>): OfficeSettings {
  const showHeader = raw['showHeaderButton'] === true || raw['showInHeader'] === true || raw['headerButton'] === true
  const killOnExit = raw['killOnExit'] !== undefined ? raw['killOnExit'] === true : DEFAULT_SETTINGS.killOnExit
  const autoStart = raw['autoStart'] !== undefined ? raw['autoStart'] === true : DEFAULT_SETTINGS.autoStart
  const rawMode = typeof raw['launchMode'] === 'string' ? raw['launchMode'].trim().toLowerCase() : ''
  const launchMode: LaunchMode =
    rawMode === 'global' || rawMode === 'command' || rawMode === 'installed'
      ? 'global'
      : rawMode === 'local' || rawMode === 'custom'
        ? 'local'
        : 'managed'
  const dir = typeof raw['officeDir'] === 'string' ? raw['officeDir'].trim() : DEFAULT_SETTINGS.officeDir
  const cmd =
    typeof raw['officeCommand'] === 'string' && raw['officeCommand'].trim()
      ? raw['officeCommand'].trim()
      : DEFAULT_SETTINGS.officeCommand
  const host =
    typeof raw['officeHost'] === 'string' && raw['officeHost'].trim()
      ? raw['officeHost'].trim()
      : process.env['AGENT_OFFICE_HOST']?.trim() || DEFAULT_SETTINGS.officeHost
  const port = Number(raw['officePort'])
  const password = typeof raw['officePassword'] === 'string' ? raw['officePassword'] : DEFAULT_SETTINGS.officePassword

  return {
    showHeaderButton: showHeader,
    killOnExit,
    autoStart,
    launchMode,
    officeDir: dir,
    officeCommand: cmd,
    officeHost: host,
    officePort: Number.isFinite(port) && port >= 0 && port <= 65535 ? Math.floor(port) : DEFAULT_SETTINGS.officePort,
    officePassword: password,
  }
}
