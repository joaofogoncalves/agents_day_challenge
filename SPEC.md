# Quorum — Data & API Spec

This is the contract between team members. **Update this file in the same commit as any contract-changing code.** A change that breaks behavior without updating SPEC is a bug. If you're unsure whether something is a contract: if anyone else's code reads or writes it, it's a contract.

## Environment & secrets

| Name | Source | Notes |
|------|--------|-------|
| `TELEGRAM_BOT_TOKEN` | `wrangler secret` | From @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | `wrangler secret` | Self-generated random string (≥32 bytes hex). Passed back by Telegram via `X-Telegram-Bot-Api-Secret-Token` on every webhook hit. |
| `GITHUB_TOKEN` | `wrangler secret` (optional) | Higher rate limit for `/gh` lookups |

**Why no Anthropic key?** We use Workers AI Llama 3.3 70B for everything (Path A — see PLAN.md). Keeps the stack 100% on Cloudflare and inside the 10K Neurons/day free tier for the demo. If validation quality degrades during dogfooding, we swap to Gemini 2.5 Flash via Cloudflare AI Gateway (10× cheaper than Claude, still proxied through CF).

## SQLite schema (per-chat, owned by `QuorumAgent`)

Source of truth. Migrations are append-only — never `DROP COLUMN` mid-day.

```sql
CREATE TABLE ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id TEXT NOT NULL,
  text TEXT NOT NULL,                       -- raw /idea body, kept as legacy/source
  name TEXT,                                -- short title, board card heading (nullable; falls back to text)
  brief TEXT,                               -- one-line description shown on the card (nullable; falls back to text)
  long TEXT,                                -- long description shown in the editor modal
  hours INTEGER,                            -- agent-assigned effort estimate, hours
  status TEXT NOT NULL DEFAULT 'ideating', -- ideating|validating|planning|parked|killed
  score_team REAL,
  score_resource REAL,
  score_market REAL,        -- kept for additive-migration policy; not used in composite since votes replaced it
  votes INTEGER DEFAULT 0,
  last_validated_at INTEGER,
  last_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE members (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  gh_user TEXT,
  skills_json TEXT,         -- JSON array of skill strings
  availability TEXT,
  joined_at INTEGER NOT NULL
);

CREATE TABLE context (
  key TEXT PRIMARY KEY,     -- 'event_url', 'deadline', 'budget', etc
  value TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER,
  event_type TEXT NOT NULL,
  payload TEXT,             -- JSON
  created_at INTEGER NOT NULL
);

-- Conversation log. Every text message in the chat (command or not, addressed
-- or not) is appended here. Foundation for the agentic / "reads everything"
-- pitch. The intent router (src/router.ts) reads the last N rows as context.
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id TEXT,
  author_name TEXT,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL,
  addressed_bot INTEGER NOT NULL DEFAULT 0,  -- 1 = mention/reply/DM
  intent_json TEXT                           -- optional cached router decision
);

-- Per-user "did you mean X?" stash. The router proposes an action, the user
-- replies "yes", the action runs. Single-row-per-user, TTL ≤ 180s.
CREATE TABLE pending_confirmations (
  user_id TEXT PRIMARY KEY,
  action_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Per-user vote tracking (feat/social-ranking-and-auth). PRIMARY KEY enforces
-- one vote per (idea, voter). voter_key shapes:
--   • "gh:<lowercased_login>" — web (GitHub OAuth) or Telegram users who have
--     linked a GitHub account via /gh (so the same person voting on web and
--     Telegram doesn't double-count).
--   • "tg:<telegram_user_id>" — Telegram users without a linked GH account.
-- Resolution: QuorumAgent.voterKeyForTelegram.
CREATE TABLE idea_votes (
  idea_id INTEGER NOT NULL,
  voter_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (idea_id, voter_key)
);
```

## Conversational mode (no slash needed)

In addition to slash commands, the bot now reads every plain-text message and acts when it can do so safely. Three layers, in priority order:

1. **Silent observation.** Every message → `agent.observe(text, authorId, authorName, addressed)` → `messages` table. Free, no LLM call. Foundation for the "reads everything" pitch.
2. **Regex shortcuts.** Deterministic patterns dispatch instantly to existing methods. No LLM:
   - `+1 #N` / `👍 #N` / `vote #N` → `toggleVote(N, voterKeyForTelegram(userId))` (idempotent per user)
   - `kill #N` → `setStatus(N, "killed")`
   - `park #N` → `setStatus(N, "parked")`
   - `promote #N` → `promote(N)`
3. **LLM intent router** (only when **addressed** — `@<botUsername>`, reply-to-bot, or private chat). Runs `routeIntent(ai, target, priorContext, addressed)` against an OpenAI-style tool surface (`add_idea | propose_constraint | answer_question | record_member | validate_idea | noop`). The router is given the **target message** (the single line to act on) explicitly separated from **prior context** (older history, for situational awareness only — never a candidate for action). After dispatch, the target message's `intent_json` is set via `markRouted`, so it never re-fires next turn even though it stays in the rolling window. Confidence-banded:
   - `≥ 0.75` for safe non-cascading actions → execute, brief reply.
   - any `propose_constraint` → never auto-executes; stashes an `ActionPlan` in `pending_confirmations`, asks the user "reply *yes*…".
   - `noop` or low-confidence → minimal/no reply.

Pending confirmations live ≤ 180s. A user replying `yes` (or `y`/`yep`/`👍`/`✅`) inside the TTL runs the stashed plan via `executePlan`.

Prompt-injection guard runs before the LLM: known patterns ("ignore previous", "system:", "you are now") short-circuit to `noop`, no Neuron spent.

Slash commands remain the deterministic fallback path — `/constraint we lost a backend dev` always works, even if the router misfires live.

## Bot commands

Reply format is plain text (Telegram MarkdownV2 escaping handled by `format.ts`). `<>` = required, `[]` = optional.

| Command | Args | Effect | Reply shape |
|---------|------|--------|-------------|
| `/idea <text>` | text | INSERT into `ideas`, status=ideating | `Idea #N added — "<text>"` |
| `/ideas [phase]` | optional phase filter | SELECT, sorted by composite | List with `#id score text` |
| `/vote <id>` | idea id | Toggle vote for caller (idempotent per `(idea, voter)`) | `Voted. Total: N` / `Vote removed. Total: N` |
| `/brief <id> <text>` | id, one-line text | Set the one-line description shown on the card. Reuses `updateIdea`; logs `idea_edited`. | `#N brief updated.` |
| `/long <id> <text>` | id, long text | Set the long description shown in the editor modal. Reuses `updateIdea`; logs `idea_edited`. | `#N long description updated.` |
| `/event <url>` | url | Scrape, populate `context`, recompute fit on all ideas | `Context set: deadline=…, budget=…. Recomputed N ideas.` |
| `/constraint <text>` | text, or `-` to clear | With text: UPSERT `context`, **re-validate all parked/killed**. With `-`: clears both `context.constraints` (JSON array from `/event`) and `context.constraint` (singular). Empty: prints usage. | `Reanimated: [#x, #y]. Demoted: [#z]. Reason: …` / `Constraints cleared.` |
| `/me <text>` | free-text skills | LLM extract → `members.skills_json` | `Saved skills: [t1, t2, …]` |
| `/gh <username>` | gh handle | Fetch profile, merge into skills | Same as `/me` |
| `/team` | — | Aggregate skills + gaps | `Strong: [...]. Gaps: [...]. Members: N.` |
| `/forget` | — | DELETE from `members` where user_id=caller | `Wiped.` |
| `/name [text]` | optional name | Set or show this board's name. `-` clears. Stored in `context` under key `board_name`. | `Board renamed to: …` / `Board name cleared.` |
| `/deadline [when]` | optional free-form date/time string | Set or show the team's shipping deadline. `-` clears. Accepts absolute (`May 1 2026`, ISO 8601) **and** relative phrases (`in 2 hours`, `tomorrow at 5pm`, `next Friday`) — see `parseDeadline` in `src/deadline.ts`. Parseable inputs are normalized to a UTC absolute string (`May 1, 2026, 17:22 UTC`) before storage so the board never displays a stale relative phrase. Stored in `context` under key `deadline` — same key the scoring + plan prompts already read, and the same key `/event` populates. When the value resolves to a future date, `Agent.schedule()` queues nudges at T-72h / T-24h / T-0; clearing or replacing cancels the prior queue. | `Deadline set: <normalized when>` + nudge note / `Deadline cleared.` |
| `/promote <id>` | id | Move to next phase | `#id: ideating → validating` |
| `/park <id>` | id | status=parked | `#id parked. Eligible for backflow.` |
| `/kill <id>` | id | status=killed | `#id killed. Still queryable.` |
| `/why <id>` | id | Show validation reasoning + audit trail (joins `events`) | Multi-line: scores + reason + history |
| `/validate <id>` | id | Re-run scoring on a single idea against the current team + context. Routable via `validate_idea` ("rescore #3", "revalidate idea 7"). | `#id score: N/10 — <reason>` |
| `/rank` | — | Top 3 in active phase | List with score breakdown |
| `/plan <id>` | id | LLM plan: milestones, risks, owners | Markdown block |

## HTTP endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/webhook` | Telegram secret token header | Telegram update intake |
| `GET` | `/g/<token>` | Token in URL | Read-only HTML view (stretch) |
| `GET` | `/healthz` | none | Liveness ping |
| `GET` | `/auth/github/start` | none | Begin GitHub OAuth flow; sets state cookie, redirects |
| `GET` | `/auth/github/callback` | OAuth state cookie | Finish OAuth; sets `quorum_session` + `quorum_csrf` cookies |
| `POST` | `/auth/logout` | Session cookie + **CSRF** | Clear session and CSRF cookies |
| `GET` | `/api/me` | optional session | Returns `{login, avatar_url, can_vote, can_edit, csrf_token}` or `{}`. Lazily mints `quorum_csrf` if missing |
| `GET` | `/api/board` | optional session (used to compute `voted_by_me`) | Board JSON for `web/` (see "Board API") |
| `PATCH` | `/api/ideas/<uid>` | session + editor whitelist + **CSRF** | Edit `name` / `long` from the board UI |
| `PATCH` | `/api/board` | session + editor whitelist + **CSRF** | Edit board metadata: `name`, `deadline` |
| `DELETE` | `/api/board/constraints` | session + editor whitelist + **CSRF** | Clear all constraint rows (`constraints` JSON-array and singular `constraint`) |
| `POST` | `/api/ideas/<uid>/vote` | session (any GitHub user) + **CSRF** | Idempotent toggle of one vote per `(idea, voter)` |
| `POST` | `/api/dev-seed` | `X-Dev-Seed-Token` matching `DEV_SEED_TOKEN` secret | Local-only seed; route 404s when secret is unset |

**CSRF (double-submit cookie):** state-changing endpoints require both the
`quorum_session` cookie *and* a matching `X-Quorum-CSRF` header that equals
the `quorum_csrf` cookie value. The cookie is non-HttpOnly so the web client
can read it; cross-origin attackers can't read it, so they can't forge the
header even when the browser ships the session cookie. Token is a 64-char
opaque hex string, minted at session creation (`finishOAuth`) and surfaced in
`/api/me`'s response body for the client. Validation is constant-time
compare. Mismatch → `403 {"error": "csrf"}`.

## Board API

Lives in `quorum/` (the same Worker that handles the Telegram webhook). One DO per Telegram chat — the same `QuorumAgent` that owns ideas state. The Worker also serves the built `web/` bundle as static assets, so the prod UI is same-origin and the frontend uses relative paths (no `VITE_API_BASE`).

### Chat resolution

`?chat=<telegram_chat_id>` query param targets a specific chat's DO. If absent, the worker falls back to the `DEFAULT_BOARD_CHAT` var in `wrangler.jsonc` (currently `-5120669057`, the team coord group). For the demo, point this at the demo group's chat ID.

### Stage ↔ status mapping

The board UI has 3 columns; SPEC has 5 statuses. The board only renders `ideating | validating | planning`; `parked` and `killed` are off-board.

| Board stage  | SPEC status   |
|--------------|---------------|
| `bucket`     | `ideating`    |
| `candidates` | `validating`  |
| `selected`   | `planning`    |
| —            | `parked`      |
| —            | `killed`      |

### `uid` (string) vs `id` (integer)

The board surface uses an opaque string `uid = "qrm_" + zero-padded(id, 6)` (e.g. `qrm_000017`). Reversible. The SPEC `id INTEGER` is the source of truth — `uid` is purely a presentation/cache-key concern. Internal SPEC calls keep using the integer.

### Card score (1–10)

Derived, not stored. `score = round(composite × 10)` clamped to `[0, 10]` where `composite` follows the existing formula (`0.5*team + 0.4*resource + 0.1*market`, market default 0.5). Adjust SPEC weights → board score updates automatically.

### Endpoints

`GET /api/board` returns `{ ideas: Idea[], name: string | null, deadline: string | null, team: BoardMember[], context: ContextEntry[] }` ordered by `id ASC`, restricted to board-visible statuses. `name` is the human-readable board name (set via `/start <name>` or `/name`; or auto-defaulted to the Telegram chat's `title` on first `/start` in a group; stored in `context.board_name`). `deadline` is the team's free-form shipping deadline lifted from `context.deadline` to the top level so the UI doesn't have to scan the array (set via `/deadline`, `PATCH /api/board`, or `/event` URL extraction). `team` is the per-chat member list — telegram user IDs are **not** exposed. `context` is the per-chat key/value block, with `board_name` excluded (already top-level) and JSON-shaped values (`constraints`, `challenges`) parsed; `deadline` still appears here for completeness so anything reading the array sees the same source of truth.

```ts
type BoardMember = {
  name: string;            // display_name fallback to gh_user fallback to "anon"
  gh_user: string | null;  // drives the avatar (https://github.com/<u>.png)
  skills: string[];
  availability: string | null;
};

type ContextEntry = {
  key: string;             // e.g. "deadline", "event_url", "constraints"
  value: unknown;          // string, or parsed array for constraints/challenges
};
```

The `Idea` shape:

```ts
type Idea = {
  uid: string;       // qrm_NNNNNN
  name: string;
  brief: string;     // falls back to `text` if `brief` is empty
  long: string;
  hours: number | null;
  score: number;            // 0–10 integer, derived from composite
  score_team: number | null;     // 0–1 raw fit, null until validated
  score_resource: number | null; // 0–1 raw fit, null until validated
  score_votes: number;           // 0–1, voteFit(votes) = min(votes / VOTE_SATURATION, 1), VOTE_SATURATION=5
  score_reason: string | null;   // last_reason from the most recent scoring
  stage: 'bucket' | 'candidates' | 'selected';
  votes: number;
  voted_by_me: boolean;
};
```

The `score_*` fields back the in-card "click the score to see the breakdown" UI in `web/`. The composite score is `composite = 0.5*team + 0.4*resource + 0.1*voteFit(votes)` scaled to 0–10; the per-fit values are exposed so the UI can render a progress bar per category. `score_reason` is the LLM's one-sentence rationale (≤150 chars, see `prompts/scoring.md`).

`PATCH /api/ideas/<uid>` accepts `{ name?: string, brief?: string, long?: string }`. Other fields are agent-owned and rejected. Writes append an `idea_edited` row to `events`. Response: `{ idea: Idea }`.

`PATCH /api/board` accepts `{ name?: string, deadline?: string }`. Editor-only. Each provided string overwrites the corresponding `context` row (`board_name`, `deadline`); empty string clears. Writes append a `context_changed` event. Response: `{ name, deadline }`.

CORS is pinned to `env.PUBLIC_BASE_URL` in prod (wildcard fallback when the var is unset, e.g. local dev). The board UI is same-origin in prod, so CORS only matters for stray third-party callers.

### Schema additions

The board needs `name`, `brief`, `long`, `hours` on `ideas`. These are append-only `ALTER TABLE ADD COLUMN` migrations in `quorum/src/schema.ts → ADDITIVE_MIGRATIONS`, run idempotently in `onStart()`. Existing rows (created before the migration) render with `name = brief = text`.

## Internal `QuorumAgent` methods

The Agent class is the canonical state owner. All command handlers go through these.

| Method | Args | Returns | Caller |
|--------|------|---------|--------|
| `addIdea(text, authorId)` | `string, string` | `{ id: number }` | `/idea`, router `add_idea` |
| `toggleVote(id, voterKey)` | `number, string` | `{ votes, voted }` | `POST /api/ideas/<uid>/vote`, `/vote`, regex `+1 #N`. Idempotent on `(idea_id, voter_key)` in `idea_votes` |
| `voterKeyForTelegram(telegramUserId)` | `string` | `string` | Resolves a Telegram user to a voter_key. Returns `gh:<login>` if the user has linked a GH account via `/gh`, else `tg:<userId>`. Lets a single person voting from web AND Telegram share one vote. |
| `getBoardName()` | — | `string \| null` | Read the human-friendly board name from `context.board_name`. Used by `/api/board`, the welcome message, and the answer-question snapshot. |
| `getTeamForBoard()` | — | `BoardMember[]` | Public projection of `members` for the web UI. Telegram user IDs are NOT exposed; only `name`, `gh_user`, `skills`, `availability`. Drives the rail's "Team" section. |
| `getContextForBoard()` | — | `ContextEntry[]` | Public projection of `context` for the web UI. `board_name` excluded; JSON-shaped values (`constraints`, `challenges`) parsed into arrays. Drives the rail's "Context" section. |
| `setBoardName(name)` | `string` | `string \| null` | Set / clear (`""`) the board name. Trimmed and clipped to 80 chars. Logs a `context_changed` event. |
| `getDeadline()` | — | `string \| null` | Read the free-form deadline string from `context.deadline`. Already consumed by `validateIdea` and `planFor`; now also surfaced via `/api/board` and the board header. |
| `setDeadline(deadline)` | `string` | `Promise<string \| null>` | Set / clear (`""`) the deadline. Trimmed and clipped to 200 chars. Logs a `context_changed` event. Inputs run through `parseDeadline()` (handles relative phrases like `in 2 hours`, `tomorrow at 5pm`, `next Friday`, plus anything `Date.parse()` accepts); parseable inputs are normalized to a UTC absolute display string (`May 1, 2026, 17:22 UTC`) via `formatDeadline()` and that's what's stored + returned. **Side effect**: cancels any previously-scheduled `nudgeDeadline` runs; if the parsed `Date` is in the future, schedules one-shots at T-72h / T-24h / T-0 via `Agent.schedule()`. Strings that don't parse (e.g. `"end of sprint"`) are stored verbatim but skip scheduling. |
| `nudgeDeadline({ kind })` | `{ kind: "soon" \| "today" \| "now" }` | `Promise<void>` | Scheduled callback. Posts a deadline-aware message to the chat (`bot.api.sendMessage(this.name, …)`). Reads live idea counts at firing time, not registration time, so the message reflects the current board. Drops silently if the deadline was cleared between scheduling and firing. |
| `listIdeas(phase?)` | `string?` | `Idea[]` | `/ideas`, `/rank` |
| `rank(limit)` | `number` | `Idea[]` | `/rank`, router `answer_question` |
| `setContext(updates)` | `Record<string,string>` | `{ recomputed: number }` | `/event`, `/constraint` |
| `validateIdea(id)` | `number` | `{ team, resource, market, reason }` | scoring pipeline |
| `reanimate(constraint)` | `string` | `{ reanimated: id[], demoted: id[], reason: string }` | `/constraint`, confirmed `propose_constraint` |
| `setMember(userId, patch)` | `string, Partial<Member>` | `Member` | `/me`, `/gh`, router `record_member` |
| `noteTelegramMember(userId, displayName)` | `string\|null, string\|null` | `void` | Auto-add the speaker on first sight in chat — `/me` is no longer required to land on the team. Idempotent: insert if missing; backfill `display_name` only when it was null/empty. Called from `observe()` and from a grammy middleware that fires before every command. Skips `null` / `"anon"`. |
| `noteGithubMember(login)` | `string` | `void` | Auto-add a signed-in GitHub user to the team on `GET /api/board`. Idempotent: skips if a member already exists with `user_id = "gh:<lowercased_login>"` OR `LOWER(gh_user) = lowercased_login` (so a Telegram user who linked the same account via `/gh` doesn't get a duplicate row). |
| `forgetMember(userId)` | `string` | `void` | `/forget` |
| `clearConstraints()` | — | `void` | Delete both `context.constraints` (JSON-array, set by `/event`) and `context.constraint` (singular, set by `/constraint`). Logs `context_changed`. Driven by `/constraint -` from Telegram and `DELETE /api/board/constraints` from the board UI (editor-only). |
| `teamSummary()` | — | `{ strong: string[], gaps: string[], members: number }` | `/team` |
| `planFor(id)` | `number` | `string` (markdown) | `/plan` |
| `getBoard(voterKey)` | `string \| null` | `BoardIdea[]` | `GET /api/board` (voterKey populates `voted_by_me`) |
| `updateIdea(id, patch, editor, voterKey)` | `number, {name?, brief?, long?}, string, string\|null` | `BoardIdea \| null` | `PATCH /api/ideas/:uid` (Worker enforces editor whitelist before forwarding); also called by Telegram `/brief`, `/long` with `editor = "tg:<userId>"` |
| `observe(text, authorId, authorName, addressed)` | `string, string\|null, string\|null, boolean` | `number` (inserted message id) | every plain-text message |
| `markRouted(messageId, intent)` | `number, ActionPlan` | `void` | After router dispatch (or any deterministic handling). Sets `messages.intent_json` so the message stops being a candidate for re-action. |
| `priorContext(beforeId, limit?)` | `number, number?` (default 7) | `Message[]` | Older unrouted history (intent_json IS NULL), oldest-first. Router context only — never the action target. |
| `recentMessages(limit?)` | `number?` (default 8) | `Message[]` | Generic recent-window read; oldest-first. |
| `pendingConfirmation(userId)` | `string` | `ActionPlan \| null` | "yes" reply lookup |
| `setPendingConfirmation(userId, plan, ttlSec?)` | `string, ActionPlan, number?` | `void` | router proposals |
| `clearPendingConfirmation(userId)` | `string` | `void` | after execute / TTL expiry |

## LLM prompt contracts

Each prompt has a strict input shape and JSON output schema. **Don't free-form responses** — prompts must say "respond with JSON only matching this shape." Caller validates and retries on parse failure.

### Skill extraction
- **Input:** free text from `/me`, optional GH summary
- **Output:** `{ "skills": string[] }` — each skill ≤ 3 words, lowercased
- **Default model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Fallback:** `@cf/meta/llama-3.1-8b-instruct-fast`

### Validation scoring
- **Input:** `{ idea: string, context: { event, deadline, budget, constraints[] }, team: { skills_aggregate } }`
- **Output:** `{ "team_fit": number, "resource_fit": number, "reason": string }` — fits in [0,1], reason ≤ 200 chars
- **Default model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Fallback:** `@cf/meta/llama-3.1-8b-instruct-fast` (when 70B is rate-limited or times out)

### Plan generation
- **Input:** `{ idea, team_skills, deadline, constraints }`
- **Output:** Markdown sections — `## Milestones`, `## Risks`, `## Suggested owners`. No JSON wrapper.
- **Default model:** Llama 3.3 70B

### Event page scrape extraction
- **Input:** raw markdown of fetched event page
- **Output:** `{ "deadline": string?, "challenges": [{ name, prize, requirements }], "constraints": string[] }`
- **Default model:** Llama 3.3 70B

## Composite scoring

```
composite = 0.5 × team_fit + 0.4 × resource_fit + 0.1 × voteFit(votes)
voteFit(v) = min(v / VOTE_SATURATION, 1)   // VOTE_SATURATION = 5
```

Weights sum to 1.0. Net effect: 0 votes → −0.05 vs baseline; ≥5 votes → +0.05. **Never tune weights without updating SPEC and pinging the team in chat.**

Threshold for auto-promotion `ideating → validating`: composite ≥ 0.70 AND votes ≥ 1.
Threshold for backflow reanimation `parked|killed → ideating`: new composite ≥ 0.65 under updated context.

## Phase state machine

```
ideating ──/promote──▶ validating ──/promote──▶ planning
   ▲                       │                        │
   │                       ▼                        ▼
   └──── backflow ──── parked / killed ◀────────────┘
              (auto, when /constraint changes context)
```

Manual transitions: `/promote`, `/park`, `/kill`. Automatic: backflow re-validation only.

## Logging contract

Every state-changing call appends to `events` with:
- `event_type`: `idea_added | idea_voted | idea_phase_change | context_changed | scored | reanimated | demoted | idea_edited | observed | router_call | injection_blocked | stall_nudge`
- `payload`: JSON with relevant deltas (old → new for phase changes; full score breakdown for `scored`; `{ chat_id }` for `stall_nudge`)

`/why <id>` is a SELECT on this table — don't break the contract or `/why` lies.

## Scheduled tasks

| Schedule | Method | Cadence | Behaviour |
|---|---|---|---|
| `stallNudgeTick` | `QuorumAgent.stallNudgeTick` | every 24h (idempotent `scheduleEvery`) | Picks one parked idea older than 7 days and posts a "still parked? kill, revive, or leave?" nudge to the chat. No-op if `context.chat_id` isn't set or no eligible idea. Logs `stall_nudge`. |

The chat ID is captured in `context.chat_id` on every Telegram webhook hit
(forwarded from the Worker via `x-quorum-chat` header). The cron stays a
no-op until the first message arrives in a fresh chat.
