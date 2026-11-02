# syntax=docker/dockerfile:1
#
# Two images from one file:
#   --target builder  ghcr.io/trip-as-a-code/taac-builder: builds a site (`taac-site <site.yaml> <out>`)
#   --target runtime  ghcr.io/trip-as-a-code/taac: the server, serving /srv/site (the demo until replaced)
# An instance builds its site with the first and copies it into the second; see deploy/Dockerfile.site.

ARG RUST_VERSION=1.99.1
ARG NODE_VERSION=22.23.4
# Must match the wasm-bindgen crate pinned in Cargo.toml.
ARG WASM_BINDGEN_VERSION=0.2.129

FROM rust:${RUST_VERSION}-slim-bookworm AS wasm
ARG WASM_BINDGEN_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown \
 && curl -fsSL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-$(uname -m)-unknown-linux-musl.tar.gz" \
  | tar -xz --strip-components=1 -C /usr/local/bin "wasm-bindgen-${WASM_BINDGEN_VERSION}-$(uname -m)-unknown-linux-musl/wasm-bindgen"
WORKDIR /taac
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/taac/target \
    cargo build -p taac-wasm --target wasm32-unknown-unknown --release \
 && wasm-bindgen --target web --out-dir /pkg --out-name taac target/wasm32-unknown-unknown/release/taac_wasm.wasm

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /taac
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY web/package.json web/
COPY server/package.json server/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS server-deps
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --omit=dev --workspace @taac/server --include-workspace-root=false

FROM deps AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
COPY packages packages
COPY --from=wasm /pkg packages/core/pkg
COPY web web
COPY server server
COPY examples examples
COPY deploy/taac-site /usr/local/bin/taac-site
RUN npm run build -w @taac/server \
 && taac-site /taac/examples/demo/site.yaml /srv/site

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 TAAC_DIST=/srv/site
WORKDIR /app
COPY --from=server-deps /taac/node_modules node_modules
COPY --from=builder /taac/server/dist server/dist
COPY server/migrations server/migrations
COPY --from=builder /srv/site /srv/site
USER node
EXPOSE 8080
CMD ["node", "/app/server/dist/main.mjs"]
