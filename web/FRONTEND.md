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
  score: number;            // 1–10 integer, agent-assigned (composite)
  score_team: number | null;     // 0–1 raw fit, null until validated
  score_resource: number | null; // 0–1 raw fit, null until validated
  score_market: number;          // 0–1, constant 0.5 placeholder for now
  score_reason: string | null;   // one-sentence LLM rationale, null until validated
  hours: number;     // time estimate in hours, agent-assigned
  stage: 'bucket' | 'candidates' | 'selected';
  votes: number;
  voted_by_me: boolean;
};
```

Mock list lives at `web/public/mock.json` under `{ "ideas": Idea[], "name": string }`. Replace with a real fetch when the API exists; the response shape should stay `{ ideas: Idea[], name: string | null }`.

## What the user can edit vs. what the agent owns

The board is a **window into agent state**. Be strict about this — edit affordances anywhere else are a UX bug.

- **User-editable** (in the modal only): `name`, `long`.
- **Agent-only** (read-only in UI): `uid`, `stage`, `score`, `hours`, `brief`.

`uid` is shown faded in the modal header, selectable for copy. Never show it on the card.

When wiring the backend: a save sends a `PATCH` with just the changed fields (`name` and/or `long`). Score / stage / estimate are never written by the client.

## Card surface

What a card shows, and only this:

- `name` — serif, large.
- `score` / 10 — top-right, accent color, **click to expand a breakdown panel** with three weighted progress bars (`score_team` ×50%, `score_resource` ×40%, `score_market` ×10%) and the `score_reason`. The score badge stops click propagation so it doesn't open the edit modal.
- `brief` — body copy.
- `~{hours}h` — bottom-left chip.
- A subtle pulse indicator (decorative; signals "agent is live").

Click anywhere else on the card → modal. No drag, no drop, no inline edit, no context menu.

## Modal

- Header: faded `uid`, close.
- Body: editable `name`, read-only `stage` / `score` / `hours` strip, read-only `brief`, editable `long`.
- Footer: `cancel` / `save`. Save is disabled until something changed.
- `Esc` closes. Backdrop click closes. Unsaved edits are dropped on close — there's no confirmation dialog (intentional; cheap UX, easy to redo).

## Naming conventions

- **Stage ids** in code, in JSON, in the API: lowercase singular — `bucket`, `candidates`, `selected`. Never the human label.
- **Idea ids** are agent-issued, prefix `qrm_`, opaque. Treat as strings.
- The product is **Quorum**. Each board has its own human name (set per-chat via `/start <name>` or `/name <name>`), shown next to the wordmark in the header. Falls back to the `— what to build` tag when unset.

## Wiring to the API

Endpoints live in `quorum/` (Cloudflare Worker + Durable Object SQLite). The Worker also serves the built `web/dist` as static assets, so the prod UI is same-origin and the frontend uses relative paths (`/api/...`, `/auth/...`) — no `VITE_API_BASE`. See `SPEC.md` "HTTP endpoints" + "Board API" for the contract.

- `GET /api/board[?chat=<id>]` → `{ ideas, name, team, context }` (each idea has `votes`, `voted_by_me`; `team` and `context` drive the left rail — see SPEC for shapes)
- `PATCH /api/ideas/:uid` body `{ name?, long? }` → `{ idea: Idea }` — **editor whitelist required**
- `POST /api/ideas/:uid/vote` → toggles one vote per `(idea, signed-in user)` — **session required**
- `GET /api/me` → `{ login, avatar_url, can_vote, can_edit }` or `{}` if anon
- `GET /auth/github/start`, `GET /auth/github/callback`, `POST /auth/logout` — GitHub OAuth + signed session cookie

For local dev the Vite dev server proxies `/api` and `/auth` to `http://127.0.0.1:8787`, keeping cookies same-origin (`localhost:5173`). If the Worker isn't running, the app falls back to `/mock.json` so the UI still loads — the footer reads `mock` vs. `live`.

All API calls live in `web/src/api.js`, with `credentials: 'include'` so the session cookie rides along. Save flow is **optimistic**: state updates immediately; on failure, previous state is restored and the error logged.

## Not implemented yet (intentionally)

- No realtime — the agent moves cards in real life; the prototype doesn't refetch or websocket.
- No retries / queue on save failures — the optimistic rollback is fire-and-forget.
- No CSRF token. `SameSite=Lax` cookies cover the common case for a hackathon prototype.
