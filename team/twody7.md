# Twody7 — Integrations & content

**Scope:** Workers AI prompts, GitHub skills extraction, dogfooding, prompt quality.

## Status (demo day)

The plumbing for everything in your scope is **already in `main`**. Files are not where the original plan put them — the integration is leaner now:

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

In rough priority order:

1. **Validation scoring prompt — the demo bottleneck.** In `quorum/src/agent.ts → validateIdea()` (look for `messages: ChatMessage[]`). Right now it's a generic "score this idea" prompt that tends to produce flat numbers. Goals:
   - Same idea + same context scored twice → within ±0.05 on `team_fit` (definition of "done")
   - `/constraint we lost a backend dev` should _visibly_ reshuffle ideas. If Llama returns ~0.5 for everything, the demo moment dies silently.
   - The system prompt must include the team's skills aggregate and the chat's context (deadline, constraints) explicitly. Engineer reasoning steps before the JSON output.
   - Output JSON schema (locked — don't change without SPEC update): `{"team_fit": 0..1, "resource_fit": 0..1, "reason": string ≤200chars}`
2. **Dogfood with real ideas.** H+4 is lunch + dogfood per the original plan. Use ideas from your team's actual chat history. Translate from PT to English first if needed. Look for:
   - Prompts that produce parse failures (parseJson returns null → score defaults to 0.5/0.5 = boring board)
   - Prompts where Llama 70B times out and falls back to 8B (silently logged)
   - Skill extractions that return `[]` or wrong skills
3. **Skill extraction prompt refinement.** `quorum/src/telegram.ts → extractSkills()`. Goal: `/me 8 years backend python/postgres` → `["python", "postgres", "backend"]` consistently. Currently a placeholder.
4. **Plan generation prompt refinement.** `agent.planFor()`. Should reference at least one team member by skill ("Twody7 owns Workers AI integration → assign milestone 2"). Markdown sections: `## Milestones / ## Risks / ## Suggested owners`.
5. **Cost monitoring.** Add basic logging — Neurons used per call, fallback rate. If we're trending toward the 10K/day cap, swap to AI Gateway + Gemini 2.5 Flash (the documented escape hatch in PLAN.md).
6. **Event-page extraction.** Less critical — only used for `/event <url>` which is a side flow. Refine if time permits.

## Interfaces I produce / consume

The plumbing in `quorum/src/llm.ts` exposes:

```ts
complete(ai: Ai, messages: ChatMessage[], opts?: CompleteOpts): Promise<string>
parseJson<T>(raw: string): T | null
```

Your job is the *content* of `messages` — the system + user prompts. Save iterations in `prompts/` so the deck can show them.

## Definition of done

- ⚠️ **Open**: validation scoring is stable (±0.05 on `team_fit` for same input)
- ⚠️ **Open**: dogfood run with team's real ideas surfaces no parse failures
- ⚠️ **Open**: `/constraint` visibly reshuffles the board in the demo group
- ✅ `complete()` returns coherent response on primary; fallback path verified
- ✅ Skill extraction handler exists and runs (quality TBD)
- ✅ Event extraction handler exists and runs (quality TBD)
