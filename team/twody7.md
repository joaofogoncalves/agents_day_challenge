# Twody7 — Integrations & content

**Scope:** Workers AI prompts, GitHub skills extraction, dogfooding, prompt quality.

## Status (demo day)

Scope is **shipped and demo-ready**. Plumbing for everything in your scope is in `main`, the refined scoring prompt with rubric is live (`f82d064`), and `/constraint` visibly reshuffles the board. Files are not where the original plan put them — the integration is leaner now:

| Original plan | Where it actually lives |
|---|---|
| `src/ai.ts` (Workers AI client + fallback) | `quorum/src/llm.ts` — `complete(env.AI, messages, opts)` with 70B→8B fallback wired |
| `src/skills.ts` (skill extraction from /me + GH) | `quorum/src/telegram.ts → extractSkills()` (called from `/me` + `/gh`) |
| `src/github.ts` (langs + recent repos) | `quorum/src/telegram.ts → fetchGithubSummary()` |
| `src/extract-event.ts` (event page → context) | `quorum/src/telegram.ts → extractEvent()` (called from `/event <url>`) |
| `prompts/*` | `prompts/` exists at repo root (you already pushed `41851d9`) |
| `scripts/dogfood.ts` | not yet — see "what's next" |

The wrappers are all functional — what they need from you is **prompt quality**, which is the bottleneck for whether the demo's `/constraint` moment actually reshuffles ideas (vs. flat 0.5/0.5 scores).

## What's done ✅

- Workers AI wrapper with primary→fallback model chain (`quorum/src/llm.ts`)
- JSON-output helper `parseJson<T>(raw)` strips ``` fences, safe-parses
- Skill extraction handler (`extractSkills`) wired into `/me` and `/gh`
- GitHub profile fetch (anonymous; `GITHUB_TOKEN` optional for higher rate)
- Event page extraction wired to `/event <url>` → `setContext()` → recompute on all live ideas
- Validation scoring prompt in `agent.validateIdea()` (placeholder — your refinement is what makes it useful)
- Plan generation prompt in `agent.planFor()` (placeholder)
- Prompt templates in `prompts/` (your commit `41851d9`)

## What's next

Nothing left for the demo. Validation scoring is stable, `/constraint` reshuffles cards visibly, prompts in `prompts/` are good enough for the pitch.

Post-demo (captured here so nothing evaporates):

- **Skill-extraction prompt refinement.** `quorum/src/telegram.ts → extractSkills()`. Still on the placeholder side — `/me 8 years backend python/postgres` → `["python", "postgres", "backend"]` consistently is the bar.
- **Plan-generation prompt refinement.** `agent.planFor()` — should reference at least one team member by skill, with `## Milestones / ## Risks / ## Suggested owners` sections.
- **Cost monitoring.** Log Neurons per call + fallback rate. If we trend toward the 10K/day cap, swap to AI Gateway + Gemini 2.5 Flash (escape hatch in PLAN.md).
- **Event-page extraction.** `/event <url>` is a side flow — refine if time allows.

## Interfaces I produce / consume

The plumbing in `quorum/src/llm.ts` exposes:

```ts
complete(ai: Ai, messages: ChatMessage[], opts?: CompleteOpts): Promise<string>
parseJson<T>(raw: string): T | null
```

Your job is the *content* of `messages` — the system + user prompts. Save iterations in `prompts/` so the deck can show them.

## Definition of done

- ✅ Validation scoring is stable enough for the pitch (refined rubric in `f82d064`)
- ✅ `/constraint` visibly reshuffles the board in the demo group
- ✅ `complete()` returns coherent response on primary; fallback path verified
- ✅ Skill extraction handler exists and runs (quality post-demo polish)
- ✅ Event extraction handler exists and runs (quality post-demo polish)
