# Realtime multiplayer board

**Date:** 2026-05-01
**Status:** design approved, awaiting implementation plan
**Related:** `quorum/src/agent.ts`, `quorum/src/index.ts`, `web/src/App.jsx`

## Goal

Make the Quorum board feel alive. Votes, edits, score changes, stage moves, and agent-driven actions propagate to every connected browser without refresh, alongside a presence indicator (who else is on the board) and a live activity rail (the last 50 things that happened).

The board today is a one-shot fetch: any change requires a manual reload. After this iteration, two browsers side-by-side reflect each other in <500ms, and `/constraint` fired in Telegram visibly reshuffles the board for everyone watching.

## Non-goals

- **Agent narration / streaming reasoning.** Activity rail shows outcomes only ("Quorum scored qrm_000007"), not in-progress steps. Adding live narration is tracked as a follow-up but explicitly out of scope here.
- **Client → server WebSocket messages.** Writes continue via REST. The socket is one-way (server → client). Removes a whole class of auth/replay concerns.
- **Event replay / `since` cursor.** Reconnect always sends a fresh full snapshot. Snapshot is small (<10KB) and reconnects are rare.
- **Multi-region or cross-DO fan-out.** One DO per chat is the consistency boundary. Sockets fan out only within a chat.
- **Frame compression.** Fields are short, traffic is low.

## Architecture

```
Browser ──► GET /api/socket?chat=<id>     (Upgrade: websocket, cookie auth)
                │
                ▼
        Worker (src/index.ts)
        ─ readSession() → identity (or null = anon)
        ─ Origin check against PUBLIC_BASE_URL (localhost in dev)
        ─ resolveBoardChat() → chatId
        ─ stub.fetch() forwards upgrade to DO with headers:
            • Upgrade: websocket
            • x-quorum-voter:  gh:<login> | anon:<nanoid>
            • x-quorum-login:  <login> | ""
            • x-quorum-avatar: <url> | ""
                │
                ▼
        QuorumAgent DO (src/agent.ts)
        ─ /socket route handles the upgrade
        ─ state.acceptWebSocket(ws)        (Hibernating WebSockets API)
        ─ ws.serializeAttachment({ login, avatar, voter_key, connection_id, joined_at })
        ─ State-mutating methods call this.broadcast(event)
        ─ broadcast iterates ctx.getWebSockets() and sends to each
        ─ webSocketClose hook fires presence_leave
```

**Key choices**

- **Hibernating WebSockets, not regular WS.** `state.acceptWebSocket()` (not `ws.accept()`) means sockets persist across DO eviction at $0 idle cost. All per-connection state is held in `serializeAttachment` so cold-wake recovers transparently.
- **One DO per Telegram chat is unchanged.** Sockets attach to the same DO that owns ideas state. No new sharding, no new fan-out layer.
- **Worker authenticates the upgrade; DO trusts forwarded identity.** Same trust boundary the REST endpoints already use (Worker is the sole entry point).
- **Anonymous viewers are allowed.** They receive an `anon:<nanoid>` voter_key (per-tab, per-connection) so the protocol shape stays uniform. Anon cannot vote or edit (those still require a session via REST).
- **No new files server-side beyond one shared types file.** Logic fits inside `src/agent.ts` (upgrade handler + `broadcast` helper + lifecycle hooks) and `src/index.ts` (one route). New file: `src/wire.ts` for the typed event union, imported by both server and `web/`.

## Wire protocol

Single source of truth: `quorum/src/wire.ts`. `web/` imports types via relative path (`import type { Wire } from "../../quorum/src/wire"`); pure-types, no runtime, Vite handles the cross-package reference.

Frame format: JSON over WebSocket text frames, one event per frame.

```ts
type ActorRef =
  | { kind: "user";  login: string; avatar: string }
  | { kind: "agent" }
  | { kind: "anon";  id: string };

type Presence = {
  connection_id: string;
  actor: ActorRef;
  joined_at: number; // unix ms
};

type ActivityRow = {
  id: number;            // events.id from DB, monotonic per chat
  event_kind: EventType; // existing union from schema.ts
  summary: string;       // server-rendered, plain text only
  by: ActorRef;
  ts: number;
  target_uid: string | null;
};

type Wire =
  // Sent unconditionally on connect
  | { kind: "hello"; snapshot: {
        ideas: BoardIdea[];
        activity: ActivityRow[]; // last 50, newest last
        presence: Presence[];
        me: { voter_key: string; login: string | null; can_edit: boolean };
        last_event_id: number;
      } }
  // State-changing events. activity field embedded so state and feed
  // arrive atomically — no race where the rail describes a change the
  // board hasn't applied yet.
  | { kind: "idea_added";         idea: BoardIdea;                                                                                   activity: ActivityRow }
  | { kind: "idea_voted";         uid: string; votes: number; voter_key: string; voted: boolean;                                     activity: ActivityRow }
  | { kind: "idea_edited";        uid: string; patch: { name?: string; long?: string; brief?: string };                              activity: ActivityRow }
  | { kind: "idea_phase_change";  uid: string; status: Status;                                                                       activity: ActivityRow }
  | { kind: "scored";             uid: string; score: number; components: { team: number; resource: number; market: number };       activity: ActivityRow }
  | { kind: "constraint_applied"; reanimated: string[]; demoted: string[]; reason: string;                                           activity: ActivityRow }
  // Presence events have no activity row to keep joins/leaves out of the rail.
  | { kind: "presence_join";  presence: Presence }
  | { kind: "presence_leave"; connection_id: string };
```

`summary` is composed server-side from typed fields (login, uid, kind) — never from raw idea text or LLM output. Renders as plain text only on the client; no HTML, no Markdown. This eliminates prompt-injection routes through the rail.

Client → server: nothing in v1. Writes use existing REST. Keep-alives are platform-handled.

## Data flow scenarios

**Vote.** Alice clicks thumbs-up. Browser optimistically updates local card → `POST /api/ideas/qrm_000003/vote`. Worker authenticates, forwards. DO `toggleVote()` writes `idea_votes`, appends to `events`, and ends with `this.broadcast({ kind: "idea_voted", uid, votes, voter_key, voted, activity })`. Every connected browser receives the event; reducers patch the card and prepend the activity row. Alice's own browser receives the same broadcast — its reducer compares `voter_key` to `me.voter_key` and skips the bounce animation while still applying the server-authoritative vote count.

**Edit.** Joao saves a name change. `PATCH /api/ideas/<uid>` succeeds → DO calls `broadcast({ kind: "idea_edited", uid, patch, activity })`. Other browsers update the card name in place; rail prepends `> joao-f-o-goncalves edited qrm_000004`.

**Agent move via `/constraint`.** Telegram update → `setContext()` → `reanimate()`. Each affected idea's status flips and emits `broadcast({ kind: "idea_phase_change", uid, status, activity })`. After the loop, one summary `broadcast({ kind: "constraint_applied", reanimated, demoted, reason, activity })`. Open browsers see cards glide between columns and a chunky "Quorum reanimated 2, demoted 1 — budget cut to $5k" row appear on the rail. **The demo moment.**

**Connect / reconnect.** Page load opens `new WebSocket("/api/socket?chat=<id>")`. Cookie rides along; Worker authenticates and forwards. DO accepts via `state.acceptWebSocket(ws)`, attaches identity via `serializeAttachment`. DO sends `hello` with a fresh snapshot, then `broadcast({ kind: "presence_join", presence })` to others. On disconnect, `webSocketClose` hook fires `presence_leave`. Client auto-reconnects with exponential backoff: 1s → 2s → 4s → 8s → 15s (cap), 20% jitter on each delay. Each reconnect = fresh `hello`. If `connectionState` stays `offline` for >10s, the hook does a one-shot `fetchBoard()` REST call so the user isn't staring at stale data while reconnect retries.

## Server components

**`quorum/src/wire.ts` (new)** — the typed event union plus helper types. Pure types; no runtime code. Imported by `agent.ts`, `web/src/useLiveBoard.js` (via TS-only path), and the integration test.

**`quorum/src/agent.ts` (extended)**

- New private method `broadcast(event: Wire): void` — iterates `ctx.getWebSockets()`, JSON-stringifies, calls `ws.send` inside try/catch (ignore errors on dead sockets).
- New private method `renderSummary(eventKind, payload, actor): string` — pure function, returns the human-readable feed line. Snapshot-tested.
- New `webSocketClose(ws, code, reason, wasClean)` hook — reads `deserializeAttachment` for the connection_id, broadcasts `presence_leave`.
- New `webSocketError` hook — log only, no broadcast (the close hook will follow).
- New `webSocketMessage` hook — receives no client messages in v1; logs and ignores anything received.
- Each existing state-mutating method (`addIdea`, `toggleVote`, `updateIdea`, `validateIdea`, `reanimate`, `setContext`-via-reanimate path) gains a single trailing `broadcast(...)` call. Activity row construction reads from the just-appended `events` row to share IDs.
- `onRequest` adds a `/socket` route that handles `Upgrade: websocket`, calls `state.acceptWebSocket(ws)`, sets attachment, sends `hello`, broadcasts `presence_join`.

**`quorum/src/index.ts` (extended)**

- New route `GET /api/socket?chat=<id>` (with `Upgrade: websocket`):
  1. Origin check against `env.PUBLIC_BASE_URL` (with localhost allowlist when var is unset).
  2. Read session via `readSession`. If absent, mint an `anon:<nanoid>` identity.
  3. Resolve chat (existing `resolveBoardChat`).
  4. Throttle anon connections per IP (5 per minute per chat — small in-DO ring buffer keyed on `cf.connectingIp`). Authed connections are not throttled.
  5. Forward upgrade to DO at `/socket` with identity headers.

**`quorum/wrangler.jsonc`** — add `/api/socket` to `run_worker_first` so the static-assets handler doesn't intercept the upgrade.

## Frontend components

**`web/src/useLiveBoard.js` (new)** — single hook owning the socket and exposing `{ ideas, activity, presence, me, connectionState }`.

- `useEffect` opens the WS, parses messages, dispatches to a `useReducer`. Reducer cases per `Wire.kind`:
  - `hello` → replace all state from snapshot.
  - `idea_added` → append to ideas.
  - `idea_voted` → patch the card's `votes` and (if the local user is the voter) `voted_by_me`; suppress bounce animation when `voter_key === me.voter_key`.
  - `idea_edited` → merge patch into card.
  - `idea_phase_change` → update status; if status leaves board statuses (`parked`/`killed`), drop from ideas; trigger column-glide animation otherwise.
  - `scored` → update score + component fields.
  - `constraint_applied` → no-op for board state; activity row carries the message.
  - `presence_join`/`presence_leave` → update presence map.
- `connectionState`: `"connecting" | "open" | "reconnecting" | "offline"`.
- Reconnect with exponential backoff + 20% jitter: 1s, 2s, 4s, 8s, 15s (cap).
- Fallback: if `connectionState` is `"offline"` for >10s, one-shot `fetchBoard()` to refresh state.
- Optimistic-vote dedupe: existing `voteIdea(uid)` flow tags local card with `pending: true`; matching broadcast clears the flag.

**`web/src/components/ActivityRail.jsx` (new)** — fixed-width 280px right column, sticky. Renders activity rows newest-first in a virtualized list (50 rows max in memory). Auto-scrolls to top on new event when the user is already at top; otherwise shows a "5 new" pill that scrolls to top on click. Style matches the existing monospace/code-prompt aesthetic — `> molefas voted qrm_000003` with a fading relative timestamp ("2s ago").

**`web/src/components/PresencePile.jsx` (new)** — overlapping circular avatars in the header (max 5 visible + "+N" badge). Anon connections show a gray silhouette. Hover any avatar for the GitHub login.

**`web/src/components/ConnectionDot.jsx` (new)** — single dot in the header. Green = open, amber pulsing = reconnecting, red = offline. Tooltip shows the current `connectionState`.

**`web/src/App.jsx` (modified)** — replaces the existing `Promise.all([fetchBoard(), fetchMe()])` effect with `const { ideas, activity, presence, me, connectionState } = useLiveBoard(chatId)`. Renders `<PresencePile />` and `<ConnectionDot />` in the header, `<ActivityRail />` as a third column.

**Layout shift:** the existing 3-column board collapses from full-width to `1fr - 280px` to make room for the rail. On screens narrower than 1100px, the rail collapses into a bottom sheet (deferred polish — first cut is desktop-only).

## Error handling and security

- **Hibernation correctness.** No in-memory socket map on the DO. Always read from `ctx.getWebSockets()`. All per-connection state is in the attachment. Survives DO eviction transparently.
- **Stale broadcasts.** Closed sockets don't appear in `getWebSockets()`. `ws.send` on a half-closed socket throws — wrapped in try/catch and ignored. No reconciliation needed.
- **Self-echo.** Every state-changing event includes the actor (`voter_key` / `by`). Client reducer compares to local identity and skips originator-only animations. State is server-authoritative regardless.
- **Auth on upgrade.** Worker reads the session cookie before forwarding. Anon → `voter_key = anon:<nanoid>`, `login = null`, `can_edit = false`. The WS does NOT bypass any REST auth: editor PATCH still goes through the existing REST gate.
- **Origin check.** Upgrade returns 403 if `Origin` header doesn't match `env.PUBLIC_BASE_URL` (or `http://localhost:5173` in dev). Browsers don't enforce CORS on WebSocket upgrades, so we enforce server-side.
- **Rate / abuse.** Anon upgrades are throttled at the Worker — >5 attempts/minute from one IP to one chat → 429. Authed connections are not throttled (team-bounded). 50-socket soft cap per DO; 51st upgrade returns 503.
- **Activity feed injection-safety.** `summary` is server-rendered from typed fields only (login, uid, kind, prebuilt phrases). Never includes raw idea text or LLM output. Rail renders summaries as plain text — no HTML, no Markdown. Eliminates the prompt-injection-via-feed risk.
- **`run_worker_first`.** `/api/socket` must be added to the array in `wrangler.jsonc`. Without it, the static-assets handler intercepts the upgrade and the WS never reaches the Worker.
- **Closed Telegram chats / dead chats.** Sockets to a chat that no longer has a bot still work — the DO exists as long as something stored data there. Not a security issue.

## Testing

**Unit (Vitest in `quorum/`)**

- `renderSummary` — snapshot tests for each event kind against fixture payloads. Catches regressions in the user-facing wording.
- Reducer (in a test file mirroring `useLiveBoard`) — apply each event kind to a known state, assert resulting state. Pure function, easy to test.
- Attachment serialization — round-trip a `serializeAttachment` payload and assert equality.

**Integration (`quorum/scripts/multiclient-smoke.ts`)**

- Spin up `wrangler dev`, open 3 WebSocket connections (mix of authed + anon), drive REST writes (vote, edit, dev-seed), assert each connection observes the expected events in order. Catches the broadcast pipeline end-to-end without a browser.
- Variant: open 50 sockets, assert the 51st gets 503.

**Manual demo runbook (added to `CLAUDE.md`)**

- Two browsers side-by-side at `…/?chat=-5224131572`. Vote in one → see the count tick + rail row in the other inside 500ms.
- Trigger `/constraint` in the Telegram demo group → cards glide on both browsers and the rail shows the reanimation summary.
- Disconnect one browser's network for 5s, restore — `connectionState` cycles `open → reconnecting → open` and the snapshot resyncs.

**Out of scope**

- Load testing (50-socket cap is exercised by the integration script).
- Safari/Firefox WS quirks — manual eyeball pass post-deploy.
- DO migration during an active connection — Cloudflare handles this with hibernation.

## Deferred / follow-ups

Tracked here so they don't leak into this iteration:

- **Agent narration on `/constraint`.** Stream the agent's reasoning steps as it runs; would be one-shot LLM stream → multiple `agent_step` broadcasts. Highest demo punch but explicitly cut to keep this iteration shippable.
- **Richer animations.** Score-bar fill, vote-count odometer, card shuffle on full rerank. CSS-only, no protocol changes — pure polish pass.
- **Editor presence inside the modal.** Show "joao is editing qrm_000004" while another user has the modal open. Requires a small client→server signal (the only one in v2).
- **Per-user notification settings.** Mute the rail, follow a single idea, etc.
- **Mobile layout.** Bottom sheet for the rail under 1100px viewport.
- **`since` cursor on reconnect.** Avoid full snapshot when only N events are missed. Worth doing once chat history grows.
