# Development

## How It Fits Together

```text
trip YAML ──► taac-core (Rust) ──► CLI: validate, ICS/GeoJSON/Beancount/Markdown
                    │
                    └─► WebAssembly (@taac/core) ──► Astro build ──► static site ──► server
```

- `crates/taac-core`: the model (also where the JSON Schema comes from), loading, validation, budgeting, the generators
  and the export the website is built from.
- `crates/taac-cli`: the `taac` command.
- `crates/taac-wasm` and `packages/core`: the core for Node, which the website build uses.
- `web/`: the Astro site. Trip data is rendered into HTML and never imported into client bundles, so the server can
  keep it behind sign-in.
- `server/`: the Node server, for sign-in, calendar feeds, exchange rates, discussions, ticks and notifications.

Trips change through commits, never through the site, and a new deploy is offered to open tabs when they regain focus.

## Setting Up

The toolchain is pinned in [`mise.toml`](../mise.toml); [mise](https://mise.jdx.dev/) installs it:

```bash
mise install   # Rust, Node, wasm-bindgen and task
task install   # npm ci
task web:dev   # the demo site on http://localhost:4321
```

`TAAC_SITE=/path/to/site.yaml task web:dev` runs it against another site, and it reloads whenever a trip file changes.
`task --list` shows every task.

## Checking Changes

`task verify` runs what CI does: formatting, Clippy, the Rust and TypeScript tests, schema freshness, ESLint, the Astro
and server type checks, Helm linting and a production build. After changing the model in `crates/taac-core`, run
`task schema` to regenerate the JSON Schemas.
