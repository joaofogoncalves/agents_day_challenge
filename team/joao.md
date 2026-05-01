# João — Lead architect

**Scope:** project bootstrap, the Agent class, Telegram wiring, Workers AI integration, backflow logic, deck.

## Status (demo day)

Backend is **live in prod and demo-ready**. Everything in PLAN.md H+1 → H+7 is shipped, plus the agentic intent router (`e88e986`), GitHub OAuth + per-user vote + editor whitelist (`c0cc342`, deployed), per-board names (`5b750f6`), refined scoring prompt with rubric (`f82d064`), realtime multiplayer board (merge `03a61d9`), and live vote-bar update on click (`d80efe3`). The bot answers cleanly in groups; the earlier `raw.trim` runtime bug is resolved.

No deck, no recorded demo — pitch is live. Bot token rotation is the only post-demo item.

## Files I own

- `quorum/wrangler.jsonc`
- `quorum/src/index.ts` — Worker entry, route fan-out (`/webhook`, `/api/*`, static assets)
- `quorum/src/agent.ts` — `QuorumAgent` class, all SPEC methods, board API on the DO side
- `quorum/src/telegram.ts` — grammY wiring, command handlers, signature check
- `quorum/src/llm.ts` — Workers AI wrapper, 70B→8B fallback
- `quorum/src/backflow.ts` — `/constraint` reanimation logic
- `quorum/src/router.ts` — addressed-mode intent router (LLM + regex shortcuts)
- `quorum/src/auth.ts` — GitHub OAuth + signed session cookie
- `quorum/src/scoring.ts` — composite score math (formula in SPEC.md)
- `quorum/src/schema.ts` — SQL schema + additive migrations + status↔stage map + uid helpers

## What's done ✅

- All PLAN.md slash commands shipped end-to-end: `/idea /ideas /vote /event /me /gh /team /forget /promote /park /kill /why /rank /constraint /plan /name`
- Workers AI wrapper with 70B→8B fallback (`quorum/src/llm.ts`)
- `/constraint` + `agent.reanimate()` triggering backflow re-validation across parked/killed; `events` table audit trail intact
- **Architectural merges:**
  - `api/` folded into `quorum/` (`d636ec7`) — single Worker, single DO, one source of truth
  - `web/` UI served as static assets from same Worker (`12af69f`) — single URL
  - Per-chat board URL: `/start` posts `…/?chat=<chatId>`, web/ reads it (`d4a1705`)
  - Always-200 webhook (`b856434`) — prevents Telegram queue lockup on internal errors
- **Beyond original plan:**
  - Agentic mode — silent observe + regex shortcuts + addressed LLM intent router (`e88e986`)
  - GitHub OAuth + per-user vote + editor whitelist (`c0cc342`), deployed and verified in prod
  - Per-board names via `/start <name>` and `/name` (`5b750f6`)
  - Telegram votes unified with web votes via `voterKeyForTelegram` (`c343424`)
  - Bot username canonicalization with typo-tolerant `isAddressed` (`27e38f8`)
  - Auto-validate on `/promote` so `/ideas` and `/rank` show real composites (`843530d`)

## What's next

Nothing left for the demo. All pre-demo items either shipped or got punted to `NEXT_STEPS.md` after the pitch.

Post-demo:

- Bot token rotation (the original token leaked in a chat transcript): `@BotFather → /revoke → @quorum_bot → new token → wrangler secret put TELEGRAM_BOT_TOKEN → re-run setWebhook`. Webhook secret stays as-is.
- Remaining nice-to-haves (CSRF token on logout/vote, schema drift cleanup in `schema.ts`, stall-nudge cron via `Agent.scheduleEvery()`, OAuth Safari sanity check) live in `CLAUDE.md`'s pre-demo punch list and `NEXT_STEPS.md` — not load-bearing for the pitch.

## Interfaces I produce

All documented in `SPEC.md`. If you change a signature, change SPEC in the same commit.

- `QuorumAgent.{addIdea, voteIdea, listIdeas, rank, setStatus, promote, why, setContext, validateIdea, reanimate, setMember, forgetMember, teamSummary, planFor, getBoard, updateIdea}`
- `complete(ai, messages, opts) → string` — Workers AI wrapper (was Twody7's `ai.complete`; lives in `src/llm.ts`)
- `parseJson<T>(raw) → T | null` — strips ``` fences, safe parse
- `scoring.composite({ team, resource, market }) → number`
- HTTP routes: `POST /webhook`, `GET /api/board`, `PATCH /api/ideas/:uid`, `GET /healthz`, `GET /` (static SPA)

## Definition of done

- ✅ Bot replies cleanly in groups (`raw.trim` bug resolved)
- ✅ Bot echoes any message in the test group
- ✅ Ideas survive a `wrangler dev` restart; SPEC matches code
- ✅ `setMember` round-trips; `extractSkills` produces a sensible list
- ✅ `/constraint we lost a backend dev` triggers re-validation across parked/killed; `events` table reflects every transition
- ✅ Board UI reflects DO state in realtime — multiplayer WebSocket + REST fallback, vote bar updates live on click
