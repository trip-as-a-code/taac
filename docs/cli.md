# Command Line

The `taac` command checks trips and builds everything except the website from them.

## Installing

Build it from source with Rust (the version is in the repository's `mise.toml`):

```bash
cargo install --git https://github.com/trip-as-a-code/taac taac-cli
```

Prebuilt binaries for Linux and macOS come with each [release](https://github.com/trip-as-a-code/taac/releases), and
[mise](https://mise.jdx.dev/) installs them with `mise use github:trip-as-a-code/taac`.

## Commands

```bash
taac validate site.yaml            # or a single trip file or directory
taac validate site.yaml --online   # also verify routes via configured Extism plugins
taac route plan --from 38.7058,-9.1445 --to 38.6975,-9.2032 --time 2026-11-30T09:00:00+00:00
taac route check site.yaml         # check scheduled transit/walk/ride legs online
taac build site.yaml --out dist    # ICS, GeoJSON, Beancount and Markdown for each trip
taac build site.yaml --reveal      # the same, with confidential values filled in, for yourself only
taac export site.yaml              # the JSON the website is built from
taac schema --out schema           # the JSON Schemas for trip and site files
```

`validate` prints every problem with the file and line it's on, and exits non-zero if any of them is an error, which
makes it a good CI step. It is strictly offline by default; pass `--online` (or use `taac route plan` / `taac route check`)
to run sandboxed [Extism plugins](plugins.md).

`build` writes, for each trip, a calendar (`.ics`), a map (`.geojson`), a [Beancount](https://beancount.github.io/)
ledger and a Markdown itinerary, each for the whole trip and for every person and group. `--reveal` resolves
`{ secret: NAME }` values from `.env`, `secrets.yaml` or the environment; keep its output to yourself.
