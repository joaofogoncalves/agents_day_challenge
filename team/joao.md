# João — Lead architect

**Scope:** project bootstrap, the Agent class, Telegram wiring, Workers AI integration, backflow logic, deck.

## Status (H+4, 12:43)

Way ahead on backend. Significantly ahead of the original H-by-H plan — H+1 through H+7 features are in `main`. **Blocked on one runtime bug** that prevents the demo flow from actually running in Telegram.

## Files I own

- `quorum/wrangler.jsonc`
- `quorum/src/index.ts` — Worker entry, route fan-out (`/webhook`, `/api/*`, static assets)
- `quorum/src/agent.ts` — `QuorumAgent` class, all SPEC methods, board API on the DO side
- `quorum/src/telegram.ts` — grammY wiring, command handlers, signature check
- `quorum/src/llm.ts` — Workers AI wrapper, 70B→8B fallback
- `quorum/src/backflow.ts` — `/constraint` reanimation logic
- `quorum/src/scoring.ts` — composite score math (formula in SPEC.md)
- `quorum/src/schema.ts` — SQL schema + additive migrations + status↔stage map + uid helpers
- `deck/` — pitch slides (still TODO)

## What's done ✅

- H+0: scaffold, secrets set, MCPs connected, first push (`fd65df4`)
- H+1: Worker + Agent skeleton, webhook live, bot echo working
- H+2: SQL schema migrated (`new_sqlite_classes` ✓), `/idea /ideas /vote` end-to-end
- H+3: `/event <url>` scrape pipeline (LLM extraction + setContext recompute)
- H+5 (early): `/me /gh /team /forget` wired to `setMember` / `teamSummary`
- H+6 (early): `/promote /park /kill /why /rank` — full state machine + audit trail
- H+7 (early): `/constraint` + `agent.reanimate()` end-to-end, `/plan` LLM-generated
- **Architectural merges:**
  - `api/` folded into `quorum/` (`d636ec7`) — single Worker, single DO, one source of truth
  - `web/` UI served as static assets from same Worker (`12af69f`) — single URL
  - Per-chat board URL: `/start` posts `…/?chat=<chatId>`, web/ reads it (`d4a1705`)
  - Always-200 webhook (`b856434`) — prevents Telegram queue lockup on internal errors

## What's next

| When | Task |
|---|---|
| now | Fix the `raw.trim` bug. Smoke-test the demo arc end-to-end. |
| H+4 (now) | Lunch + dogfood with the team. Capture prompt failures for Twody7. |
| H+7 | Wire `Agent.scheduleEvery()` for stall-nudges (still missing). Optional — cuts to "imagine this fired at 9am" if time-pressed. |
| H+8 | **Deck (3 slides)** — currently empty. (1) the wrong-thing-to-build problem, (2) `/constraint` demo flow, (3) all-Cloudflare architecture diagram. |
| H+8 | Pitch dry-run with Rui & Twody7. |
| H+9 | Submit. Buffer for breakage. |

Bot token rotation is also still pending (the original token leaked in a chat transcript): `@BotFather → /revoke → @quorum_bot → new token → wrangler secret put TELEGRAM_BOT_TOKEN → re-run setWebhook`. Webhook secret stays as-is.

## Interfaces I produce

All documented in `SPEC.md`. If you change a signature, change SPEC in the same commit.

- `QuorumAgent.{addIdea, voteIdea, listIdeas, rank, setStatus, promote, why, setContext, validateIdea, reanimate, setMember, forgetMember, teamSummary, planFor, getBoard, updateIdea}`
- `complete(ai, messages, opts) → string` — Workers AI wrapper (was Twody7's `ai.complete`; lives in `src/llm.ts`)
- `parseJson<T>(raw) → T | null` — strips ``` fences, safe parse
- `scoring.composite({ team, resource, market }) → number`
- HTTP routes: `POST /webhook`, `GET /api/board`, `PATCH /api/ideas/:uid`, `GET /healthz`, `GET /` (static SPA)

## Definition of done

- ⚠️ **Open**: bot replies in groups without erroring
- ⚠️ **Open**: deck exists in `deck/` (3 slides minimum)
- ✅ Bot echoes any message in the test group
- ✅ Ideas survive a `wrangler dev` restart; SPEC matches code
- ✅ `setMember` round-trips; `extractSkills` produces a sensible list
- ✅ `/constraint we lost a backend dev` triggers re-validation across parked/killed; `events` table reflects every transition
- ✅ Board UI reflects DO state in real time (refresh-based; no realtime push yet)
