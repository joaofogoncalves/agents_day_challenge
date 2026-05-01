# quorum-api

Minimal Cloudflare Worker that fronts a Durable Object with embedded SQLite. Powers the board UI in `web/`.

Single global DO instance (`default`) for the prototype. When the per-chat `QuorumAgent` lands, the same schema and route shapes are reusable inside it.

## Endpoints

| Method | Path                  | Body                           | Returns                  |
|--------|-----------------------|--------------------------------|--------------------------|
| `GET`  | `/healthz`            | —                              | `ok`                     |
| `GET`  | `/api/board`          | —                              | `{ ideas: Idea[] }`      |
| `PATCH`| `/api/ideas/:uid`     | `{ name?: string, long?: string }` | `{ idea: Idea }`     |

CORS is wide-open (`*`) — fine for a prototype. Tighten before any real deploy.

## Schema

See `SPEC.md` "SQLite schema" + "Board API" section for the source of truth, including the additive columns (`name`, `brief`, `long`, `hours`) and the stage / score / uid mappings. Schema is created on first DO boot; migrations are append-only.

On first boot with an empty `ideas` table the DO seeds from `src/seed.js` (same content as `web/public/mock.json`). To re-seed: delete the DO instance via Wrangler.

## Dev

```bash
cd api
npm install
npx wrangler login        # first time
npm run dev               # local on http://127.0.0.1:8787
```

Test:
```bash
curl http://127.0.0.1:8787/api/board | jq
curl -X PATCH http://127.0.0.1:8787/api/ideas/qrm_000001 \
  -H 'content-type: application/json' \
  -d '{"name":"new name"}'
```

## Deploy

```bash
npm run deploy
```

Yields `https://quorum-api.<account>.workers.dev`. Set that as `VITE_API_BASE` in `web/`.

## Critical gotchas

- `wrangler.jsonc` migrations use **`new_sqlite_classes`**, not `new_classes`. Wrong tag silently falls back to legacy KV-backed DO with no `state.storage.sql`.
- DO `state.storage.sql.exec()` accepts a single SQL statement per call — schema is split into separate `exec` calls in `src/index.js`.
- Editing this DO does **not** rebuild storage — it migrates in place. Any new SQL columns must be `ALTER TABLE … ADD COLUMN` migrations going forward, never destructive.
