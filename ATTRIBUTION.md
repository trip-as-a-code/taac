<!-- markdownlint-disable -->
<div id="top"></div>
<!-- markdownlint-restore -->

# Attribution

Thanks to the people and projects that make taac possible.

<!-- markdownlint-disable -->
<details>
  <summary>Table of Contents</summary>
  <ul>
    <li>
      <a href="#people">1. People</a>
    </li>
    <li>
      <a href="#projects">2. Projects</a>
    </li>
  </ul>
</details>
<!-- markdownlint-restore -->

## People

<!-- markdownlint-disable -->
<div align="center">
  <a href="https://github.com/trip-as-a-code/taac/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=trip-as-a-code/taac">
  </a>
</div>
<!-- markdownlint-restore -->

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## Projects

taac stands on a lot of open source work. The ones it leans on most:

- [Astro](https://astro.build), which builds the website.
- [MapLibre GL JS](https://maplibre.org), which draws the maps, with tiles from [OpenFreeMap](https://openfreemap.org)
  and data from [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- [wasm-bindgen](https://github.com/wasm-bindgen/wasm-bindgen), which brings the Rust core to the website build.
- [Serde](https://serde.rs), [schemars](https://graham.cool/schemars/) and [jiff](https://github.com/BurntSushi/jiff),
  for reading trips, generating their schema, and getting dates and time zones right.
- The [European Central Bank](https://www.ecb.europa.eu)'s reference rates, through
  [Frankfurter](https://frankfurter.dev), for converting currencies.
- [Extism](https://extism.org), for running sandboxed WebAssembly plugins in the CLI.
- [Transitous](https://transitous.org/sources/) (powered by [MOTIS](https://github.com/motis-project/motis)), for
  community-run open-data public transport routing and timetable verification.

Every dependency, with its license, is listed in `Cargo.lock` and `package-lock.json`.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->
