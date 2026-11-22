<!-- markdownlint-disable -->
<div id="top"></div>

<div align="center">
  <a href="https://github.com/trip-as-a-code/taac/graphs/contributors">
    <img src="https://img.shields.io/github/contributors/trip-as-a-code/taac.svg?style=for-the-badge" alt="Contributors" height="28">
  </a>
  <a href="https://github.com/trip-as-a-code/taac/stargazers">
    <img src="https://img.shields.io/github/stars/trip-as-a-code/taac.svg?style=for-the-badge" alt="Stars" height="28">
  </a>
  <a href="https://github.com/trip-as-a-code/taac/issues">
    <img src="https://img.shields.io/github/issues/trip-as-a-code/taac.svg?style=for-the-badge" alt="Issues" height="28">
  </a>
  <a href="https://github.com/trip-as-a-code/taac/blob/main/LICENSE.md">
    <img src="https://img.shields.io/github/license/trip-as-a-code/taac.svg?style=for-the-badge" alt="License" height="28">
  </a>
  <br>
  <br>
  <a href="https://github.com/trip-as-a-code/taac">
    <img src="web/public/icons/icon.svg" alt="Logo" width="128" height="128">
  </a>
  <h3>taac</h3>
  <p>Trip as a Code: plan trips in YAML, publish them as a website.</p>
  <br>
  <p>
    <a href="https://github.com/trip-as-a-code/taac/discussions/new?category=q-a">Ask a Question</a>
    &bullet;
    <a href="https://github.com/trip-as-a-code/taac/issues/new?labels=bug&template=01_bug.md">Report a Bug</a>
    &bullet;
    <a href="https://github.com/trip-as-a-code/taac/issues/new?labels=enhancement&template=02_feature.md">Request a Feature</a>
  </p>
</div>
<details>
  <summary>Table of Contents</summary>
  <ul>
    <li>
      <a href="#about-the-project">1. About the Project</a>
    </li>
    <li>
      <a href="#quick-start">2. Quick Start</a>
    </li>
    <li>
      <a href="#contributing">3. Contributing</a>
    </li>
    <li>
      <a href="#license">4. License</a>
    </li>
  </ul>
</details>
<!-- markdownlint-restore -->

## About the Project

Planning a trip with other people usually ends up spread over a chat, a spreadsheet, a few booking emails and somebody's
memory. taac keeps the whole plan in YAML files in a git repository, so changes go through pull requests like any other
code, and turns them into a website everyone on the trip can open.

- An itinerary, map, bookings, budget, tasks and packing list for each trip, in English or Russian, light or dark.
- Who owes whom, worked out from who paid for what, in any mix of currencies.
- Calendar feeds, a GeoJSON map, a Beancount ledger and a Markdown itinerary, for everyone or per person.
- Sign-in with GitHub, so each person sees only their own trips, plus view-only links for everyone else.
- Validation that catches what a schema can't: overlapping plans, nights nobody accounted for, moves with no way to get
  there, bookings and payments with loose ends.

Booking references and phone numbers never go into the files: a trip names a secret, and only a local build ever
fills it in.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## Quick Start

1. Write a trip to `trips/lisbon.yaml`:

   ```yaml
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

2. List it in `site.yaml` next to it:

   ```yaml
   apiVersion: taac/v1alpha4
   kind: Site
   metadata:
     title: Our trips
   trips:
     - path: trips/lisbon.yaml
   ```

3. Open the site, with nothing but Docker installed. It reloads whenever a file changes:

   ```bash
   docker run --rm -it -p 4321:4321 -v "$PWD:/site:ro" ghcr.io/trip-as-a-code/taac-builder:latest taac-dev /site/site.yaml
   ```

That's a trip on <http://localhost:4321>. Everything a trip can hold is in [Writing a Trip](docs/trips.md), and
putting it online for others is in [Self-Hosting](docs/self-hosting.md).

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## Contributing

Contributions are welcome, from fixing a typo in the docs to a new feature. Please read the
[contributing guidelines](CONTRIBUTING.md) first, and see [Development](docs/development.md) for how the code is laid
out and how to run it. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

To report a vulnerability, or a way a confidential value could leak, please follow the [security policy](SECURITY.md)
instead of opening an issue.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## License

Distributed under the MIT License. See [`LICENSE.md`](LICENSE.md) for more information.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->
