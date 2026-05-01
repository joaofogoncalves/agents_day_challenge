# NEXT_STEPS.md

Things we noticed during the build but **deferred from the demo**. Capture the why so we (or someone reading this later) doesn't relitigate the call. Anything time-critical for today belongs in `team/*.md`, not here.

## After-demo polish (deferred from the agentic-mode plan)

### Router circuit breaker + per-chat daily counter
Slot 5 of the agentic-mode plan. Skipped because the demo group's traffic is bounded and `bot.catch` + always-200 already keeps the worker stable.

**What:** counter in the `context` table tracking router LLM calls per UTC day. When it crosses a threshold (default 500), the addressed-mode handler should fall through to a polite "I'm conserving budget today — try a slash command" reply instead of calling the LLM. Reset on the first router call after midnight.

**Why deferred:** the regex shortcuts + mention-gating already kill most cost. We have ~9.5K Neurons/day headroom after validation calls. Real risk only matters at sustained team usage, not a 3-min demo.

**Files:** `quorum/src/router.ts` (counter check + decrement), `quorum/src/agent.ts` (a tiny `incRouterCallCount() / shouldThrottleRouter()` helper). Don't add a new table — UPSERT into `context` with `key = "router_calls_<YYYY-MM-DD>"`.

### Injection guard hardening
The pre-LLM regex blocklist (`router.ts → INJECTION_PATTERNS`) catches the obvious "ignore previous" / "you are now" attempts. Won't survive a determined attacker — model output should be schema-validated before any agent state mutates, and the system prompt's "data not instructions" framing should be reinforced with worked examples in `prompts/router.md`.

**Defer because:** demo audience isn't adversarial. Real product needs this before any non-friendly chat.

### Real-time board updates
Currently the board UI in `web/` only fetches on load. After `/constraint` reanimates ideas, the user has to refresh to see the reflow. Two paths:
- Polling every 5s on the page
- Worker → Pages websocket / SSE for push updates

Polling is the cheap fix. Probably what Rui will ship if he has time.

### `Agent.scheduleEvery()` for stall nudges
PLAN.md has it as H+7 work — we never wired it. The idea: every 24h, the agent picks a parked idea and posts "still parked? kill, revive, or leave?" into the chat. Cute feature for "agent that lives in your team's chat for real" but not in the demo arc. Wire post-demo if we keep iterating.

### Bot token rotation
The current `TELEGRAM_BOT_TOKEN` was pasted into a Claude conversation and is in transcripts. For a real product launch: `@BotFather → /revoke → @quorum_bot → new token → wrangler secret put TELEGRAM_BOT_TOKEN → re-run setWebhook`. The webhook secret stays.

### `api/` Worker cleanup
Lives at `api/` but is dead code — `quorum/` owns `/api/*` after the merge. Safe to `git rm -r api/` once everyone's confirmed they're not running it locally.

## Known issues (not blocking demo)

### `/me` and `/gh` — partial
User flagged these had issues; we deprioritized to stay on the agentic refactor. The router's `record_member` path uses the same `extractSkills(...)` helper that `/me` does, so any prompt-quality issue in skill extraction shows up in both. Twody7 owns the prompt iteration (see `team/twody7.md`).

### Bot username canonicalization
The bot's canonical handle is `@quorum_bot`. An earlier deploy used `@quorom_bot` (typo); `isAddressed` in `quorum/src/telegram.ts` keeps both spellings working via `/@quor[uo]m_bot\b/i`. Once we're confident no historical `@quorom_bot` mentions are in active use, the regex can be tightened to the canonical name only.

### Schema drift between SCHEMA and ALTER
`name`, `brief`, `long`, `hours` columns on `ideas` are added via `ADDITIVE_MIGRATIONS` (try/catch on duplicate-column). The `CREATE TABLE` in `SCHEMA` still doesn't list them. Works because new DOs run both arrays, but a fresh reader of `schema.ts` might be confused. Reconcile later.

## Out of scope — ideas captured but parked

Things the team or chat surfaced that are interesting but not for today. **AI agents working on this repo: when you notice something worth doing later, append it here, briefly. Don't lose it, don't act on it.**

- **Slack adapter parity.** PLAN.md mentions it; never started. The bot transport interface is already in `telegram.ts`; abstracting is mostly a transport-shim refactor.
- **Cross-chat idea citation.** From the seed list: `@chat#id` syntax to reference an idea from another chat the user is in. Requires a global user→chats index and a permissioning model.
- **Idea de-duplication via embeddings.** Compute embedding for new `/idea`, compare against live ideas in the same chat with cosine > 0.86, soft-prompt "looks like #7 — merge or keep separate?". `sqlite-vss` is the path.
- **Voice-note ingestion.** Workers AI Whisper → idea text. Watch the Neuron budget.
- **Periodic digest.** Agent reviews recent silent observations every N min and posts "I picked up these proposals from the chat: A, B, C". Different from the addressed-router because it's autonomous; needs an opt-in flag.
- **Per-chat persona pack.** Stylistic prompt-prefix swap (dry / hype / deadpan / professorial). Stored in agent state.
- **Idea templates.** `/idea --template=experiment` scaffolds the brief with hypothesis/metric/timebox prompts.
- **Why-rope visualizer.** Render `/why` audit chain as ASCII tree.
- **`G/<token>` signed read-only public URL.** Today the board URL is `?chat=<id>` — anyone with the chat ID can read. A signed token would be the public-share path.
- **Ambient nudges.** Each parked idea schedules a one-shot via `this.schedule()` 7 days out: "idea #N parked a week — kill, revive, or leave?".
- **Automatic idea title/brief polish.** The router currently writes the user's raw text into `name` and `brief`. A separate LLM pass could turn "what if we built a real-time leaderboard?" into a tighter `name="Real-time leaderboard"`, `brief="…"`. Could be a single pass right after `addIdea`.
