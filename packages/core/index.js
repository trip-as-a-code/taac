// Node entry: reads a site (or trip) from disk and runs the Rust core on it.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import * as wasm from './pkg/taac.js'

let initialised = false
function init() {
  if (!initialised) {
    wasm.initSync({ module: readFileSync(new URL('./pkg/taac_bg.wasm', import.meta.url)) })
    initialised = true
  }
}

const WANTED = /\.(ya?ml|json|geojson)$/i
const SKIP = new Set(['node_modules', 'target', 'dist'])

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (WANTED.test(entry.name)) out.push(path)
  }
}

/**
 * Collects exactly the files a site or trip needs, keyed relative to the
 * input's directory. Returns the files plus every path read, so callers can
 * watch them.
 */
export function collectFiles(inputPath) {
  init()
  const input = resolve(inputPath)
  const root = dirname(input)
  const paths = []
  const add = (path) => paths.push(path)

  if (statSync(input).isDirectory()) {
    walk(input, paths)
  } else {
    add(input)
    const content = readFileSync(input, 'utf8')
    const isSite = /^kind:\s*Site\s*$/m.test(content)
    const trips = isSite ? wasm.siteTripPaths(content).map((p) => resolve(root, p)) : []
    for (const trip of trips) {
      if (!existsSync(trip)) continue
      if (statSync(trip).isDirectory()) walk(trip, paths)
      else {
        add(trip)
        for (const overlay of wasm.overlayPaths(readFileSync(trip, 'utf8'))) add(resolve(dirname(trip), overlay))
      }
    }
    if (!isSite) for (const overlay of wasm.overlayPaths(content)) add(resolve(root, overlay))
  }

  const files = {}
  for (const path of paths) {
    if (existsSync(path)) files[relative(root, path).split(sep).join('/')] = readFileSync(path, 'utf8')
  }
  return { files, key: relative(root, input).split(sep).join('/') || '.', paths, root }
}

/** Loads, validates and exports a site file or trip path for the web. */
export function exportSite(inputPath) {
  const { files, key, paths } = collectFiles(inputPath)
  return { ...JSON.parse(wasm.exportSite(JSON.stringify(files), key)), paths }
}

/** Diagnostics only. */
export function validate(inputPath) {
  const { files, key } = collectFiles(inputPath)
  return JSON.parse(wasm.validate(JSON.stringify(files), key))
}

export function version() {
  init()
  return wasm.version()
}
