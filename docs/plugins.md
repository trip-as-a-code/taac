# Plugins

The `taac` CLI supports sandboxed WebAssembly plugins powered by [Extism](https://extism.org). Offline builds, `taac validate` (without `--online`), and the static website (`taac-wasm`) never load plugins or make network calls.

## Transitous Route Provider

`plugins/transitous` is the first official plugin. It connects to the [Transitous API](https://transitous.org/api/) (powered by MOTIS 2) to:

- **Plan routes** (`taac route plan`) and print ready-to-paste `taac/v1alpha4` YAML (`places:` and `itinerary:`).
- **Verify scheduled legs** (`taac route check` and `taac validate --online`): checks that a connection exists at the declared time, compares duration, matches `transport.carrier` and `transport.number`, handles far-future dates outside GTFS coverage gracefully, and suggests alternative departures when a route has changed.

### Building the Plugin

```bash
task plugins
```

This compiles `plugins/transitous` to `wasm32-unknown-unknown` and places the binary at `plugins/dist/transitous.wasm`.

### Configuring Plugins in `site.yaml`

You can declare plugins in `site.yaml` (optional; CLI flags like `--plugin` work without modifying `site.yaml`):

```yaml
apiVersion: taac/v1alpha4
kind: Site
metadata:
  title: Our trips
plugins:
  transitous:
    path: ../../plugins/dist/transitous.wasm
    allowedHosts:
      - api.transitous.org
    config:
      # Optional: append your contact info to the User-Agent header
      contact: you@example.org
      # Optional: point to a self-hosted MOTIS instance or staging
      # baseUrl: https://staging.api.transitous.org/api
trips:
  - path: trips/lisbon.yaml
```

### Usage Examples

Plan a route using place names from a trip (or raw `lat,lon` coordinates):

```bash
taac route plan \
  --trip examples/demo/site.yaml \
  --from "Cais do Sodré" \
  --to "Belém" \
  --time 2026-11-30T09:00:00+00:00
```

Check all scheduled transit/walk/ride legs in a site or trip:

```bash
taac route check examples/demo/site.yaml
```

Run both offline validation and online route verification together:

```bash
taac validate examples/demo/site.yaml --online
```

## Transitous Terms of Use & Fair-Use Safeguards

The public Transitous service (`https://api.transitous.org/api/`) is community-run for **free, open-source, non-commercial** projects. To stay compliant:

- **Non-commercial use only**: Do not point commercial deployments at `api.transitous.org`. Set `config.baseUrl` (or `--base-url`) to your own MOTIS instance instead.
- **Mandatory `User-Agent`**: `taac` automatically sends `taac/<version> (+https://github.com/trip-as-a-code/taac)` on every request; you can append your own contact via `--contact` or `config.contact`.
- **Attribution**: Every CLI invocation prints attribution linking to [Transitous Sources](https://transitous.org/sources/) (and OpenStreetMap).
- **Resource protection**:
  - Responses are cached locally for 24 hours (`$XDG_CACHE_HOME/taac/plugins` or `~/.cache/taac/plugins`).
  - Live requests are paced (250 ms minimum spacing) and capped per run (`--max-requests`, default `50`).
  - A rolling 24-hour counter warns at 500 requests and stops at 700 requests against `api.transitous.org` (below Transitous's 720 requests / 24h coordination threshold).
- **Sandbox**: Extism blocks all network access except hostnames explicitly listed in `allowedHosts` (wildcards `*` are rejected).
