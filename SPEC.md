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
  score_market REAL,        -- placeholder column, ungated for now
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
3. **LLM intent router** (only when **addressed** — `@<botUsername>`, reply-to-bot, or private chat). Runs `routeIntent(ai, recentMessages, addressed)` against an OpenAI-style tool surface (`add_idea | propose_constraint | answer_question | record_member | noop`). Confidence-banded:
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
| `/event <url>` | url | Scrape, populate `context`, recompute fit on all ideas | `Context set: deadline=…, budget=…. Recomputed N ideas.` |
| `/constraint <text>` | text | UPSERT `context`, **re-validate all parked/killed** | `Reanimated: [#x, #y]. Demoted: [#z]. Reason: …` |
| `/me <text>` | free-text skills | LLM extract → `members.skills_json` | `Saved skills: [t1, t2, …]` |
| `/gh <username>` | gh handle | Fetch profile, merge into skills | Same as `/me` |
| `/team` | — | Aggregate skills + gaps | `Strong: [...]. Gaps: [...]. Members: N.` |
| `/forget` | — | DELETE from `members` where user_id=caller | `Wiped.` |
| `/name [text]` | optional name | Set or show this board's name. `-` clears. Stored in `context` under key `board_name`. | `Board renamed to: …` / `Board name cleared.` |
| `/promote <id>` | id | Move to next phase | `#id: ideating → validating` |
| `/park <id>` | id | status=parked | `#id parked. Eligible for backflow.` |
| `/kill <id>` | id | status=killed | `#id killed. Still queryable.` |
| `/why <id>` | id | Show validation reasoning + audit trail (joins `events`) | Multi-line: scores + reason + history |
| `/rank` | — | Top 3 in active phase | List with score breakdown |
| `/plan <id>` | id | LLM plan: milestones, risks, owners | Markdown block |

## HTTP endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/webhook` | Telegram secret token header | Telegram update intake |
| `GET` | `/g/<token>` | Token in URL | Read-only HTML view (stretch) |
| `GET` | `/healthz` | none | Liveness ping |
| `GET` | `/auth/github/start` | none | Begin GitHub OAuth flow; sets state cookie, redirects |
| `GET` | `/auth/github/callback` | OAuth state cookie | Finish OAuth; sets `quorum_session` cookie |
| `POST` | `/auth/logout` | Session cookie | Clear session cookie |
| `GET` | `/api/me` | optional session | Returns `{login, avatar_url, can_vote, can_edit}` or `{}` |
| `GET` | `/api/board` | optional session (used to compute `voted_by_me`) | Board JSON for `web/` (see "Board API") |
| `PATCH` | `/api/ideas/<uid>` | session **and** editor whitelist | Edit `name` / `long` from the board UI |
| `POST` | `/api/ideas/<uid>/vote` | session (any GitHub user) | Idempotent toggle of one vote per `(idea, voter)` |
| `POST` | `/api/dev-seed` | `X-Dev-Seed-Token` matching `DEV_SEED_TOKEN` secret | Local-only seed; route 404s when secret is unset |

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

`GET /api/board` returns `{ ideas: Idea[], name: string | null }` ordered by `id ASC`, restricted to board-visible statuses. `name` is the human-readable board name (set via `/start <name>` or `/name`, stored in `context.board_name`). The `Idea` shape:

```ts
type Idea = {
  uid: string;       // qrm_NNNNNN
  name: string;
  brief: string;     // falls back to `text` if `brief` is empty
  long: string;
  hours: number | null;
  score: number;     // 0–10 integer, derived
  stage: 'bucket' | 'candidates' | 'selected';
};
```

`PATCH /api/ideas/<uid>` accepts `{ name?: string, long?: string }`. Other fields are agent-owned and rejected. Writes append an `idea_edited` row to `events`. Response: `{ idea: Idea }`.

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
| `setBoardName(name)` | `string` | `string \| null` | Set / clear (`""`) the board name. Trimmed and clipped to 80 chars. Logs a `context_changed` event. |
| `listIdeas(phase?)` | `string?` | `Idea[]` | `/ideas`, `/rank` |
| `rank(limit)` | `number` | `Idea[]` | `/rank`, router `answer_question` |
| `setContext(updates)` | `Record<string,string>` | `{ recomputed: number }` | `/event`, `/constraint` |
| `validateIdea(id)` | `number` | `{ team, resource, market, reason }` | scoring pipeline |
| `reanimate(constraint)` | `string` | `{ reanimated: id[], demoted: id[], reason: string }` | `/constraint`, confirmed `propose_constraint` |
| `setMember(userId, patch)` | `string, Partial<Member>` | `Member` | `/me`, `/gh`, router `record_member` |
| `forgetMember(userId)` | `string` | `void` | `/forget` |
| `teamSummary()` | — | `{ strong: string[], gaps: string[], members: number }` | `/team` |
| `planFor(id)` | `number` | `string` (markdown) | `/plan` |
| `getBoard(voterKey)` | `string \| null` | `BoardIdea[]` | `GET /api/board` (voterKey populates `voted_by_me`) |
| `updateIdea(id, patch, editor, voterKey)` | `number, {name?, long?}, string, string\|null` | `BoardIdea \| null` | `PATCH /api/ideas/:uid` (Worker enforces editor whitelist before forwarding) |
| `observe(text, authorId, authorName, addressed)` | `string, string\|null, string\|null, boolean` | `void` | every plain-text message |
| `recentMessages(limit?)` | `number?` (default 8) | `Message[]` | router context |
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
composite = 0.5 × team_fit + 0.4 × resource_fit + 0.1 × market_placeholder
```

Weights sum to 1.0. `market_placeholder` is constant `0.5` until we wire the market signal. **Never tune weights without updating SPEC and pinging the team in chat.**

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
- `event_type`: `idea_added | idea_voted | idea_phase_change | context_changed | scored | reanimated | demoted | idea_edited`
- `payload`: JSON with relevant deltas (old → new for phase changes; full score breakdown for `scored`)

`/why <id>` is a SELECT on this table — don't break the contract or `/why` lies.
