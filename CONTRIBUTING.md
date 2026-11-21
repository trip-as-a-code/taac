# Contributing to taac

Thanks for your interest in contributing to **taac** (Trip as a Code)!

## Development setup

Install the pinned toolchain with [mise](https://mise.jdx.dev/) and install Node dependencies:

```sh
mise install
task install
```

Run the demo site locally with live reload:

```sh
task web:dev
```

## Verification

Run the full CI suite locally before opening a pull request:

```sh
task verify
```

This runs Rust formatting and Clippy checks, Rust and TypeScript tests, JSON Schema freshness checks, ESLint, Astro and
TypeScript type checks, Helm chart linting, and a production build.

If you change any schema types in `crates/taac-core`, regenerate the JSON Schemas:

```sh
task schema
```

## Commits & Changelog

- Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- Add a changelog fragment for user-facing changes with `changie new`, or apply the `no changelog` label on
  internal/maintenance PRs.
- Keep all code, comments, documentation, and commit messages in English.
