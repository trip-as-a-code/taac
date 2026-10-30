# taac — Trip as a Code

Declare trips in YAML, review them in pull requests, and publish them as a website, a calendar feed, a map and a
shared ledger. The YAML is the single source of truth; everything else is generated from it.

- **Schema** — `taac/v1alpha4` trip and site files with a published JSON Schema, so editors autocomplete and CI
  validates.
- **CLI** — `taac validate | build | export | schema`, with readable errors that point at the offending line.
- **Website** — a static Astro site for any number of trips: overview, day-by-day itinerary, map, bookings, budget and
  packing list. English and Russian, dark or light, works offline.
- **Edge** — a Cloudflare Worker in front of the site: optional site-wide and per-trip passwords, private calendar
  feeds, live exchange rates, shared packing ticks, strict security headers.

Confidential values (booking references, phone numbers) are never written into a trip. A trip names a secret; only a
local `taac build --reveal` ever resolves it. The website never sees them, password or not.

## Quick start

```sh
mise install          # Rust, Node, wasm-bindgen, task (see the repository's mise.toml)
task install          # npm ci
task web:dev          # the demo site on http://localhost:4321
```

Point it at your own site with `TAAC_SITE=/path/to/site.yaml task web:dev`. The dev server reloads when any trip file
changes.

## A trip

```yaml
# yaml-language-server: $schema=../schema/trip.v1alpha4.json
apiVersion: taac/v1alpha4
kind: Trip
metadata:
  title: Lisbon Long Weekend
  locale: en # language of the trip's own text
  timezone: Europe/Lisbon
  cover: { emoji: 🚋, hue: 28 }
currency:
  base: EUR # totals default to it; viewers can switch, converted at live ECB rates
members:
  - { name: Alex }
  - { name: Sam, currency: GBP } # the money Sam pays with
groups:
  - { name: Early birds, emoji: 🌅, members: [Alex] } # a saved set of people
  - { members: [Sam, Robin] } # no name: shown as "Sam & Robin"; plans list them
bases: # where everyone is each night, planned or not
  - { title: Lisbon, place: Lisbon, from: 2027-05-14, to: 2027-05-16 }
places: # by name; everything else refers to them by it
  Lisbon: { geo: [38.7223, -9.1393], radius: 12000 } # an area: inside it, getting around needs no plan; anywhere else, plans need a journey there
  London Gatwick: { geo: [51.1537, -0.1821], category: airport }
  Lisbon Airport: { geo: [38.7742, -9.1342], category: airport }
  Castelo de São Jorge: { geo: [38.7139, -9.1335], category: historic }
itinerary:
  - kind: flight # flight, train, bus, ferry, transfer, lodging, activity, meal, note
    title: London → Lisbon
    who: [everyone] # names of members and/or groups, or everyone
    start: 2027-05-14T07:05:00+01:00 # always with the local offset
    end: 2027-05-14T09:50:00+01:00
    places: [London Gatwick, Lisbon Airport] # names from `places`, or inline places
    transport: { carrier: TAP Air Portugal, number: TP1337 }
    booking:
      status: booked # required, booked, notRequired, cancelled
      reference: { secret: LISBON_PNR } # resolved from .env / secrets.yaml / env, never published
    costs:
      - { amount: 138, currency: GBP, paidBy: Sam } # split: equal (default), personal, { shares: … }, { exact: … }
      # without paidBy: not paid yet (add estimate: true for a guess); paidBy: each — everyone paid their own part;
      # paid costs count as paid back — settled: false when someone still owes the payer
      # (owedBy: Sam — one person pays back for everyone's share);
      # paid in another currency: charged: { amount: 152.4, currency: EUR } — what left the payer's account
    # Booked separately by different people? Use `bookings:` instead of `booking:` — a list of
    # reservations, each with its own who, status, reference, deadline and costs.
    # The return flight in the same booking: give it the same `reference` and no costs; it is priced here.
  - kind: activity
    title: Tram 28 and the castle
    start: 2027-05-14T12:00:00+01:00
    end: 2027-05-14T16:00:00+01:00
    who: [Early birds, Sam]
    places: [Castelo de São Jorge]
    booking: { status: required, deadline: 2027-05-01 }
    notes: Markdown is **fine** here.
  - kind: activity
    title: Sunset at a miradouro
    who: [everyone]
    date: 2027-05-14 # no fixed time
    part: evening # morning, afternoon, evening
blockers: # time someone is unavailable; plans inside it are flagged
  - title: Work
    who: [Alex]
    periods: [{ from: 2027-05-14, to: 2027-05-17 }]
    days: [mon, tue, wed, thu, fri] # omit for every day
    time: { start: '09:00', end: '17:00', timezone: Europe/London } # omit for whole days
    # strict: true turns warnings into errors; a plan opts out with `overrides: [Work]`
tasks: # to do before, during or after the trip; the date says which
  - title: Get a visa
    who: [Robin]
    required: true # the trip can't go ahead without it: due by the start
    due: 2027-04-01
    done: 2027-03-20 # omit while open
ideas: # proposals: anything that could become a plan, never booked or paid yet
  - title: Fado night in Alfama # no date: suggested on free days nearby
    who: [everyone] # like plans, ideas say who they're for
    area: Lisbon
    priority: must # or maybe (default)
    duration: hour # hour, halfDay, day
    costs: [{ amount: 60, currency: EUR, estimate: true }]
  - title: Pestana Palace # a dated option: shown on that day as proposed
    kind: lodging
    who: [Early birds]
    option: Last night # alternatives share a label; only the cheapest counts as possible spend
    start: 2027-05-16T15:00:00+01:00
    end: 2027-05-17T11:00:00+01:00
    booking: { status: required, deadline: 2027-05-01 } # listed under "Options — decide by"
    costs: [{ amount: 240, currency: EUR, estimate: true }]
packing:
  - category: Essentials
    items: [Passport, { name: Camera, who: [Sam] }, { name: T-shirts, qty: 4, bag: suitcase, notes: … }]
```

Nothing needs an id. People, groups, places and blockers are referred to by name (case doesn't matter); plans, ideas and
bases are identified by their titles. Links to a plan (the copy-link button on each card) follow its title, so renaming
a plan changes its link.

Without `bases`, they are derived from lodging. A trip can also be a directory: one `kind: Trip` file plus any number
of `kind: TripPart` files (bases, places, itinerary chunks, ideas, packing) merged into it — fewer merge conflicts
when several people edit at once. See [`examples/demo`](examples/demo) and the full schema in [`schema/`](schema).

`taac validate` checks what the schema cannot: references, time zones, `end ≥ start`, per-person overlaps (people on
different tracks don't clash; a flat kept while away isn't slept in), overlapping bases, nights nobody accounted for,
moves between bases with no journey taking people there, currencies with rates, splits that add up, and inline `${…}`
that would leak.

## A site

```yaml
# yaml-language-server: $schema=../schema/site.v1alpha4.json
apiVersion: taac/v1alpha4
kind: Site
metadata:
  title: Our trips # or per language: { en: Our trips, ru: Наши поездки }
access: # optional: password-protect the whole site
  password: { secret: SITE_PASSWORD }
source: # optional: link every card and issue to its line
  repo: https://github.com/you/trips # branch: main, dir: '' (site file's folder in the repo)
trips:
  - path: trips/lisbon.yaml
  - path: trips/japan
    access: # optional: and/or one trip
      password: { secret: JAPAN_PASSWORD }
```

`secret` names a Worker secret. Without `access` the site is public. With `source`, cards and issues link to
`<repo>/blob/<branch>/<file>#L<line>`, and issues offer YAML to paste.

## CLI

```sh
cargo run -p taac-cli -- validate site.yaml            # or a trip file / directory
cargo run -p taac-cli -- build site.yaml --out dist    # ICS, GeoJSON, Beancount, Markdown per trip
cargo run -p taac-cli -- build site.yaml --reveal      # …with confidential values, for yourself only
cargo run -p taac-cli -- export site.yaml              # the JSON the website renders
cargo run -p taac-cli -- schema --out schema           # regenerate the JSON Schemas
```

## Deploy your own (Cloudflare Workers)

1. Copy [`wrangler.example.jsonc`](wrangler.example.jsonc) to `wrangler.jsonc` next to your `site.yaml`, adjust the
   name, paths and (optionally) your custom domain.
2. Build: `TAAC_SITE=$PWD/site.yaml task web:build`. Build from a git checkout with history (in CI,
   `fetch-depth: 0`): the overview's "Recent changes" and the "changed since your last visit" dots replay the last 30
   commits that touched each trip.
3. If the site uses `access`, set the secrets once:
   `wrangler secret put SESSION_SECRET` (`openssl rand -hex 32`) and one per password named in `site.yaml`.
4. `wrangler deploy`.

For local testing behind the Worker, put the same secrets in `.dev.vars` and run `wrangler dev`.

With the `PACKING` Durable Object binding (see the example config), packing ticks are shared by everyone on a trip,
behind the trip's password, and merge after offline edits; without it the packing list is read-only.

## How it fits together

```text
trip YAML ──► taac-core (Rust) ──► CLI: validate, ICS/GeoJSON/Beancount/Markdown
                    │
                    └─► WebAssembly (@taac/core) ──► Astro build ──► static site ──► Worker (auth, feeds, fx)
```

- `crates/taac-core` — model (also the JSON Schema source), loader, validation, budgeting, generators, web export.
- `crates/taac-cli` — the `taac` binary.
- `crates/taac-wasm` + `packages/core` — the core for Node, used by the website build.
- `web/` — the Astro site. Pages never import trip data into client bundles; it is rendered into HTML, which the
  Worker can protect.
- `worker/` — the Cloudflare Worker.

Trips change through commits, not through the UI; the one thing the site writes is packing ticks, which are progress,
not plan. A new deploy is offered to open tabs when they regain focus.

## Development

`task --list` shows everything; `task verify` mirrors CI (fmt, clippy, tests, schema freshness, eslint, astro check,
vitest, build). Changes under `taac/` need a changelog fragment: `changie new`.

## License

[MIT](LICENSE)
