<!-- markdownlint-disable -->
<div id="top"></div>
<!-- markdownlint-restore -->

# Contributing to taac

Thanks for wanting to help. Questions, bug reports, ideas, docs and code are all welcome, and this page says how each of
them works here.

<!-- markdownlint-disable -->
<details>
  <summary>Table of Contents</summary>
  <ul>
    <li>
      <a href="#code-of-conduct">1. Code of Conduct</a>
    </li>
    <li>
      <a href="#asking-a-question">2. Asking a Question</a>
    </li>
    <li>
      <a href="#reporting-a-bug">3. Reporting a Bug</a>
    </li>
    <li>
      <a href="#suggesting-a-feature">4. Suggesting a Feature</a>
    </li>
    <li>
      <a href="#contributing-code">5. Contributing Code</a>
      <ul>
        <li>
          <a href="#commits-and-pull-requests">5.1. Commits and Pull Requests</a>
        </li>
        <li>
          <a href="#changelog">5.2. Changelog</a>
        </li>
      </ul>
    </li>
    <li>
      <a href="#improving-the-docs">6. Improving the Docs</a>
    </li>
  </ul>
</details>
<!-- markdownlint-restore -->

## Code of Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## Asking a Question

Check the [documentation](docs/) and the existing [discussions](https://github.com/trip-as-a-code/taac/discussions)
first. If the answer isn't there, ask in [Q&A](https://github.com/trip-as-a-code/taac/discussions/new?category=q-a), and
include the part of your trip or site file that the question is about, with anything private taken out.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## Reporting a Bug

Search the [issues](https://github.com/trip-as-a-code/taac/issues?q=label%3Abug) first, in case it's already known.
Otherwise [open one](https://github.com/trip-as-a-code/taac/issues/new?labels=bug&template=01_bug.md) and include the
taac version, what you did, what you expected and what happened instead. The smallest trip file that shows the problem
helps more than anything else.

Security problems, and anything that could leak a confidential value, go through the [security policy](SECURITY.md)
instead, never a public issue.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## Suggesting a Feature

Open a [feature request](https://github.com/trip-as-a-code/taac/issues/new?labels=enhancement&template=02_feature.md)
that describes the problem it solves, not only the solution: what you're planning, what's missing, and how you'd expect
it to look in a trip file or on the site. Features that help most people's trips land more easily than ones that fit a
single setup.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## Contributing Code

[Development](docs/development.md) explains how the code fits together and how to run it. Before opening a pull request,
run the same checks CI does:

```bash
task verify
```

Changes that need discussing (a new section in the schema, a new page on the site) are best raised in an issue first, so
nobody spends a week on something that won't fit. Small fixes can go straight to a pull request.

### Commits and Pull Requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`,
`chore:`), and so do pull request titles, since pull requests are squashed into one commit named after the title. Fill
in the pull request template, and keep code, comments and docs in English.

### Changelog

Every user-facing change gets a changelog fragment, written with `changie new`. Internal changes (CI, refactoring,
tests) get the `no changelog` label instead.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## Improving the Docs

The [docs](docs/) are plain Markdown, and fixes to them are as welcome as code. Keep them short and concrete: an
example from a trip file usually explains more than a paragraph does.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->
