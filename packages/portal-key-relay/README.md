# @craft-agent/portal-key-relay

CVTE intranet relay for the SSO closed-loop (§六). The desktop app logs the user
in via the CVTE portal (OAuth2) and gets a short-lived **portal access token**;
it hands that token to this relay, which resolves the user's **personal CCH
(token.cvte.com) gateway API key** and returns it. The relay holds the CCH admin
key (`X-Api-Key`) **server-side** so it never reaches the client.

> Why a relay: the CCH admin key can reveal *any* user's key. It must never be
> baked into a desktop binary. The relay only ever returns the key of the user
> proven by the portal access token it was handed.

## API

```
POST /api/resolve-key   { "accessToken": "<portal access_token, 120s TTL>" }
  → 200 { "apiKey": "sk-…", "identity": { "account", "name", "email", "simUid", "userId" } }
  → 401 portal token rejected · 404 user has no key (and AUTO_CREATE_KEY=false) · 502 upstream
GET  /healthz → 200
```

Resolution (each step verified live against op-fat + token.cvte.com):
`GET {portal}/portal/oauth2/user` (Bearer) → `simUid` → `userId = parseInt(simUid)`
→ `GET {cch}/api/v1/users/{userId}/keys` → enabled keyId → `GET /keys/{keyId}:reveal` → full key.

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8788` | listen port |
| `PORTAL_HOST` | `op-fat.cvte.com` | portal host — **`op-fat.cvte.com` (test)** / `home.cvte.com` (prod) |
| `CCH_BASE` | `https://token.cvte.com` | CCH base |
| `CCH_ADMIN_KEY` | — (**required**) | CCH `X-Api-Key`, admin-level — keep server-side only; rotate the shared test value before prod |
| `AUTO_CREATE_KEY` | `false` | `true` → provision a key (`POST …/keys`) when the user has none |

## Run / test

```bash
PORTAL_HOST=op-fat.cvte.com CCH_ADMIN_KEY=<test X-Api-Key> bun run src/index.ts
bun test    # 9 unit tests (mock fetch over all 5 steps + edge cases)
```

## Deploy

Intranet-only (no client auth — protect at the network layer). `Dockerfile` for
container/CCloud; `deploy/craft-key-relay.service` (systemd) for a bare VM. Put
`CCH_ADMIN_KEY` in a chmod-600 EnvironmentFile or a secrets manager, never in the
unit file. Wire the desktop via `enterprise.sso.relayUrl` in config-defaults.json.

## Security notes

- The relay is the only holder of `CCH_ADMIN_KEY`. Restrict network access to the
  desktop fleet / intranet.
- The portal access token is short-lived (120s); the relay verifies it live every call.
- Logs must never print the resolved key (this service does not).
- **Cleanest future**: ask the CCH team for a "get my own key" endpoint authed by
  the portal token — then this relay (and the admin key) can be retired.
