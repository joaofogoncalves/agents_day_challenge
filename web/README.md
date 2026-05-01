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

## what's mocked

- 3 columns: **Bucket**, **Candidates**, **Selected for Development**.
- No drag & drop — agents own column placement.
- Card shows: name, brief, score (1–10), time estimate (h).
- Click a card → modal: edit `name` + long `description`. Score / estimate / stage are read-only. UID shown faded.
- Edits are local-state only (no persistence).
