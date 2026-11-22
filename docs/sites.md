# Sites

A site is the `site.yaml` that lists which trips are served together, and who may see them.

```yaml
apiVersion: taac/v1alpha4
kind: Site
metadata:
  title: Our trips # or per language: { en: Our trips, ru: Наши поездки }
access: github # optional: sign in with GitHub to see anything (public by default)
source: # optional: link every card and issue to its line in the repository
  repo: https://github.com/you/trips # branch: main, dir: '' (the site file's folder in the repository)
trips:
  - path: trips/lisbon.yaml
  - path: trips/japan # a trip split into a directory
    public: true # optional: anyone may see this trip, even on a github site
```

## Who Sees What

On a `public` site, which is the default, everything is open. On a `github` site, people sign in with GitHub and each
sees the trips they're a member of: a member is matched by their `github` username, or by a github.com link in their
`links`. A `public: true` trip stays open to everyone either way.

A member's `role` decides what they can do: `member`, the default, can do everything, while `viewer` can look and
comment but doesn't tick anything off.

## Sharing a Trip

Members can make view-only links from Share on any of a trip's pages. Whoever has the link sees that one trip without
signing in, read-only, for a day, a week, a month or for good, until any member revokes it.

## Discussions and Notifications

Every plan, day, idea, task and packing item (and the trip itself) has a speech bubble to discuss it; viewers can
comment too. The bell in the top bar collects what the others said and settled, changes to the plan, and reminders of
what's due, and each kind can also come as a browser notification.

The trip's own data never changes from the site: plans change through commits. What the site does store is
conversation and progress, like ticks on the packing list and on tasks.

## Linking Back to the Files

With `source`, every card and every validation issue links to `<repo>/blob/<branch>/<file>#L<line>`, and issues offer
the YAML to paste. The overview's "Recent changes" and the "changed since your last visit" marks come from the
repository's history as well: they replay the last 30 commits that touched each trip.
