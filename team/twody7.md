# Twody7 — Integrations & content

**Scope:** Workers AI integration, GitHub skills extraction, dogfooding, prompt engineering.

> ⚠ Stack unconfirmed at H+0 — confirm at standup. Assignments default to JS/TS; if you're stronger in Python, swap a section with João.

## Files I own

- `src/ai.ts` — Workers AI client; default → fallback chain
- `src/github.ts` — fetch user repos + langs, normalize
- `src/skills.ts` — LLM-based skill extraction from `/me` text + GH data
- `src/extract-event.ts` — scrape & extract event page → context fields
- `prompts/` — prompt templates as text files (skill, scoring, plan, event)
- `scripts/dogfood.ts` — seeder that pumps our chat history into a test bot

## Interfaces I produce

```ts
ai.complete(messages, opts?): Promise<string>
  // default: llama-3.3-70b-instruct-fp8-fast
  // fallback chain: llama-3.1-8b-instruct-fast → claude (via João's claude.ts)
  // returns raw string; caller is responsible for JSON parse + validation

skills.extract(meText, ghProfile?): Promise<string[]>
  // JSON-validated, retries once on parse failure

github.profile(username): Promise<{ langs: string[], recentRepos: string[], pattern: string }>

extractEvent.fromUrl(url): Promise<EventContext>
  // returns the shape that goes into the `context` table per SPEC
```

## Interfaces I consume

- `QuorumAgent.setMember`, `setContext` from João — to persist extracted data
- `claude.complete` from João — fallback when Workers AI fails or quality dips

## Hour-by-hour

- **H+0 (8:30):** standup, confirm stack, secrets check (Workers AI binding works locally?). **Push** any setup commits.
- **H+1 (9:30):** `ai.ts` skeleton calling Llama 3.3, fallback path tested with deliberately-failed primary
- **H+2 (10:30):** prompt template for `/idea` echo summarization (sanity check). Validate JSON shape contract. **Push.**
- **H+3 (11:30):** `extract-event.ts` — scrape event url, extract challenges/deadline/prize. **Push.**
- **H+4 (12:30):** lunch + dogfood seed list (use ideas from our PT chat — translate to English first)
- **H+5 (14:30):** `github.ts` + `skills.extract` pipeline. **Push.**
- **H+6 (15:30):** **pair with João** on validation scoring prompt — this is the heart of the app. Stable scores under same input matter most.
- **H+7 (16:30):** prompt iteration. `/plan` generation prompt. Cost monitoring (Neurons used / fallback rate). **Push.**
- **H+8 (17:30):** dogfood end-to-end run, surface any prompt drift; prep prompts/ folder for the deck
- **H+9 (18:30):** ready

## Definition of done per milestone

- **H+1:** `ai.complete` returns coherent response; fallback path tested by killing the default
- **H+5:** `/me` text "8 years backend python/postgres" produces a sensible skill list (verified by 2 of us)
- **H+6:** same idea + same context scored twice produces stable result (within ±0.05 on team_fit)
- **H+7:** `/plan` output for a complex idea has all 3 sections (Milestones / Risks / Owners) and references at least 1 team member by skill
