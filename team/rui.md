# Rui (Molefas) — UX & visible surface

**Scope:** Telegram message UX, `/plan` rendering, `/g/<token>` HTML view (stretch), demo capture.

## Files I own

- `src/format.ts` — message templates, command help, reply formatting (handles MarkdownV2 escaping)
- `src/render-plan.ts` — markdown plan layout for `/plan`
- `src/web/index.ts` — `/g/<token>` route handler
- `src/web/template.ts` — server-rendered HTML, inline CSS, no JS framework
- `demo/` — screen recordings, GIFs, final demo cut

## Interfaces I produce

```ts
format.idea(idea): string
format.ideaList(ideas, opts?): string
format.help(command?): string
format.planMarkdown(plan): string
format.scoreReason(reason): string   // for /why
format.teamSummary(summary): string  // for /team
format.reanimation(result): string   // for /constraint reply (the money moment — make it sing)
```

## Interfaces I consume

- `QuorumAgent` state via SPEC.md contracts (read-only — never mutate from format.ts)
- `skills.extract` output for `/team` formatting
- `planFor(id)` markdown output for `render-plan.ts`

## Hour-by-hour

- **H+0 (8:30):** standup, pull repo, branches set up
- **H+1 (9:30):** `format.ts` skeleton with stub functions returning placeholder strings
- **H+2 (10:30):** `idea`, `ideaList`, `vote` reply formatting. **Push.**
- **H+3 (11:30):** event scrape result rendering. Score breakdown layout. **Push.**
- **H+4 (12:30):** lunch + smoke test on real phone
- **H+5 (14:30):** `/me` confirmation, `/team` summary formatting. **Push.**
- **H+6 (15:30):** `/why` audit trail rendering — chronological with phase transitions visible. **Push.**
- **H+7 (16:30):** `/plan` markdown layout. `/constraint` reanimation reply (this is the demo highlight — make it readable on a phone screen). **Push.**
- **H+7.5 (17:00):** **Stretch** — `/g/<token>` HTML view. Server-side render from `this.sql`, inline CSS, mobile-friendly. Leaderboard + members + phase board.
- **H+8 (17:30):** screen capture; demo edit; final pitch dry-run with João & Twody7
- **H+9 (18:30):** ready

## Definition of done per milestone

- **H+2:** ideas list reads cleanly on a phone screen; score visible at a glance; no MarkdownV2 escape errors
- **H+7:** `/plan` output is shareable as-is — someone can copy, paste, and act. `/constraint` reply is the most readable line in the demo.
- **H+7.5:** `/g/<token>` renders without flicker, looks like a real product
