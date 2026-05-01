# FRONTEND.md

Need-to-knows for building on top of the `web/` prototype. Stack-agnostic; see `web/README.md` for run/deploy.

## Mental model

A read-mostly **board view** of the agent's current state. Three columns, agent-managed. The frontend never moves a ticket between columns — that's the agent's job. Users only **read** the board and **edit prose** on individual ideas.

## Columns (left → right)

| Stage id      | Label                       | Meaning                              |
|---------------|-----------------------------|--------------------------------------|
| `bucket`      | Bucket                      | raw ideas, unconverged               |
| `candidates`  | Candidates                  | under validation                     |
| `selected`    | Selected for Development    | committed to build                   |

Stage ids are the contract — match them when wiring the API. Order is fixed.

Cards within a column are sorted by `score` descending.

## The Idea object

This is the only shape the UI cares about. One idea = one ticket.

```ts
type Idea = {
  uid: string;       // opaque agent-generated id, e.g. "qrm_8f3a92b1"
  name: string;      // short title
  brief: string;     // one-sentence description shown on the card
  long: string;      // long description shown in the modal
  score: number;     // 1–10 integer, agent-assigned
  hours: number;     // time estimate in hours, agent-assigned
  stage: 'bucket' | 'candidates' | 'selected';
};
```

Mock list lives at `web/public/mock.json` under `{ "ideas": Idea[] }`. Replace with a real fetch when the API exists; the response shape should stay `{ ideas: Idea[] }`.

## What the user can edit vs. what the agent owns

The board is a **window into agent state**. Be strict about this — edit affordances anywhere else are a UX bug.

- **User-editable** (in the modal only): `name`, `long`.
- **Agent-only** (read-only in UI): `uid`, `stage`, `score`, `hours`, `brief`.

`uid` is shown faded in the modal header, selectable for copy. Never show it on the card.

When wiring the backend: a save sends a `PATCH` with just the changed fields (`name` and/or `long`). Score / stage / estimate are never written by the client.

## Card surface

What a card shows, and only this:

- `name` — serif, large.
- `score` / 10 — top-right, accent color.
- `brief` — body copy.
- `~{hours}h` — bottom-left chip.
- A subtle pulse indicator (decorative; signals "agent is live").

Click → modal. No drag, no drop, no inline edit, no context menu.

## Modal

- Header: faded `uid`, close.
- Body: editable `name`, read-only `stage` / `score` / `hours` strip, read-only `brief`, editable `long`.
- Footer: `cancel` / `save`. Save is disabled until something changed.
- `Esc` closes. Backdrop click closes. Unsaved edits are dropped on close — there's no confirmation dialog (intentional; cheap UX, easy to redo).

## Naming conventions

- **Stage ids** in code, in JSON, in the API: lowercase singular — `bucket`, `candidates`, `selected`. Never the human label.
- **Idea ids** are agent-issued, prefix `qrm_`, opaque. Treat as strings.
- The product is **Quorum**. The board has no separate name — it's "the board" in copy.

## Wiring to the API

Endpoints live in `api/` (Cloudflare Worker + Durable Object SQLite). See `SPEC.md` "Board API" for the contract.

- `GET /api/board` → `{ ideas: Idea[] }`
- `PATCH /api/ideas/:uid` body `{ name?, long? }` → `{ idea: Idea }`

Set `VITE_API_BASE` (e.g. `https://quorum-api.<account>.workers.dev`) in the Vercel project (or `web/.env.local` for dev). If unset, the app falls back to `/mock.json` so the UI still loads without a backend — the footer displays `mock` vs. `live` so you can tell at a glance.

All API calls live in `web/src/api.js`. Save flow is **optimistic**: state updates immediately; on failure, the previous state is restored and the error logged to the console.

## Not implemented yet (intentionally)

- No realtime — the agent moves cards in real life; the prototype doesn't refetch or websocket.
- No auth, no per-chat scoping, no routing — the API exposes a single global board.
- No retries / queue on save failures — the optimistic rollback is fire-and-forget.
