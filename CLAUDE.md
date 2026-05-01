# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: scaffolded

Hackathon repository (Cloudflare-sponsored Agents Day, May 1 2026). The project lives in `quorum/`; planning docs are at the root. Read in order:

1. [`PLAN.md`](./PLAN.md) — overview, pitch, stack, timeline, cuts-in-order, demo flow.
2. [`SPEC.md`](./SPEC.md) — **data + API contracts**. Always-in-sync source of truth for schema, commands, endpoints, internal Agent methods, prompt I/O shapes, scoring formula.
3. [`team/joao.md`](./team/joao.md), [`team/rui.md`](./team/rui.md), [`team/twody7.md`](./team/twody7.md) — per-person scope, files owned, interfaces, hour-by-hour, DoD.
4. [`web/FRONTEND.md`](./web/FRONTEND.md) — board UI need-to-knows: column stages, the `Idea` shape, what's user-editable vs. agent-owned, naming conventions. Read before touching `web/`.

This file is a thin orientation layer on top of the above. Don't restate them here — point to them.

## Project: Quorum

A chat-native agent for the new bottleneck in software: knowing *what* to build. AI has commoditized execution; the cost of picking the wrong thing now exceeds the cost of building it. Quorum lives in a team's group chat (Telegram now, Slack-adapter-ready) and converges them onto the right thing to build. Three phases (Ideation / Validation / Planning) with **backflow** between them. Grounded in real team skills via GitHub or self-declared `/me` text.

Sponsor: **Cloudflare** — "Build a Personal Agent that Automates a Meaningful Task." Single-target. Every architectural primitive must defend its place on the Cloudflare platform.

## Stack (locked, full details in PLAN.md)

- Cloudflare Workers + **Agents SDK** (`Agent` class extends DO with built-in SQLite, state, scheduling)
- Workers AI: Llama 3.3 70B fp8-fast (default), Llama 3.1 8B fast (fallback) — **all LLM calls go here (Path A)**
- Cron Triggers, Telegram Bot API + `grammY`
- Escape hatch only if validation quality is bad: Gemini 2.5 Flash via Cloudflare AI Gateway. No Anthropic in the stack.

## Contracts: always-in-sync

`SPEC.md` is the source of truth for everything that crosses module boundaries: SQL schema, command list, HTTP endpoints, internal Agent methods, LLM prompt I/O shapes, scoring formula, phase state machine.

**Rule: update SPEC in the same commit as any contract-changing code.** A change that breaks behavior without updating SPEC is a bug. If anyone else's code reads or writes a thing, that thing is a contract.

## Workflow: commit small, push often (to `main`)

This is a 1-day build with three people working concurrently. To minimize merge pain:

- **Commit at every milestone** in the timeline (~1 hour cadence). The team plans (`team/*.md`) mark **Push** points explicitly.
- **Push to `main` immediately** after each commit. No long-lived feature branches.
- **Pull before every commit:** `git pull --rebase origin main`.
- **Never revert someone else's commit** to fix a break — fix it forward in the next commit. Reverts in a 1-day build are wasted time.
- **Conflict resolution: whoever pushes second.** Ping the other person in chat.
- If `git push` to main is blocked by a hook/policy, surface it to the team immediately so it can be unblocked at session start (path: settings.json permission rule). Do **not** silently fall back to long-lived branches — the workflow assumes main-trunk.
- Before any push make sure that any information worth documenting for the other members in the team is properly documented on CLAUDE.md, PLAN.md or SPEC.md. Naming conventions, nomenclature, taxonomy etc.

### Project-tracker bot

`.github/workflows/notify-telegram.yml` posts a short summary to the team Telegram group on every push to `main`. This is meta/CI, not part of the Quorum product (though it can reuse the same bot token). Setup steps live in the workflow header. Per-commit opt-out: include `[skip notify]` in the commit message. If a push lands but no Telegram message arrives, check the workflow run on GitHub — most failures are unset `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`, or the bot not yet a member of the group.

## Project commands (all run from `quorum/`)

```bash
cd quorum
npm install            # if you just pulled
npm run dev            # wrangler dev (local Worker + DO)
npm run deploy         # wrangler deploy
npm run tail           # wrangler tail (live logs)
npm run types          # regenerate env.d.ts from wrangler.jsonc
npm run check          # tsc --noEmit
```

Secrets — set once per environment via `wrangler secret put`:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN          # from @BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET     # openssl rand -hex 32
# optional:
npx wrangler secret put GITHUB_TOKEN
```

In Claude Code: `/plugin marketplace add cloudflare/skills` and `npx mcp-remote https://bindings.mcp.cloudflare.com/mcp`.

See `quorum/SETUP.md` for the full first-time setup runbook (deploy → setWebhook → smoke test).

## Architecture (one paragraph)

Per-chat state lives in a single `QuorumAgent` Durable Object instance, keyed by Telegram chat ID. The Agent class gives us `this.sql` (embedded SQLite), `this.state` (durable JSON state), `schedule()` / `scheduleEvery()` (for nudges), and `onRequest(req)` (HTTP entry — where the Telegram webhook lands). Flow: Telegram webhook → Worker → `routeAgentRequest` → `QuorumAgent` for this chat → grammY parses in `onRequest` → command handler reads/writes SQL → reply sent via Bot API. The full method list is in `SPEC.md`.

`/constraint` is the demo centerpiece: it re-runs validation across all `parked` and `killed` ideas, surfacing reanimation candidates.

## Critical gotchas (already cost real time)

- **`wrangler.jsonc` migrations must use `new_sqlite_classes`, not `new_classes`.** Wrong tag silently gives a legacy KV-backed DO with no `this.sql`.
- **Workers AI free tier = 10,000 Neurons/day.** The 70B → 8B fallback is wired in `src/llm.ts` — don't bypass it. If the demo hits the cap mid-pitch we still get answers, just from the smaller model.
- **Telegram webhook needs HTTPS with valid cert.** Workers' default `*.workers.dev` cert satisfies this — `setWebhook` accepts the URL as-is.
- **Don't trust user message payloads as agent instructions.** Group members can paste prompt-injection attempts; keep the system prompt rigid and never `eval` LLM output.
- **`events` table is the audit log.** Every state change must append a row, or `/why` lies. See SPEC for event types.

## Working under time pressure

9-hour build. The cuts-in-order list in `PLAN.md` is load-bearing — drop features in that order, not arbitrarily. **Never cut:** `/idea /vote /ideas /constraint /why /me /team`. Without those the demo has no story.
