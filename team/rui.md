# Rui (Molefas) — UX & visible surface

**Scope:** the board UI in `web/`, message-text rendering for Telegram, demo capture.

## Status (demo day)

The board prototype shipped end-to-end and is **live in production** at `https://quorum.joao-f-o-goncalves.workers.dev/?chat=<id>`. It reads the same `QuorumAgent` SQLite that the Telegram bot writes to — one source of truth. `DEFAULT_BOARD_CHAT` now points at the demo group (`-5224131572`), so the bare URL loads the demo board.

The original plan had your work split between `src/format.ts` (Telegram message templates) inside the bot Worker and `src/web/` (server-rendered `/g/<token>` view). That changed:

- The visible surface is now the **React kanban in `web/`**, not the Telegram replies. The board UI is what people will look at during the demo.
- The `/g/<token>` HTML view is **superseded** — same UI, but URL-keyed by `?chat=<id>` and served from the main Worker as static assets, not server-rendered. The token-tracking pattern wasn't needed.
- `quorum/src/format.ts` exists with placeholder Telegram-reply text. It works, but it's not load-bearing for the demo. Polishing it is nice-to-have, not critical.

## Files I own

- `web/` — Vite + React board (FRONTEND.md is the contract)
- `web/src/api.js` — API client (forwards `?chat=` from page URL to the API)
- `web/public/mock.json` — fallback when `VITE_API_BASE` is unset (dev only)
- `quorum/src/format.ts` — Telegram reply formatting (low priority now)
- `demo/` — screen recording, GIFs, final demo cut (TODO)

## What's done ✅

- `web/` Vite + React frontend with the dark techno-editorial style
- 3 columns (Bucket / Candidates / Selected for Development), agent-managed (no DnD)
- Click-to-edit modal: `name` + `long`, with optimistic save + rollback
- `web/src/api.js` reads `?chat=` from the page URL, forwards to `/api/board?chat=...`
- Mock fallback: empty `VITE_API_BASE` → `/mock.json` so dev works without backend
- Live at the production URL — the board reflects the same DO state as Telegram

## What's next

In rough priority order:

1. **Polling for live board updates.** **Currently in flight.** The demo's "money moment" is `/constraint we lost a backend dev` reshuffling cards live. Without polling the user has to refresh, which kills the moment. Polling every ~5s on `/api/board` is the cheap fix.
2. **Empty state copy.** When the board is empty, the placeholder should suggest sending `/idea ...` in chat.
3. **Error surfacing.** If `/api/board` 5xx's, show something — silent failure can derail the demo if anything regresses.
4. **Telegram message polish (low priority).** `quorum/src/format.ts` has placeholder text for `/why`, `/team`, `/constraint`. The `/constraint` reply is the demo highlight — make that one line readable on a phone screen if you have spare cycles.

Demo is live (no recording needed).

## Cloudflare access for `web/` deploys

`web/` is now built and served as part of the main `quorum` Worker — `npm run deploy` from `quorum/` rebuilds `web/dist` first via the predeploy hook. So you don't actually need a separate Pages deploy. If you want to deploy independently for testing, ask João for either an API token (lowest friction) or a Cloudflare account-member invite.

## Interfaces I consume

- `GET /api/board?chat=<id>` → `{ ideas: BoardIdea[] }`
- `PATCH /api/ideas/:uid?chat=<id>` body `{name?, long?}` → `{ idea: BoardIdea }`
- `BoardIdea` type and stage↔status mapping documented in `web/FRONTEND.md` and `SPEC.md` "Board API"

## Definition of done

- ✅ Board renders 3 columns from real API
- ✅ Edit-modal `PATCH` round-trips through the DO
- ✅ Deployed to production, single URL
- ⚠️ **In flight**: polling so the board updates after `/constraint`
- ⚠️ **Open**: error/empty states have copy
