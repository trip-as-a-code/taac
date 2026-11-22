# Getting Started

A taac site is a directory with a `site.yaml` and the trips it lists, usually a git repository of its own. You don't
need anything but Docker to work on one.

## A First Trip

Create `trips/lisbon.yaml`:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/trip-as-a-code/taac/main/schema/trip.v1alpha4.json
apiVersion: taac/v1alpha4
kind: Trip
metadata:
  title: Lisbon Long Weekend
  timezone: Europe/Lisbon
members:
  - { name: Alex }
  - { name: Sam }
spending: # what each of you expects to spend on the spot; 0 is fine
  - { who: [everyone], amount: 0, currency: EUR }
places:
  Castelo de São Jorge: { geo: [38.7139, -9.1335] }
itinerary:
  - kind: activity
    title: Tram 28 and the castle
    who: [everyone]
    start: 2027-05-14T12:00:00+01:00
    end: 2027-05-14T16:00:00+01:00
    places: [Castelo de São Jorge]
```

The first line points editors with the YAML language server (VS Code's YAML extension, for one) at the schema, so they
complete keys and flag mistakes as you type.

Then list the trip in `site.yaml`:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/trip-as-a-code/taac/main/schema/site.v1alpha4.json
apiVersion: taac/v1alpha4
kind: Site
metadata:
  title: Our trips
trips:
  - path: trips/lisbon.yaml
```

## Opening It

The `taac-builder` image runs the website in development mode against your files, and reloads whenever one of them
changes:

```bash
docker run --rm -it -p 4321:4321 -v "$PWD:/site:ro" ghcr.io/trip-as-a-code/taac-builder:latest taac-dev /site/site.yaml
```

Open <http://localhost:4321>. Any problem with a trip shows on its overview page, pointing at the file and line.

## Checking It

`taac validate` checks a site (or a single trip) and exits non-zero on errors, which makes it a good CI step:

```bash
taac validate site.yaml
```

See [Command Line](cli.md) for installing it. Building the site (as `taac-dev` above, or an image as in
[Self-Hosting](self-hosting.md)) also fails on any error, so a site with a broken trip never gets published.

## Next Steps

- [Writing a Trip](trips.md) goes through everything a trip can hold.
- [Sites](sites.md) covers several trips, signing in, and sharing.
- [Self-Hosting](self-hosting.md) puts the site online.
