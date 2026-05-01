# quorum/web

Prototype board UI for Quorum. API-less — reads `public/mock.json`.

## dev

```bash
cd web
npm install
npm run dev
```

## deploy (Vercel)

Vercel auto-detects Vite. From this folder:

```bash
vercel        # first time, link & deploy preview
vercel --prod
```

Or push the repo and import `web/` as the project root in the Vercel dashboard.

## env

`VITE_API_BASE` — base URL of the `api/` Worker (e.g. `https://quorum-api.<account>.workers.dev`). If unset, the app reads `public/mock.json` and runs in mock mode (no persistence). Footer shows `live` vs. `mock`.

For local dev with the API:
```bash
echo "VITE_API_BASE=http://127.0.0.1:8787" > .env.local
```

For Vercel: set `VITE_API_BASE` as a project env var.

## what's here

- 3 columns: **Bucket**, **Candidates**, **Selected for Development**.
- No drag & drop — agents own column placement.
- Card shows: name, brief, score (1–10), time estimate (h).
- Click a card → modal: edit `name` + long `description`. Score / estimate / stage are read-only. UID shown faded.
- Saves go to `PATCH /api/ideas/:uid` (optimistic; rolls back on failure). In mock mode, edits live in local state only.

See [`FRONTEND.md`](./FRONTEND.md) for the data contract.
