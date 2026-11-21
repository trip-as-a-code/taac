# Agent Instructions

Guidelines for AI agents working in this repository.

## Pull Requests

- **Always use the PR template**: Format PR descriptions using
  [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).
- Fill out all relevant sections:
  - **Summary**: Concise description of changes, motivation, and references to relevant issues.
  - **Type of change**: Mark applicable checkboxes.
  - **How was this tested**: Specify validation steps (e.g., `task verify`, `cargo test`).
  - **Checklist**: Ensure all applicable items are satisfied before requesting review or merging.

## Commits

- Use conventional commits format (enforced by commitlint): `feat:`, `fix:`, `chore:`, `docs:`, etc.
- When commit signing is configured, sign commits (`-S`).
- All code, comments, documentation, commit messages, and changelog entries must be in English.

## Validation & Verification

- Run `task verify` before pushing.
- Run `task schema` if you change any Rust schema types in `crates/taac-core`; CI checks schema freshness.
- Every user-facing change requires a changie fragment (`changie new`) or the `no changelog` PR label.
