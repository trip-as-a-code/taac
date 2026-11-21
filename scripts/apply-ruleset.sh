#!/bin/sh
# Applies the main branch ruleset (merge queue, linear history, signed commits, required checks, CODEOWNERS)
# and enables auto-merge. Run once the repository is public (or on GitHub Pro/Team).
set -eu
repo="${1:-trip-as-a-code/taac}"
gh api -X PATCH "repos/${repo}" -F allow_auto_merge=true >/dev/null
gh api -X POST "repos/${repo}/rulesets" --input .github/rulesets/main.json
