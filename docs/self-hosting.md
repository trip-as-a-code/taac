# Self-Hosting

taac ships two images: `ghcr.io/trip-as-a-code/taac`, the server, and `ghcr.io/trip-as-a-code/taac-builder`, which
builds a site. Your instance is an image of your own, built from both.

## Building Your Image

Copy [`deploy/Dockerfile.site`](../deploy/Dockerfile.site) next to your `site.yaml` as `Dockerfile`, then build it
from a git checkout with its history:

```bash
docker build --secret id=github_token,env=GITHUB_TOKEN -t my-trips .
```

The history is what "Recent changes" and the "changed since your last visit" marks are made from, so in CI check out
with `fetch-depth: 0` and keep `.git` out of `.dockerignore`. The token only puts names to commit authors in a private
repository.

From a trip repository on GitHub, two reusable workflows do the same in CI:

- `trip-as-a-code/taac/.github/workflows/reusable-validate.yml`: validates `site.yaml` on pull requests.
- `trip-as-a-code/taac/.github/workflows/reusable-site-image.yml`: builds your image and pushes it to GHCR.

## Running It

- **Docker:** [`deploy/compose.yaml`](../deploy/compose.yaml) runs it with Postgres:
  `TAAC_IMAGE=my-trips docker compose up`.
- **Kubernetes:** the Helm chart at `oci://ghcr.io/trip-as-a-code/charts/taac` (source in
  [`deploy/helm/taac`](../deploy/helm/taac)) supports Ingress or the Gateway API, an existing Secret, and optionally a
  CloudNativePG cluster.
- **Without containers:** `task web:build server:build`, then `TAAC_DIST=web/dist node server/dist/main.mjs` (Node 22
  or newer, with `server/node_modules` and `server/migrations` next to it).

The server listens on `:8080`, expects a proxy in front of it that terminates TLS and sets `X-Forwarded-Proto`, and
answers `ok` on `/healthz` for probes.

## Configuration

The server is configured through its environment:

- `TAAC_PUBLIC_URL`: where it's served, such as `https://trips.example.com`; taken from each request if unset.
- `SESSION_SECRET`: signs sessions and calendar keys. Generate one with `openssl rand -hex 32`.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: a GitHub App for signing in. It needs no permissions; its callback URL is
  `<public URL>/api/auth/callback`.
- `DATABASE_URL`: Postgres, for discussions, ticks and notifications. Migrations run at start; without a database the
  packing list is read-only.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: browser notifications, from `npx web-push generate-vapid-keys`. Without them
  there are none, and the bell still works.
- `TAAC_NOINDEX`: `true` keeps search engines out of a public site.
- `PORT`, `TAAC_DIST`: `8080` and `/srv/site` unless set.
