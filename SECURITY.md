<!-- markdownlint-disable -->
<div id="top"></div>
<!-- markdownlint-restore -->

# Security Policy

<!-- markdownlint-disable -->
<details>
  <summary>Table of Contents</summary>
  <ul>
    <li>
      <a href="#supported-versions">1. Supported Versions</a>
    </li>
    <li>
      <a href="#reporting-a-vulnerability">2. Reporting a Vulnerability</a>
    </li>
    <li>
      <a href="#what-counts">3. What Counts</a>
    </li>
    <li>
      <a href="#what-happens-next">4. What Happens Next</a>
    </li>
  </ul>
</details>
<!-- markdownlint-restore -->

## Supported Versions

taac is before 1.0, so fixes go into the latest release only. Please check that a problem is still there in it before
reporting.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## Reporting a Vulnerability

Report it privately through a
[GitHub Security Advisory](https://github.com/trip-as-a-code/taac/security/advisories/new), never in a public issue,
discussion or pull request. Please include:

- what an attacker can do, and what they need to do it;
- the steps to reproduce it, with the smallest site or trip that shows it;
- the taac version, and how it's deployed (Docker, the Helm chart, from source).

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## What Counts

Anything that lets someone see, change or delete what they shouldn't, such as:

- a trip, a discussion or a calendar feed reaching someone who isn't on the trip, or past sign-in;
- a confidential value (`{ secret: NAME }`) ending up anywhere but a local `taac build --reveal`: the built site, a
  server response, an image or a log. taac is built so that this can't happen, and any way it can is treated as
  high severity;
- a way around view-only links, roles or the server's security headers.

Bugs that don't expose anything belong in a regular [issue](https://github.com/trip-as-a-code/taac/issues/new/choose).

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->

## What Happens Next

The maintainers reply to a report within a few working days, work on a fix in the private advisory with you, and
release it as soon as it's ready. The advisory is published once a fixed release is out, crediting you unless you'd
rather not be named.

<!-- markdownlint-disable -->
<p align="right"><a href="#top">(back to top)</a></p>
<!-- markdownlint-restore -->
