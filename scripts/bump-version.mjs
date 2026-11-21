#!/usr/bin/env node
// Synchronize the release version across Cargo, npm workspaces, and the Helm chart.
// Usage: node scripts/bump-version.mjs <version>

import { readFileSync, writeFileSync } from 'node:fs'

const rawVersion = process.argv[2]
if (!rawVersion) {
  console.error('Usage: node scripts/bump-version.mjs <version>')
  process.exit(1)
}
const version = rawVersion.replace(/^v/, '')
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid semver version: ${rawVersion}`)
  process.exit(1)
}

function replaceOnce(path, pattern, replacement) {
  const before = readFileSync(path, 'utf8')
  const after = before.replace(pattern, replacement)
  if (before === after) {
    throw new Error(`Expected pattern ${pattern} not found in ${path}`)
  }
  writeFileSync(path, after)
}

// 1. Workspace Cargo.toml (workspace.package.version + taac-core workspace dependency)
replaceOnce('Cargo.toml', /^(\[workspace\.package\]\nversion = ")[^"]+(")/m, `$1${version}$2`)
replaceOnce('Cargo.toml', /^(taac-core = \{ path = "crates\/taac-core", version = ")[^"]+(" \})/m, `$1${version}$2`)

// 2. npm workspace package.json files
for (const file of ['package.json', 'packages/core/package.json', 'web/package.json', 'server/package.json']) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  pkg.version = version
  if (pkg.dependencies?.['@taac/core']) {
    pkg.dependencies['@taac/core'] = version
  }
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
}

// 3. Helm chart version & appVersion
replaceOnce('deploy/helm/taac/Chart.yaml', /^(version: ).+$/m, `$1${version}`)
replaceOnce('deploy/helm/taac/Chart.yaml', /^(appVersion: ).+$/m, `$1${version}`)

console.log(`Updated manifests to version ${version}`)
