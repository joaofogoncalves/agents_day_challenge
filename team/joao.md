# João — Lead architect

**Scope:** project bootstrap, the Agent class, Telegram wiring, Claude API integration, backflow logic, pitch deck.

## Files I own

- `wrangler.jsonc`
- `src/index.ts` — Worker entry, `routeAgentRequest`
- `src/agent.ts` — `QuorumAgent` class
- `src/telegram.ts` — grammY wiring, `setWebhook` helper, signature check
- `src/claude.ts` — Anthropic API `fetch` wrapper
- `src/backflow.ts` — `/constraint` reanimation logic
- `src/scoring.ts` — composite score math (formula in SPEC.md)
- `deck/` — pitch slides (markdown or keynote)

## Interfaces I produce

All of these are documented in `SPEC.md`. If you change a signature, change SPEC in the same commit.

- `QuorumAgent.addIdea`, `voteIdea`, `listIdeas`, `setContext`, `validateIdea`, `reanimate`, `setMember`, `forgetMember`, `teamSummary`, `planFor`
- `claude.complete(messages, opts): Promise<string>` — for Twody7's fallback path
- `scoring.composite({ team, resource, market }): number`

## Interfaces I consume

- `ai.complete(messages, opts)` from Twody7 — default scoring path
- `format.*` from Rui — all reply text passes through these before `sendMessage`
- `skills.extract(...)` from Twody7 — called by `setMember`

## Hour-by-hour

- **H+0 (8:30):** scaffold project, secrets, MCPs connected. Branches created. Push first commit (skeleton + SPEC).
- **H+1 (9:30):** Worker + Agent skeleton. `setWebhook` against `*.workers.dev`. Bot echoes any message in our test group. **Push.**
- **H+2 (10:30):** SQL schema migrated (verify `new_sqlite_classes` tag). `/idea`, `/ideas`, `/vote` end-to-end. **Push.**
- **H+3 (11:30):** `/event <url>` scrape via Twody7's prompt → `context`. **Push.**
- **H+4 (12:30):** lunch, dogfood with chat-derived ideas
- **H+5 (14:30):** pair with Twody7 on validation prompt. `setMember` wired. **Push.**
- **H+6 (15:30):** scoring pass. `/promote`, `/park`, `/kill`, `/why`. **Push.**
- **H+7 (16:30):** **the demo moment** — `reanimate(constraint)` lights up. `Agent.scheduleEvery()` for nudges. **Push.**
- **H+8 (17:30):** deck (3 slides) + pitch dry-run with Rui & Twody7
- **H+9 (18:30):** submit. Buffer for breakage.

## Definition of done per milestone

- **H+1:** bot echoes any message in our test group; webhook signature check passes
- **H+2:** ideas survive a `wrangler dev` restart; SPEC matches what's in code
- **H+5:** `setMember` round-trips skills correctly; Twody7's GH path can call it
- **H+7:** `/constraint we lost a backend dev` moves at least 2 ideas live; `events` table reflects every transition
