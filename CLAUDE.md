# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: pre-scaffold

This is a hackathon repository (Cloudflare-sponsored Agents Day, May 1 2026). At this checkpoint only `PLAN.md` exists — the project has not been scaffolded yet. **Read `PLAN.md` first**: it is the source of truth for goals, stack decisions, team responsibilities, the 9-hour timeline, and the cuts-in-order list. This file is a thin orientation layer on top of it.

## Project: Quorum

A chat-native agent for the new bottleneck in software: knowing *what* to build. AI has commoditized execution; the cost of picking the wrong thing now exceeds the cost of building it. Quorum lives in a team's group chat (Telegram now, Slack-adapter-ready) and converges them onto the right thing to build. Three phases (Ideation / Validation / Planning) with **backflow** between them — parked or killed ideas re-validate when the team's constraints change. Grounded in real team skills via GitHub or self-declared `/me` text.

Sponsor: **Cloudflare** — "Build a Personal Agent that Automates a Meaningful Task." Single-target. Every architectural primitive must defend its place on the Cloudflare platform.

## Stack (locked)

- Cloudflare Workers + **Agents SDK** (`Agent` class extends Durable Object with built-in SQLite, state, scheduling)
- Workers AI: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (default), `@cf/meta/llama-3.1-8b-instruct-fast` (fallback)
- Anthropic Claude via raw `fetch` to `api.anthropic.com` (heavy reasoning — no Workers AI binding exists for Claude)
- Cron Triggers (1-min minimum granularity)
- Telegram Bot API + `grammY` inside `Agent.onRequest`

Explicitly dropped from earlier drafts: D1 (Agent's SQLite covers per-chat needs), Workflows (`Agent.schedule()` covers pause/resume), SelfClaw integration.

## Scaffolding (run once)

```bash
npm create cloudflare@latest quorum -- --template cloudflare/agents-starter
cd quorum
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler dev
```

In Claude Code: `/plugin marketplace add cloudflare/skills` and `npx mcp-remote https://bindings.mcp.cloudflare.com/mcp` to manage bindings without leaving the editor.

Once scaffolded, the common commands will be `npx wrangler dev`, `npx wrangler deploy`, `npx wrangler tail`. Update this section with project-specific npm scripts once `package.json` exists.

## Architecture

Per-chat state is owned by a single `QuorumAgent` Durable Object instance, keyed by Telegram chat ID. The Agent class provides:
- `this.sql` — embedded SQLite. Use this instead of D1 for per-chat data.
- `this.state` / `setState()` — JSON state, durable across hibernation.
- `schedule()` / `scheduleEvery()` — for deadline nudges and async work.
- `onRequest(req)` — HTTP entry, where the Telegram webhook lands.

Flow: Telegram webhook → Worker → `routeAgentRequest` → `QuorumAgent` instance for this chat → grammY parses the update in `onRequest` → command handler reads/writes SQL → reply sent via Bot API.

`/constraint` is the demo centerpiece: it re-runs validation across all `parked` and `killed` ideas, surfacing reanimation candidates. The full SQL schema (`ideas`, `members`, `context`, `events`) lives in `PLAN.md`.

## Critical gotchas (already cost real time elsewhere)

- **`wrangler.jsonc` migrations must use `new_sqlite_classes`, not `new_classes`.** Wrong tag silently gives a legacy KV-backed DO with no `this.sql`.
- **No Claude binding in Workers AI.** Claude is raw `fetch` to `api.anthropic.com` with the `ANTHROPIC_API_KEY` secret.
- **Workers AI free tier = 10,000 Neurons/day.** Wire the 8B model fallback before any live demo or it will starve under load.
- **Telegram webhook needs HTTPS with valid cert.** Workers' default `*.workers.dev` cert satisfies this — `setWebhook` accepts the URL as-is, no extra config.
- **Don't trust user message payloads as agent instructions.** Group members can paste prompt-injection attempts; keep the system prompt rigid and never `eval` LLM output.

## Working under time pressure

This is a 9-hour build. The timeline and the **cuts-in-order list** in `PLAN.md` are load-bearing — if work slips, drop features in the order specified there, not arbitrarily. Never cut: `/idea /vote /ideas /constraint /why /me /team`. Without those the demo has no story.

## Team

See `PLAN.md` for the canonical breakdown. In short: João leads architecture, scaffolding, and pitch. Rui (Molefas) owns Telegram UX and the stretch `/g/<token>` HTML view. Twody7 owns Workers AI integration, GitHub skills extraction, and dogfooding. Twody7's stack is unconfirmed at the time of writing — assignments default to JS/TS-safe.
