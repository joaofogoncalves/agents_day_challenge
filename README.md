# Quorum

A chat-native agent that helps teams converge on **what to build**. AI made software cheap to ship — picking the wrong thing is now the expensive mistake. Quorum lives in your team's group chat, runs ideas through three phases (Ideation → Validation → Planning) with backflow when constraints change, and grounds its scoring in your team's real skills.

Built end-to-end on Cloudflare for **Agents Day 2026**.

**Live:** https://quorum.joao-f-o-goncalves.workers.dev

## What it does

- Captures ideas in Telegram (`/idea …`) and on a shared board UI
- Validates each idea against the team's skills and current constraints (Workers AI, Llama 3.3 70B → 8B fallback)
- Surfaces a defensible top-3 with an audit trail (`/why`)
- Reanimates parked ideas when constraints change — `/constraint we lost a backend dev` reshuffles the rank live
- Sends deadline nudges via `Agent.schedule()` (T-72h / T-24h / T-0)
- Two independent ranking signals: **votes** (social) and **fit_score** (agent validation)
- GitHub OAuth for per-user vote and an editor whitelist

## Stack

- **Cloudflare Workers** + **Agents SDK** — one `QuorumAgent` Durable Object per Telegram chat (SQLite + state + scheduling)
- **Workers AI** — Llama 3.3 70B fp8-fast, with 8B fast as automatic fallback
- **Static Assets** — the React/Vite board UI ships in the same Worker
- **Telegram Bot API** via grammY, inside `Agent.onRequest`

One Worker, one URL, one account. Telegram, the board UI, and the JSON API all share the same per-chat DO.

## Repo layout

| Path | What's there |
|---|---|
| `quorum/` | The Worker — Agent, router, Telegram bot, HTTP API |
| `web/` | React + Vite board UI (built into the Worker via static assets) |
| `team/` | Per-person scope and status |
| `docs/` | Specs and design notes |
| `PLAN.md` | Pitch, stack rationale, day-of timeline, cuts-in-order, demo flow |
| `SPEC.md` | **Source of truth** for SQL schema, commands, HTTP endpoints, prompt I/O, scoring |
| `CLAUDE.md` | Orientation for Claude Code sessions on this repo |
| `NEXT_STEPS.md` | Deferred work, known issues, ideas captured during the build |

Read `PLAN.md` for the why, `SPEC.md` for the contracts, `CLAUDE.md` for the working agreements.

## Run it

First-time setup is in [`quorum/SETUP.md`](./quorum/SETUP.md). Day-to-day:

```bash
cd quorum
npm install
npm run dev      # local Worker + DO
npm run deploy   # rebuilds web/ then wrangler deploy
npm run tail     # live logs
```

`npm run deploy` runs a `predeploy` hook that builds `web/` first — don't call `wrangler deploy` directly or you'll ship stale UI assets.

## Demo line

> Add `/constraint we lost a backend dev`. Watch parked ideas reanimate, the rank reshuffle, the audit trail update. That's the moment.
