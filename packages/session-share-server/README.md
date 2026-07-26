# @craft-agent/session-share-server

CVTE intranet backend for Work Agents **session sharing** — the `/s/api` blob
store that sits behind the `apps/viewer` frontend. Self-hosted replacement for
the public `agents.craft.do` store (decision **D11**; see
`docs/deployment/intranet-session-viewer.md` and `docs/CUSTOMIZATIONS.md`).

When a user clicks "share" in the desktop app, the full session transcript is
uploaded here instead of leaving the intranet. The client sends **no
credentials** — protect this service at the network layer (intranet-only / IP
allowlist / mTLS).

## API contract

| Method | Path | Body | Success | Caller |
|--------|------|------|---------|--------|
| `POST` | `/s/api` | `StoredSession` JSON | `201` `{ id, url }` (`url` = `{PUBLIC_BASE}/s/{id}`) | client `shareToViewer` |
| `GET` | `/s/api/:id` | — | `200` `StoredSession` (`404` if missing) | viewer frontend |
| `PUT` | `/s/api/:id` | `StoredSession` JSON | `200` (`404` if missing) | client `updateShare` |
| `DELETE` | `/s/api/:id` | — | `200` (idempotent) | client `revokeShare` + delete cleanup |
| `GET` | `/healthz` | — | `200 ok` | liveness probe |

`413` on bodies over `MAX_BYTES`; `400` on invalid JSON / non-session / bad id
charset (`id` must match `[A-Za-z0-9_-]{1,64}`, same as the viewer route).

## Run

```bash
bun install
PUBLIC_BASE=https://agents-viewer.gz.cvte.cn DATA_DIR=/var/lib/craft-share bun run src/index.ts
bun test            # 9 handler tests
```

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8787` | listen port |
| `PUBLIC_BASE` | `http://localhost:PORT` | public viewer origin — **must equal `enterprise.viewerUrl`**, no trailing slash |
| `MAX_BYTES` | `26214400` (25 MiB) | size limit before `413` (keep == nginx `client_max_body_size`) |
| `STORAGE` | `fs` | `fs` (filesystem) or `s3` (S3 / MinIO) |
| `DATA_DIR` | `./session-store` | fs: where `${id}.json` files live |
| `S3_BUCKET` `S3_REGION` `S3_ENDPOINT` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_FORCE_PATH_STYLE` `S3_PREFIX` | — | s3 backend (`S3_ENDPOINT` + `S3_FORCE_PATH_STYLE=true` for MinIO) |

**Storage choice:** filesystem for a single VM or a CCloud pod with a persistent
volume; S3/MinIO for ephemeral / multi-replica pods (no shared disk). Both are
verified (handler unit tests + live MinIO round-trip).

## Deploy

Same-origin: nginx serves the built `apps/viewer/dist` and proxies `/s/api` here.

- **Docker (single host):** `deploy/docker-compose.yml` (build the frontend,
  drop `apps/viewer/dist` → `deploy/viewer-dist`, add TLS certs, set
  `PUBLIC_BASE`). Uses `deploy/nginx.compose.conf`.
- **Bare VM:** `deploy/craft-share.service` (systemd) + `deploy/nginx.conf` on
  the host nginx.
- **CCloud / k8s:** build the image from `Dockerfile`; set `STORAGE=s3` (pods are
  ephemeral) and the `S3_*` vars; front with an ingress that maps the routes in
  `deploy/nginx.conf`.

## Frontend (apps/viewer)

The CVTE build strips all external deps (Plausible analytics, Google Fonts) and
the `agents.craft.do` link for an air-gapped deploy. Build with
`cd apps/viewer && bun run build` (needs the monorepo — it imports
`@craft-agent/core` + `@craft-agent/ui`).

## Wire up the client

Set `enterprise.viewerUrl` in `apps/electron/resources/config-defaults.json` to
`PUBLIC_BASE` and ship a new build. Until set, enterprise sharing stays disabled
(no egress to craft.do).
