# Social ranking + GitHub auth — design

**Branch:** `feat/social-ranking-and-auth`
**Date:** 2026-05-01
**Owner:** Rui

## Goal

Add a per-user upvote ("👍") affordance to the web board, gate writes behind GitHub OAuth, and restrict editing to a hard-coded whitelist of GitHub logins. Anonymous visitors keep read-only access. The vote signal piggybacks on the existing `ideas.votes` column and Telegram `/vote` command — there is **one** vote signal exposed on two surfaces, not two parallel rankings.

## Non-goals

- Downvotes / Reddit-style net karma. Upvote-only, toggleable.
- Folding the vote signal into the composite score (`0.5*team + 0.4*resource + 0.1*market`). Votes remain the pre-existing auto-promotion gate (`votes ≥ 1`); they do not influence the 1–10 card score.
- Comments, threads, reactions beyond 👍.
- Per-chat editor whitelisting. The whitelist is a single global env var.
- Telegram `/vote` behavior changes. The Telegram command stays exactly as it is — including its current "no per-user tracking" behavior. This is a known limitation, accepted to keep scope tight.
- Realtime updates. The board still fetches once on load.

## Permissions model

Three roles, computed per request from the session cookie:

| Role | Detection | See board | Vote (👍) | Edit (name/long) |
|------|-----------|-----------|-----------|------------------|
| Anonymous | no valid session cookie | ✅ | ❌ | ❌ |
| Authed | valid session cookie, `login` not in whitelist | ✅ | ✅ | ❌ |
| Editor | valid session cookie, `login` in whitelist | ✅ | ✅ | ✅ |

The whitelist is the env var `EDITOR_WHITELIST` in `quorum/wrangler.jsonc`: a comma-separated list of GitHub logins, matched case-insensitively (we lowercase both sides). Changes require a redeploy.

Permission is enforced **server-side** on every mutating endpoint. Client-side hiding/disabling is UX only — the Worker is the source of truth. Anonymous mutating requests → 401. Authed-not-whitelisted edit attempts → 403.

## GitHub OAuth + sessions

### OAuth app

Register a GitHub OAuth App per environment (one for local dev, one for the deployed Worker). Local dev callback is `http://localhost:8787/auth/github/callback`; deployed callback is `https://<worker>.workers.dev/auth/github/callback`. Scopes requested: `read:user` only (we just need the `login`).

### Worker secrets (new)

| Name | Purpose |
|------|---------|
| `GITHUB_OAUTH_CLIENT_ID` | OAuth App client id |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth App client secret |
| `SESSION_SIGNING_KEY` | 32-byte hex, used to HMAC the session cookie |

### Worker var (new)

| Name | Example | Purpose |
|------|---------|---------|
| `EDITOR_WHITELIST` | `"muffles,joao-f-o-goncalves,twody7"` | Comma-separated GitHub logins permitted to edit |

### Routes

Added to `quorum/src/index.ts`:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/auth/github/start` | Generate CSRF `state`, set short-lived signed `oauth_state` cookie, redirect to GitHub authorize URL |
| `GET` | `/auth/github/callback` | Verify `state` cookie matches, exchange `code` for access token, call GitHub `GET /user`, set session cookie, redirect to `/` |
| `POST` | `/auth/logout` | Clear session cookie, redirect to `/` |
| `GET` | `/api/me` | Return `{ login, avatar_url, can_edit, can_vote }` for the current session, or `{}` if anonymous |

### Session cookie

Stateless, signed. No DB-backed session store.

- Format: `base64url(payloadJson) + "." + hex(hmacSHA256(SESSION_SIGNING_KEY, payloadJson))`
- Payload: `{ login: string, avatar_url: string, exp: number }` (exp = unix seconds, 30 days out)
- Cookie attrs: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
- Cookie name: `quorum_session`

We do **not** store the GitHub access token. Once we know `login`, we don't need to talk to GitHub again. Revoking a session means rotating `SESSION_SIGNING_KEY` (acceptable for prototype).

The `oauth_state` cookie is short-lived (`Max-Age=600`), `HttpOnly`, used only to bind the OAuth callback to the same browser that initiated `/auth/github/start`.

### Same-origin

`web/` is served from the `quorum` Worker (per commit `12af69f`), so cookies are same-origin and ride automatically. The web client passes `credentials: 'include'` explicitly on all `fetch` calls for clarity.

## Data model

One new table, additive migration in `quorum/src/schema.ts → ADDITIVE_MIGRATIONS`:

```sql
CREATE TABLE IF NOT EXISTS idea_votes (
  idea_id INTEGER NOT NULL,
  voter_key TEXT NOT NULL,           -- 'gh:<lowercased_login>' for web votes
  created_at INTEGER NOT NULL,
  PRIMARY KEY (idea_id, voter_key)
);
```

`ideas.votes` stays as-is — denormalized count. Web vote toggle keeps it in sync. Telegram `/vote` continues to write directly to `ideas.votes` without a `idea_votes` row (its known limitation).

Pre-existing rows in `ideas` (created before this migration) have `votes` values written by Telegram and are unaffected. Their `voted_by_me` is always `false` for any web user, since no `idea_votes` rows exist for them — which is correct.

## Endpoints

### New: vote toggle

```
POST /api/ideas/<uid>/vote
```

- Auth: session cookie required (any authed user). Anonymous → 401.
- Body: `{}` (empty).
- Behavior: derive `voter_key = 'gh:' + lower(session.login)` and `idea_id` from `uid`.
  - If `(idea_id, voter_key)` exists in `idea_votes`: DELETE it, `UPDATE ideas SET votes = votes - 1`. Append `idea_voted` event with `direction: 'undo'`.
  - Else: INSERT it, `UPDATE ideas SET votes = votes + 1`. Append `idea_voted` event with `direction: 'up'`.
- Response: `{ votes: number, voted: boolean }` — the new state for this user.
- All writes (vote table mutation, count update, event append) execute in one SQL transaction.

### Modified: PATCH `/api/ideas/<uid>`

Existing endpoint, now permission-gated:

- Anonymous → 401.
- Authed-not-whitelisted → 403.
- Whitelisted → existing behavior unchanged.

The existing `idea_edited` event continues to be appended; payload gains an `editor: <login>` field.

### Modified: GET `/api/board`

The `Idea` shape gains two fields:

```ts
type Idea = {
  uid: string;
  name: string;
  brief: string;
  long: string;
  hours: number | null;
  score: number;
  stage: 'bucket' | 'candidates' | 'selected';
  votes: number;          // NEW: surfaced from existing column
  voted_by_me: boolean;   // NEW: true iff session present AND (idea_id, gh:login) row exists
};
```

`voted_by_me` is computed per request. Anonymous requests always get `false`. The query gains a single `LEFT JOIN idea_votes ON idea_id = ideas.id AND voter_key = ?` when a session is present.

### New: `GET /api/me`

```ts
type Me = {} | {
  login: string;
  avatar_url: string;
  can_edit: boolean;
  can_vote: boolean;     // always true if logged in (kept for symmetry / future-proofing)
};
```

Anonymous requests get `{}`. Called once on app boot to drive UI affordances.

## Logging contract

New event type added to the enum in SPEC's "Logging contract" section:

- `idea_voted` — payload `{ voter_key: string, direction: 'up' | 'undo', new_total: number }`

Existing `idea_edited` event payload gains `editor: <login>`.

## UI changes (`web/`)

### Header

Right-aligned auth widget in `App.jsx`:

- Anonymous: `[ Sign in with GitHub ]` button → `window.location.href = '/auth/github/start'`
- Authed non-editor: avatar + `@login · view + vote` + `[ Sign out ]`
- Editor: avatar + `@login · editor` (subtle `--accent` highlight) + `[ Sign out ]`

`Sign out` does `POST /auth/logout` then reloads.

The existing mock-mode banner stays as-is; in mock mode the login button is hidden.

### Card

A new 👍 control next to the existing score chip:

- Anonymous: 👍 control hidden (cleanest visual — vote count not shown to anon).
- Authed, `voted_by_me === false`: outlined `👍 N` button — clickable.
- Authed, `voted_by_me === true`: filled (`--accent` lime fill) `👍 N` button — clickable to undo.

Click flow: optimistic UI update (toggle local `voted_by_me`, bump `votes` ±1) → `POST /api/ideas/<uid>/vote` → on success, reconcile with server response; on failure, roll back (same pattern as existing PATCH rollback).

Edit affordance (click-to-open modal) only rendered when `me.can_edit === true`. Anonymous and non-editor authed users see the card as static. The PATCH endpoint also enforces server-side; client-side gating is UX only.

### API client (`web/src/api.js`)

New helpers:

```js
export async function fetchMe()           // GET /api/me   → Me | {}
export async function voteIdea(uid)       // POST /api/ideas/:uid/vote → { votes, voted }
export async function logout()            // POST /auth/logout
```

All `fetch` calls pass `credentials: 'include'`. `fetchMe()` is called once on app boot; the result is held in App state and threaded into Header + Card props.

### Mock mode

When `VITE_API_BASE` is unset, `fetchMe()` returns `{}`, the login button is hidden, and `voteIdea` is a no-op returning the local optimistic state. Edit modal stays open as today (mock mode is for layout work, not auth).

## SPEC.md updates

In the same commit as the implementation, update `SPEC.md`:

1. Add new section **"Auth & permissions"** between "Environment & secrets" and "SQLite schema":
   - Roles table (anonymous / authed / editor)
   - `EDITOR_WHITELIST` env var format
   - Cookie format and lifetime
2. Extend "Environment & secrets" table with `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `SESSION_SIGNING_KEY`, and the `EDITOR_WHITELIST` var.
3. Add `idea_votes` table to the SQLite schema block.
4. Add the four new HTTP routes (`/auth/github/start`, `/auth/github/callback`, `/auth/logout`, `/api/me`) and `POST /api/ideas/<uid>/vote` to the HTTP endpoints table.
5. Update `PATCH /api/ideas/<uid>` row to note it now requires editor session.
6. Extend the `Idea` TypeScript shape in "Board API" with `votes` and `voted_by_me`.
7. Add `idea_voted` to the event_type enum in "Logging contract"; note the new `editor` field on `idea_edited`.

## Local dev plan

Before any commit:

1. Register a "Quorum (local)" GitHub OAuth App with callback `http://localhost:8787/auth/github/callback`.
2. Put client id + secret + a fresh `openssl rand -hex 32` for `SESSION_SIGNING_KEY` into `quorum/.dev.vars`.
3. Add `EDITOR_WHITELIST` (with my own GitHub login) as a `var` in `quorum/wrangler.jsonc`.
4. Run `cd quorum && npm run dev` and `cd web && npm run dev` (or use the unified Worker if it serves `web/` already — check `quorum/src/index.ts` for the static handler and prefer that path so the OAuth same-origin assumption holds).
5. Smoke-test:
   - Anon visit → board renders, no login indicator gone, no 👍 buttons.
   - Click "Sign in with GitHub" → GitHub consent → redirect back → header shows my login.
   - Vote 👍 on an idea → count increments, button fills. Reload → state persists. Click again → count decrements, button outlined.
   - As a whitelisted user, click a card → editor modal opens. Edit name/long → save → reload → persists.
   - Sign out as the whitelisted user. Sign in as a non-whitelisted user (or temporarily remove myself from the list) → cards become non-clickable, but 👍 still works.
   - Direct `curl -X PATCH` to `/api/ideas/<uid>` without a cookie → 401. With a non-whitelisted session cookie → 403.

## Out of scope / explicit deferrals

- **Telegram `/vote` per-user tracking.** Could be unified later by giving Telegram votes the key `tg:<user_id>` in `idea_votes`, but that touches Telegram code and isn't required for this iteration.
- **Per-chat whitelist.** Global is fine for the demo; per-chat needs a UI or command and a schema row.
- **CSRF protection on logout/vote.** `SameSite=Lax` cookies + same-origin POSTs cover the common case for a hackathon; a proper CSRF token can be added later.
- **Session revocation list.** Rotate `SESSION_SIGNING_KEY` if needed.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Cookie not set in callback because of cross-site redirect quirks | Same-origin (Worker serves `/`); use `SameSite=Lax`; verify on local first |
| Whitelist case-sensitivity bugs | Lowercase both env var entries and `session.login` at compare time |
| Vote count drift between `ideas.votes` and `idea_votes` row count | Use a single transaction for the toggle; add a `/healthz/votes` audit query (deferred, but the data shape allows it: `SELECT idea_id, COUNT(*) FROM idea_votes GROUP BY idea_id` vs `SELECT id, votes FROM ideas`) |
| OAuth secret leaked in dev | `.dev.vars` is gitignored at the repo level — confirm before first commit |
