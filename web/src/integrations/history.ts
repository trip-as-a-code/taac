// Recent changes per trip, from git: each first-parent commit on the current
// branch that touched a trip's files (a merged PR is one), loaded as it was
// and diffed against the version before. Without git or history (a shallow
// clone, a tarball) there are simply no changes to show. Authors are GitHub
// accounts (the trip member with that username, else `@username`), never the
// name on a commit; one GitHub can't place is left unnamed.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

import { exportFiles, type SiteExport, type TripExport } from '@taac/core'

import { diffTrips, type ChangeSet } from '../lib/changes'

const LIMIT = 30
const WANTED = /\.(ya?ml|json|geojson)$/i

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

/** The trip as it was at `sha`, or undefined when that version doesn't load. */
function tripAt(root: string, sha: string, path: string): TripExport | undefined {
  const names = git(root, ['ls-tree', '-r', '--name-only', sha, '--', path])
    .split('\n')
    .filter((n) => WANTED.test(n))
  if (!names.length) return undefined
  const files = Object.fromEntries(names.map((n) => [n, git(root, ['show', `${sha}:${n}`])]))
  const result = exportFiles(files, path)
  return result.ok ? result.export.trips[0] : undefined
}

/** `owner/name` of the GitHub repository: `source.repo`, else the `origin` remote. */
function githubRepo(root: string, site: SiteExport): string | undefined {
  let url = site.site.source?.repo
  try {
    url ??= git(root, ['remote', 'get-url', 'origin']).trim()
  } catch {
    return undefined
  }
  return /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url ?? '')?.[1]
}

/** A token for the GitHub API: CI's, else the local `gh` login; none is fine for public repositories. */
function githubToken(): string | undefined {
  const env = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (env) return env
  try {
    return (
      execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() ||
      undefined
    )
  } catch {
    return undefined
  }
}

/**
 * Names each change by a GitHub account: a merged PR's author; else, as for a
 * commit straight to the branch, the commit's account, or the author of the PR
 * GitHub links the commit to.
 */
async function withAccounts(
  sets: ChangeSet[],
  repo: string,
  members: { name: string; github?: string | null }[],
): Promise<void> {
  const token = githubToken()
  const logins = new Map<string, Promise<string | undefined>>()
  const ask = (path: string, pick: (body: unknown) => string | undefined) => {
    let login = logins.get(path)
    if (!login) {
      login = fetch(`https://api.github.com/repos/${repo}/${path}`, {
        headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(8000),
      })
        .then(async (r) => (r.ok ? pick(await r.json()) : undefined))
        .catch(() => undefined)
      logins.set(path, login)
    }
    return login
  }
  await Promise.all(
    sets.map(async (set) => {
      type Account = { login?: string } | null | undefined
      const login =
        (set.pr && (await ask(`pulls/${set.pr}`, (b) => (b as { user?: Account }).user?.login))) ||
        (await ask(`commits/${set.sha}`, (b) => (b as { author?: Account }).author?.login)) ||
        (await ask(`commits/${set.sha}/pulls`, (b) => (b as { user?: Account }[])[0]?.user?.login))
      if (!login) return
      set.login = login.toLowerCase()
      set.author = members.find((m) => m.github?.toLowerCase() === login.toLowerCase())?.name ?? `@${login}`
    }),
  )
}

/** `slug` → recent change sets, newest first. */
export async function tripChanges(sitePath: string, site: SiteExport): Promise<Record<string, ChangeSet[]>> {
  const dir = dirname(sitePath)
  let root: string
  try {
    root = git(dir, ['rev-parse', '--show-toplevel']).trim()
  } catch {
    return {}
  }
  // Trip paths as site.yaml lists them, in the order the export keeps.
  const listed = [...readFileSync(sitePath, 'utf8').matchAll(/^\s*-\s*path:\s*(\S+)\s*$/gm)].map((m) => m[1]!)
  const out: Record<string, ChangeSet[]> = {}
  const repo = githubRepo(root, site)
  site.trips.forEach((trip, index) => {
    const listedPath = listed[index]
    if (!listedPath) return
    const path = relative(root, resolve(dir, listedPath)).split(sep).join('/')
    try {
      const log = git(root, [
        'log',
        '--first-parent',
        `-n${LIMIT + 1}`,
        '--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s',
        'HEAD',
        '--',
        path,
      ])
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [sha, , , date, subject] = line.split('\x1f') as [string, string, string, string, string]
          return {
            sha,
            date,
            // Named by its GitHub account below; the commit's own name is never shown.
            author: '',
            pr: Number(/^Merge pull request #(\d+)/.exec(subject)?.[1]) || undefined,
          }
        })
      const versions = log.map((c) => tripAt(root, c.sha, path))
      const sets: ChangeSet[] = []
      for (let i = 0; i < Math.min(log.length, LIMIT); i++) {
        const after = versions[i]
        const before = versions[i + 1]
        if (!after || !before) continue
        const events = diffTrips(before, after)
        if (events.length) sets.push({ ...log[i]!, events })
      }
      out[trip.slug] = sets
    } catch {
      out[trip.slug] = []
    }
  })
  if (repo) await Promise.all(site.trips.map((trip) => withAccounts(out[trip.slug] ?? [], repo, trip.members)))
  return out
}
