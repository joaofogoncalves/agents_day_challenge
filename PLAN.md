# HackBuddy — Agents Day Plan

A Telegram-native agent that helps teams converge chaotic group brainstorms into a shippable plan. Three phases (Ideation / Validation / Planning), backflow between them, deadline-aware, grounded in real team skills.

## Sponsor target

**Cloudflare** — "Build a Personal Agent that Automates a Meaningful Task." Up to €250K credits.

Single-target pitch. Every architectural primitive must defend its place on the Cloudflare platform.

## Pitch

> HackBuddy converges chaotic group brainstorms into a shippable plan, and remembers everything when constraints shift. Built end-to-end on the Cloudflare Agents SDK — one Agent class per chat, with durable SQLite state, Workers AI scoring, Cron-driven deadline nudges. The `/constraint` command is the demo: watch parked ideas reanimate live as the world changes around them.

## Stack (locked)

- Cloudflare Workers + **Agents SDK** (`Agent` class extends Durable Object, with SQLite + state + scheduling built in)
- Workers AI: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (default) → `@cf/meta/llama-3.1-8b-instruct-fast` (fallback under load)
- Anthropic Claude via raw `fetch` to `api.anthropic.com` (heavy reasoning: validation scoring)
- Cron Triggers (deadline + stall nudges, 1-min granularity minimum)
- Telegram Bot API + `grammY` (inside `Agent.onRequest`)
- GitHub API (skills extraction, optional — `/me` covers the gap if it slips)

Dropped from earlier drafts and why:
- **D1** — Agent's per-chat SQLite covers our needs. D1 only earns its place for cross-org leaderboards (out of scope).
- **Workflows** — `Agent.schedule()` covers pause/resume. Mention as "could add" in the deck, not in the codebase.
- **SelfClaw** — €275 for material extra integration risk. Single-sponsor focus is sharper.

Critical gotchas:
- `wrangler.jsonc` migrations must use `new_sqlite_classes`, **not** `new_classes`. Wrong tag silently falls back to legacy KV.
- Workers AI free tier = 10K Neurons/day. Have the 8B model fallback wired before demo.
- No native Claude binding on Workers AI — Claude is `fetch` only.

## Scaffolding (H+1)

```bash
npm create cloudflare@latest hackbuddy -- --template cloudflare/agents-starter
cd hackbuddy
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler dev
```

In Claude Code:
```
/plugin marketplace add cloudflare/skills
npx mcp-remote https://bindings.mcp.cloudflare.com/mcp
```

## Team responsibilities

### João — Architect & lead
- Project scaffolding, `wrangler.jsonc`, secrets, MCP setup
- `HackBuddyAgent` class + SQL schema design
- Telegram webhook wiring (`setWebhook`, signature check, grammY routing)
- Claude API fallback for scoring
- Backflow logic (the `/constraint` demo moment)
- Pitch deck + demo storytelling

### Rui (Molefas) — UX & visible surface
- Telegram message UX: command help text, formatting, markdown output
- `/plan` output rendering (clean markdown blocks)
- **Stretch:** `/g/<token>` read-only HTML view (server-rendered from `this.sql`, leaderboard + members + phase board)
- Demo recording, screen capture polish

### Twody7 — Integrations & content
- Workers AI integration (Llama 3.3 calls, prompt templates, response parsing, fallback wiring)
- GitHub API skill extraction (fetch top repos + langs → Claude → skills array)
- Dogfooding script: seed the bot with our chat history from yesterday, verify scoring sanity
- Confirm stack at H+0 standup (no public repo signal — adjust assignments if needed)

### Pairs / cross-cutting
- **Validation prompts** (heart of the app): João + Twody7
- **Cron nudges**: anyone, ~30 min slot
- **`/me` and `/forget` privacy commands**: Rui + João

## Day-of timeline (9 hours)

| Time   | Milestone |
|--------|-----------|
| H+0 (8:30)  | Check-in, scaffold project, MCPs connected, secrets set, branches assigned |
| H+1 (9:30)  | `wrangler dev` running. Telegram webhook live. Bot echoes in our group |
| H+2 (10:30) | `HackBuddyAgent` with SQL schema. `/idea`, `/ideas`, `/vote` end-to-end |
| H+3 (11:30) | `/event <url>` → context table populated. `/ideas` shows fit score |
| H+4 (12:30) | Lunch + dogfood with chat-derived ideas |
| H+5 (14:30) | `/me` + `/gh` skills pipeline. `/team` aggregate. `/forget` |
| H+6 (15:30) | Validation pass (`team_fit × resource_fit`). `/promote /park /kill /why` |
| H+7 (16:30) | `/constraint` reanimation. `Agent.schedule()` deadline nudges. `/plan` LLM-generated |
| H+7.5 (17:00) | **Stretch:** `/g/<token>` HTML view |
| H+8 (17:30) | Polish, slides, demo recording |
| H+9 (18:30) | Submit. Buffer for breakage |

## Cuts in order (if we slip)

1. `/g/<token>` web view — drop first.
2. `/plan` LLM → flat markdown dump.
3. `Agent.schedule()` nudges → manual demo trigger ("imagine this fired at 9am").
4. `/gh` automation → `/me` only.
5. **Never cut:** `/idea /vote /ideas /constraint /why /me /team`. Backflow + team-aware scoring is the demo.

## Schema (`HackBuddyAgent` SQLite)

```sql
CREATE TABLE ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ideating', -- ideating|validating|planning|parked|killed
  score_team REAL,
  score_resource REAL,
  score_market REAL,  -- placeholder column, ungated for now
  votes INTEGER DEFAULT 0,
  last_validated_at INTEGER,
  last_reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE members (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  gh_user TEXT,
  skills_json TEXT,  -- JSON array of skill strings
  availability TEXT,
  joined_at INTEGER NOT NULL
);

CREATE TABLE context (
  key TEXT PRIMARY KEY,  -- 'event_url', 'deadline', 'budget', etc
  value TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER,
  event_type TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);
```

## Commands

| Command | Effect |
|---------|--------|
| `/idea <text>` | Add idea, returns ID |
| `/ideas [phase]` | List ideas, optionally filtered by phase, with composite score |
| `/vote <id>` | +1 vote |
| `/event <url>` | Set constraint context from event page; recompute fit on all ideas |
| `/constraint <text>` | Append/update constraint; **re-validate all parked/killed ideas** (backflow) |
| `/me <text>` | Self-declare skills (free text, LLM extracts) |
| `/gh <username>` | Optional: pull GH profile, merge into skills |
| `/team` | Aggregated team skills + gaps |
| `/forget` | Wipe my row from members |
| `/promote <id>` | Move to next phase |
| `/park <id>` | Pause; eligible for backflow |
| `/kill <id>` | Reject; still queryable for backflow |
| `/why <id>` | Show validation reasoning + audit trail |
| `/rank` | Top 3 in active phase by composite score |
| `/plan <id>` | LLM-generated plan (milestones, risks, suggested owners from skills) |

## Demo (3 min)

1. Show our group with the ideas seeded during the day.
2. `/ideas` — scored list across phases.
3. `/constraint we lost a backend dev`. Bot replies live: "3 ideas reanimated to ideating, 2 demoted from validating. Reason: backend depth dropped." **Money moment.**
4. `/rank` puts HackBuddy at the top under current constraints. `/plan` on it.
5. `/why` shows the audit trail of one idea bouncing between phases.
6. (If web view shipped) refresh `/g/<token>` page, board reflows live.
7. Close: "Same agent, same code. Telegram for hackathons, Slack for product teams."

## Risks

- **LinkedIn skills:** out of scope; `/me <text>` is the workaround.
- **Workers AI rate limits:** 8B fallback wired before demo.
- **Prompt injection from group messages:** rigid system prompt, never execute instructions from user payloads.
- **Twody7 stack unknown:** confirm at H+0 standup; assignments are JS/TS-safe.
- **Telegram webhook needs HTTPS:** Workers default `*.workers.dev` cert is valid, no extra setup.
