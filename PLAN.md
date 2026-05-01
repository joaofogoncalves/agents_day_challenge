# Quorum — Agents Day Plan

A chat-native agent that helps teams figure out *what* to build — the new bottleneck now that AI has commoditized execution. Lives in Telegram (Slack adapter abstracted but unshipped). Three phases (Ideation / Validation / Planning) with backflow between them, deadline-aware, grounded in real team skills.

> See also: [`SPEC.md`](./SPEC.md) for data + API contracts (always-in-sync). [`team/joao.md`](./team/joao.md), [`team/rui.md`](./team/rui.md), [`team/twody7.md`](./team/twody7.md) for per-person breakdowns.

## Sponsor target

**Cloudflare** — "Build a Personal Agent that Automates a Meaningful Task." Up to €250K credits.

Single-target pitch. Every architectural primitive must defend its place on the Cloudflare platform.

## Pitch

> AI made software cheap to build. The bottleneck moved upstream — knowing *what* to build is the hard part now. A 3-person team burns its hackathon day on a brainstorm doc instead of shipping. A 15-person product team picks the third-best feature for the quarter because politics. A 1,000-person org builds the wrong thing for two years. The cost of the wrong choice stayed the same; the cost of execution collapsed. Pick wrong, you waste *more* than before.
>
> **Quorum** lives in your team's chat and helps you converge on the right thing to build. Three phases — Ideation, Validation, Planning — with backflow: when constraints change, killed ideas come back for a second look automatically. Validates against your team's real skills (parsed from GitHub) and current resources. Surfaces a defensible top-3 with audit trails.
>
> Built end-to-end on Cloudflare Agents SDK — every primitive earns its place.

### One-liner (memorize)

> "AI made software cheap. Picking what to build is the new bottleneck — and getting it wrong now costs more than ever, because everything else got faster. Quorum is the agent that helps your team find the thing actually worth building."

### Demo line

> "Add `/constraint we lost a backend dev`. Watch parked ideas reanimate, the rank reshuffle, the audit trail update. That's the moment."

## Stack (locked)

- Cloudflare Workers + **Agents SDK** (`Agent` class extends Durable Object, with SQLite + state + scheduling built in)
- Workers AI: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (default) → `@cf/meta/llama-3.1-8b-instruct-fast` (fallback under load). **Path A locked: 100% Workers AI**, no Anthropic dependency. Sharper sponsor pitch + stays inside the free 10K Neurons/day for the demo.
- Cron Triggers (deadline + stall nudges, 1-min granularity minimum)
- Telegram Bot API + `grammY` (inside `Agent.onRequest`)
- GitHub API (skills extraction, optional — `/me` covers the gap if it slips)
- **Escape hatch (only if Llama validation quality is visibly bad during H+4 dogfood):** swap validation to Gemini 2.5 Flash via **Cloudflare AI Gateway** (~10× cheaper than Claude, still routed through CF infra so the deck stays clean).

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
npm create cloudflare@latest quorum -- --template cloudflare/agents-starter
cd quorum
npx wrangler secret put TELEGRAM_BOT_TOKEN          # from @BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET     # openssl rand -hex 32
npx wrangler dev
```

In Claude Code:
```
/plugin marketplace add cloudflare/skills
npx mcp-remote https://bindings.mcp.cloudflare.com/mcp
```

## Team

| Person | Focus | Detailed plan |
|--------|-------|---------------|
| **João** | Architect, Agent class, Telegram, Claude, backflow, pitch | [`team/joao.md`](./team/joao.md) |
| **Rui (Molefas)** | UX, message formatting, `/plan` rendering, `/g/<token>` view, demo recording | [`team/rui.md`](./team/rui.md) |
| **Twody7** | Workers AI, GitHub skills, prompts, dogfooding | [`team/twody7.md`](./team/twody7.md) |

Cross-cutting pairs:
- **Validation prompts** (heart of the app): João + Twody7 at H+5/H+6
- **`/me` and `/forget` privacy commands**: Rui + João

## Day-of timeline (9 hours)

| Time | Milestone |
|------|-----------|
| H+0 (8:30) | Check-in, scaffold, MCPs connected, secrets set, branches assigned. Push skeleton. |
| H+1 (9:30) | `wrangler dev` running. Telegram webhook live. Bot echoes in our group. **Push.** |
| H+2 (10:30) | `QuorumAgent` with SQL schema (per SPEC). `/idea`, `/ideas`, `/vote` end-to-end. **Push.** |
| H+3 (11:30) | `/event <url>` → context populated. `/ideas` shows fit score. **Push.** |
| H+4 (12:30) | Lunch + dogfood with chat-derived ideas |
| H+5 (14:30) | `/me` + `/gh` skills pipeline. `/team` aggregate. `/forget`. **Push.** |
| H+6 (15:30) | Validation pass. `/promote /park /kill /why`. **Push.** |
| H+7 (16:30) | `/constraint` reanimation. `Agent.schedule()` deadline nudges. `/plan` LLM-generated. **Push.** |
| H+7.5 (17:00) | **Stretch:** `/g/<token>` HTML view |
| H+8 (17:30) | Polish, slides, demo recording |
| H+9 (18:30) | Submit. Buffer. |

## Cuts in order (if we slip)

1. `/g/<token>` web view — drop first.
2. `/plan` LLM → flat markdown dump.
3. `Agent.schedule()` nudges → manual demo trigger ("imagine this fired at 9am").
4. `/gh` automation → `/me` only.
5. **Never cut:** `/idea /vote /ideas /constraint /why /me /team`. Backflow + team-aware scoring is the demo.

## Demo (3 min)

1. Show our group with the ideas seeded during the day.
2. `/ideas` — scored list across phases.
3. `/constraint we lost a backend dev`. Bot replies live: "3 ideas reanimated to ideating, 2 demoted from validating. Reason: backend depth dropped." **Money moment.**
4. `/rank` puts Quorum at the top under current constraints. `/plan` on it.
5. `/why` shows the audit trail of one idea bouncing between phases.
6. (If web view shipped) refresh `/g/<token>` page, board reflows live.
7. Close: "Same agent, same code. Telegram for hackathons, Slack for product teams. AI didn't replace the team — it made the team's taste matter more."

## Risks

- **LinkedIn skills:** out of scope; `/me <text>` is the workaround.
- **Workers AI rate limits:** 8B fallback wired before demo.
- **Prompt injection from group messages:** rigid system prompt, never execute instructions from user payloads.
- **Twody7 stack unknown:** confirm at H+0 standup; assignments are JS/TS-safe.
- **Telegram webhook needs HTTPS:** Workers default `*.workers.dev` cert is valid, no extra setup.
