/**
 * Finding OpenFox from the plugin.
 *
 * A plugin is handed a config directory and a mode, but not the URL it is being
 * served from or a session token for it. Both are recoverable from what is
 * already on disk — the same way OpenFox's own `openfox mcp` command recovers
 * them to print a client config.
 */

/** Ports to try: the mode's default, then the increments dev servers take. */
export function portCandidates(mode: 'production' | 'development'): number[] {
  const envPort = Number(process.env['OPENFOX_PORT'] || process.env['PORT'])
  const envCandidates = envPort > 0 ? [envPort] : []
  const base = mode === 'development' ? 10469 : 10369
  const defaultCandidates = Array.from({ length: 12 }, (_, i) => base + i)
  const altBase = mode === 'development' ? 10369 : 10469
  const altCandidates = Array.from({ length: 12 }, (_, i) => altBase + i)
  return [...new Set([...envCandidates, ...defaultCandidates, ...altCandidates])]
}

/** The base URL of a running OpenFox, or null when none answers. */
export async function findOpenFox(candidates: number[]): Promise<string | null> {
  for (const port of candidates) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(400) })
      if (res.ok) return `http://127.0.0.1:${port}`
    } catch {
      // Not this one — keep looking.
    }
  }
  return null
}

/**
 * Mint a session token for OpenFox's network auth.
 *
 * Null when there is no password (local mode needs no token) or the config
 * cannot be read: the bridge then runs unauthenticated, which is exactly right
 * for a local OpenFox.
 */
export async function mintSessionToken(configDirectory: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises')
    const { createHash, createSign, privateDecrypt, constants } = await import('node:crypto')
    const auth = JSON.parse(await readFile(`${configDirectory}/auth.json`, 'utf-8')) as {
      encryptedPassword?: string | null
    }
    if (!auth.encryptedPassword) return null
    const privateKey = await readFile(`${configDirectory}/auth.key`, 'utf-8')

    const data = Buffer.from(auth.encryptedPassword, 'base64')
    let password: string
    try {
      password = privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        data,
      ).toString()
    } catch {
      password = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, data).toString()
    }

    const sign = createSign('SHA256')
    sign.update(createHash('sha256').update(password).digest('hex'))
    sign.end()
    return sign.sign(privateKey, 'base64')
  } catch {
    return null
  }
}
