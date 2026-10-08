/**
 * Matching an office floor to an OpenFox project.
 *
 * A worker runs in the checkout of the floor it sits on, and OpenFox only
 * starts a session inside a project. So the bridge needs the project that
 * owns the worker's directory — created on demand, since the office clones
 * floors the user never registered in OpenFox.
 */

/** The project for a directory, adding it when OpenFox doesn't know it yet. */
export async function ensureProject(
  serverUrl: string,
  token: string | null,
  dir: string,
  name: string,
): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['x-session-token'] = token

  const request = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${serverUrl}${path}`, { ...init, headers })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `OpenFox request failed (${res.status})`)
    }
    return res.json() as Promise<Record<string, never>>
  }

  const listed = (await request('/api/projects')) as unknown as {
    projects?: Array<{ id: string; workdir: string }>
  }
  const match = (listed.projects ?? []).find((p) => p.workdir === dir)
  if (match) return match.id

  // A floor the office cloned is a real checkout, so registering it as a
  // project is right — that is what makes the worker's session possible.
  const created = (await request('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, workdir: dir }),
  })) as unknown as { project?: { id?: string } }
  const id = created.project?.id
  if (!id) throw new Error(`OpenFox did not register ${dir} as a project`)
  return id
}