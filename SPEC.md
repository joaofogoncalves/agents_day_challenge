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
  text TEXT NOT NULL,
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
```

## Bot commands

Reply format is plain text (Telegram MarkdownV2 escaping handled by `format.ts`). `<>` = required, `[]` = optional.

| Command | Args | Effect | Reply shape |
|---------|------|--------|-------------|
| `/idea <text>` | text | INSERT into `ideas`, status=ideating | `Idea #N added — "<text>"` |
| `/ideas [phase]` | optional phase filter | SELECT, sorted by composite | List with `#id score text` |
| `/vote <id>` | idea id | +1 vote | `Voted. Total: N` |
| `/event <url>` | url | Scrape, populate `context`, recompute fit on all ideas | `Context set: deadline=…, budget=…. Recomputed N ideas.` |
| `/constraint <text>` | text | UPSERT `context`, **re-validate all parked/killed** | `Reanimated: [#x, #y]. Demoted: [#z]. Reason: …` |
| `/me <text>` | free-text skills | LLM extract → `members.skills_json` | `Saved skills: [t1, t2, …]` |
| `/gh <username>` | gh handle | Fetch profile, merge into skills | Same as `/me` |
| `/team` | — | Aggregate skills + gaps | `Strong: [...]. Gaps: [...]. Members: N.` |
| `/forget` | — | DELETE from `members` where user_id=caller | `Wiped.` |
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

## Internal `QuorumAgent` methods

The Agent class is the canonical state owner. All command handlers go through these.

| Method | Args | Returns | Caller |
|--------|------|---------|--------|
| `addIdea(text, authorId)` | `string, string` | `{ id: number }` | `/idea` |
| `voteIdea(id, userId)` | `number, string` | `{ votes: number }` | `/vote` |
| `listIdeas(phase?)` | `string?` | `Idea[]` | `/ideas`, `/rank` |
| `setContext(updates)` | `Record<string,string>` | `{ recomputed: number }` | `/event`, `/constraint` |
| `validateIdea(id)` | `number` | `{ team, resource, market, reason }` | scoring pipeline |
| `reanimate(constraint)` | `string` | `{ reanimated: id[], demoted: id[], reason: string }` | `/constraint` |
| `setMember(userId, patch)` | `string, Partial<Member>` | `Member` | `/me`, `/gh` |
| `forgetMember(userId)` | `string` | `void` | `/forget` |
| `teamSummary()` | — | `{ strong: string[], gaps: string[], members: number }` | `/team` |
| `planFor(id)` | `number` | `string` (markdown) | `/plan` |

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
- `event_type`: `idea_added | idea_voted | idea_phase_change | context_changed | scored | reanimated | demoted`
- `payload`: JSON with relevant deltas (old → new for phase changes; full score breakdown for `scored`)

`/why <id>` is a SELECT on this table — don't break the contract or `/why` lies.
