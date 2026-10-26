// Recent changes per trip, from git: each first-parent commit on the current
// branch that touched a trip's files (a merged PR is one), loaded as it was
// and diffed against the version before. Without git or history (a shallow
// clone, a tarball) there are simply no changes to show.

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

/** `slug` → recent change sets, newest first. */
export function tripChanges(sitePath: string, site: SiteExport): Record<string, ChangeSet[]> {
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
          const [sha, parents, author, date, subject] = line.split('\x1f') as [string, string, string, string, string]
          const merged = parents.split(' ')[1]
          return {
            sha,
            date,
            // A merged PR is its author's change, not the merger's.
            author: merged ? git(root, ['log', '-1', '--format=%an', merged]).trim() : author,
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
  return out
}
