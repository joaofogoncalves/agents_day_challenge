# Realtime Multiplayer Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Quorum board live across browsers — votes, edits, scoring, stage moves, and agent-driven changes propagate via WebSocket to every connected client, alongside a presence pile and a 50-row activity rail.

**Architecture:** Hibernating WebSockets in the existing `QuorumAgent` Durable Object. Worker authenticates the upgrade with the existing session cookie and forwards to the DO with identity headers. DO keeps no in-memory socket map — `ctx.getWebSockets()` is the source of truth and `ws.serializeAttachment` holds per-connection identity, so cold-wake is transparent. State-mutating methods on the DO call a new `broadcast(event)` helper. The socket is one-way: writes still go through REST.

**Tech Stack:** Cloudflare Workers + Agents SDK (DOs with embedded SQLite), Hibernating WebSockets API, TypeScript on the Worker side, React + Vite + plain JS on the frontend, Vitest for unit tests in both packages, `wrangler dev` for the integration smoke test.

**Spec:** `docs/superpowers/specs/2026-05-01-realtime-multiplayer-board-design.md`

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `quorum/src/wire.ts` | create | Typed event union (`Wire`), `ActorRef`, `Presence`, `ActivityRow`. Pure types + a few const tag literals. Imported by Worker, DO, and `web/`. |
| `quorum/src/summary.ts` | create | Pure `renderSummary(kind, payload, actor)` that produces the human-readable activity-feed line. Snapshot-tested. |
| `quorum/src/agent.ts` | modify | New `broadcast()` helper, new `webSocketClose` / `webSocketError` / `webSocketMessage` hooks, new `/socket` route in `onRequest`. Existing state methods (`addIdea`, `toggleVote`, `updateIdea`, `validateIdea`, `setStatus`, `reanimate`) gain a trailing broadcast. |
| `quorum/src/index.ts` | modify | New `GET /api/socket` route: origin check, session read, anon fallback, anon-IP throttle, forward upgrade. |
| `quorum/wrangler.jsonc` | modify | Add `/api/socket` to `run_worker_first`. |
| `quorum/package.json` | modify | Add `vitest` devDep + `test` script. |
| `quorum/vitest.config.ts` | create | Minimal Node-environment vitest config. |
| `quorum/test/summary.test.ts` | create | Snapshot tests per event kind. |
| `quorum/test/attachment.test.ts` | create | Round-trip test for socket attachment shape. |
| `quorum/scripts/multiclient-smoke.ts` | create | Integration smoke: opens 3 sockets against `wrangler dev`, drives REST writes, asserts events received. |
| `web/src/reducer.js` | create | Pure board+activity+presence reducer extracted for testability. Consumes `Wire` events. |
| `web/src/useLiveBoard.js` | create | React hook owning the socket lifecycle, dispatches to `reducer.js`, exposes `{ ideas, activity, presence, me, connectionState }`. |
| `web/src/components/ConnectionDot.jsx` | create | Single dot — green/amber/red — for `connectionState`. |
| `web/src/components/PresencePile.jsx` | create | Overlapping avatars, max 5 + "+N". |
| `web/src/components/ActivityRail.jsx` | create | 280px right column, last 50 rows, "N new" pill on scroll-away. |
| `web/src/App.jsx` | modify | Replace `Promise.all([fetchBoard, fetchMe])` with `useLiveBoard`. Mount the three new components. |
| `web/src/styles.css` | modify | Add rail layout (`grid-template-columns: 1fr 280px`), connection dot, presence pile, activity row styles. |
| `web/package.json` | modify | Add `vitest` devDep + `test` script. |
| `web/vitest.config.js` | create | jsdom-environment vitest config (none needed actually — reducer is pure JS, node env is fine). |
| `web/test/reducer.test.js` | create | One test per event kind: apply to known state, assert result. |
| `CLAUDE.md` | modify | Append manual demo runbook (two-browser walkthrough). |

`web/` imports types from `../../quorum/src/wire` (TS-only via Vite). Runtime code on the frontend stays plain JS — only the type import is TS, and Vite drops type imports during build.

---

## Task 1: Wire protocol types

**Files:**
- Create: `quorum/src/wire.ts`

- [ ] **Step 1: Create the wire types file**

```ts
// quorum/src/wire.ts
//
// Realtime board events. Single source of truth for both the Worker/DO
// and the web/ frontend (imported as type-only from the relative path
// `../../quorum/src/wire`). Pure types — no runtime code.

import type { BoardIdea, Status, EventType } from "./schema";

export type ActorRef =
  | { kind: "user"; login: string; avatar: string }
  | { kind: "agent" }
  | { kind: "anon"; id: string };

export type Presence = {
  connection_id: string;
  actor: ActorRef;
  joined_at: number; // unix ms
};

export type ActivityRow = {
  id: number;             // events.id from DB, monotonic per chat
  event_kind: EventType;
  summary: string;        // server-rendered, plain text only
  by: ActorRef;
  ts: number;             // unix ms
  target_uid: string | null;
};

export type HelloSnapshot = {
  ideas: BoardIdea[];
  activity: ActivityRow[]; // last 50, newest LAST (chronological)
  presence: Presence[];
  me: { voter_key: string; login: string | null; can_edit: boolean };
  last_event_id: number;
};

export type Wire =
  | { kind: "hello"; snapshot: HelloSnapshot }
  | { kind: "idea_added";        idea: BoardIdea;                                                                     activity: ActivityRow }
  | { kind: "idea_voted";        uid: string; votes: number; voter_key: string; voted: boolean;                       activity: ActivityRow }
  | { kind: "idea_edited";       uid: string; patch: { name?: string; long?: string; brief?: string };                activity: ActivityRow }
  | { kind: "idea_phase_change"; uid: string; status: Status;                                                         activity: ActivityRow }
  | { kind: "scored";            uid: string; score: number; components: { team: number; resource: number; market: number }; activity: ActivityRow }
  | { kind: "constraint_applied"; reanimated: string[]; demoted: string[]; reason: string;                            activity: ActivityRow }
  | { kind: "presence_join";  presence: Presence }
  | { kind: "presence_leave"; connection_id: string };

export type WireKind = Wire["kind"];

/** Per-connection metadata persisted via ws.serializeAttachment. */
export type SocketAttachment = {
  connection_id: string;
  voter_key: string;        // gh:<login> | anon:<nanoid>
  login: string | null;
  avatar: string | null;
  joined_at: number;        // unix ms
};
```

- [ ] **Step 2: Verify types compile**

Run: `cd quorum && npm run check`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add quorum/src/wire.ts
git commit -m "Add typed wire protocol for realtime board events"
```

---

## Task 2: Vitest setup + summary helper test

**Files:**
- Modify: `quorum/package.json`
- Create: `quorum/vitest.config.ts`
- Create: `quorum/test/summary.test.ts`

- [ ] **Step 1: Install vitest**

Run: `cd quorum && npm install --save-dev vitest`
Expected: vitest added to devDependencies.

- [ ] **Step 2: Add test script**

Edit `quorum/package.json` — add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest config**

```ts
// quorum/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write the failing test**

```ts
// quorum/test/summary.test.ts
import { describe, expect, it } from "vitest";
import { renderSummary } from "../src/summary";
import type { ActorRef } from "../src/wire";

const alice: ActorRef = { kind: "user", login: "alice", avatar: "" };
const agent: ActorRef = { kind: "agent" };
const anon: ActorRef = { kind: "anon", id: "abc123" };

describe("renderSummary", () => {
  it("renders a vote by a user", () => {
    expect(
      renderSummary({
        event_kind: "idea_voted",
        target_uid: "qrm_000003",
        by: alice,
        payload: { voted: true },
      }),
    ).toBe("alice voted qrm_000003");
  });

  it("renders an unvote", () => {
    expect(
      renderSummary({
        event_kind: "idea_voted",
        target_uid: "qrm_000003",
        by: alice,
        payload: { voted: false },
      }),
    ).toBe("alice unvoted qrm_000003");
  });

  it("renders an idea added", () => {
    expect(
      renderSummary({
        event_kind: "idea_added",
        target_uid: "qrm_000010",
        by: alice,
        payload: {},
      }),
    ).toBe("alice added qrm_000010");
  });

  it("renders an edit", () => {
    expect(
      renderSummary({
        event_kind: "idea_edited",
        target_uid: "qrm_000004",
        by: alice,
        payload: { fields: ["name", "long"] },
      }),
    ).toBe("alice edited qrm_000004 (name, long)");
  });

  it("renders a phase change by the agent", () => {
    expect(
      renderSummary({
        event_kind: "idea_phase_change",
        target_uid: "qrm_000007",
        by: agent,
        payload: { status: "validating" },
      }),
    ).toBe("Quorum moved qrm_000007 to validating");
  });

  it("renders a score result", () => {
    expect(
      renderSummary({
        event_kind: "scored",
        target_uid: "qrm_000007",
        by: agent,
        payload: { score: 7 },
      }),
    ).toBe("Quorum scored qrm_000007 → 7");
  });

  it("renders a constraint applied", () => {
    expect(
      renderSummary({
        event_kind: "reanimated",
        target_uid: null,
        by: agent,
        payload: { reanimated: 2, demoted: 1, reason: "budget cut to $5k" },
      }),
    ).toBe("Quorum reanimated 2, demoted 1 — budget cut to $5k");
  });

  it("renders an anonymous actor as 'someone'", () => {
    expect(
      renderSummary({
        event_kind: "idea_voted",
        target_uid: "qrm_000003",
        by: anon,
        payload: { voted: true },
      }),
    ).toBe("someone voted qrm_000003");
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd quorum && npm test -- summary`
Expected: FAIL with "Cannot find module '../src/summary'".

- [ ] **Step 6: Commit (red state)**

```bash
git add quorum/package.json quorum/vitest.config.ts quorum/test/summary.test.ts quorum/package-lock.json
git commit -m "Add vitest + failing renderSummary tests"
```

---

## Task 3: Implement renderSummary

**Files:**
- Create: `quorum/src/summary.ts`

- [ ] **Step 1: Implement the helper**

```ts
// quorum/src/summary.ts
//
// Pure function that turns a typed event into a one-line activity-feed
// summary. Plain text only — output is rendered as-is on the client
// without any HTML/Markdown processing, so this is the only place that
// decides how each event reads.

import type { ActorRef } from "./wire";
import type { EventType } from "./schema";

type SummaryInput = {
  event_kind: EventType;
  target_uid: string | null;
  by: ActorRef;
  payload: Record<string, unknown>;
};

function actorName(actor: ActorRef): string {
  if (actor.kind === "user") return actor.login;
  if (actor.kind === "agent") return "Quorum";
  return "someone";
}

export function renderSummary(input: SummaryInput): string {
  const who = actorName(input.by);
  const uid = input.target_uid ?? "";
  const p = input.payload;

  switch (input.event_kind) {
    case "idea_added":
      return `${who} added ${uid}`;
    case "idea_voted":
      return p.voted ? `${who} voted ${uid}` : `${who} unvoted ${uid}`;
    case "idea_edited": {
      const fields = Array.isArray(p.fields) ? (p.fields as string[]).join(", ") : "";
      return fields ? `${who} edited ${uid} (${fields})` : `${who} edited ${uid}`;
    }
    case "idea_phase_change":
      return `${who} moved ${uid} to ${String(p.status ?? "?")}`;
    case "scored":
      return `${who} scored ${uid} → ${String(p.score ?? "?")}`;
    case "reanimated":
      return `${who} reanimated ${String(p.reanimated ?? 0)}, demoted ${String(p.demoted ?? 0)} — ${String(p.reason ?? "")}`;
    case "demoted":
      return `${who} demoted ${uid}`;
    case "context_changed":
      return `${who} changed context`;
    case "observed":
      return `${who} observed`;
    case "router_call":
      return `${who} routed`;
    case "injection_blocked":
      return `${who} blocked input`;
    default:
      return `${who} ${String(input.event_kind)} ${uid}`.trim();
  }
}
```

- [ ] **Step 2: Run tests — verify they pass**

Run: `cd quorum && npm test -- summary`
Expected: 8 tests pass.

- [ ] **Step 3: Run typecheck**

Run: `cd quorum && npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add quorum/src/summary.ts
git commit -m "Implement renderSummary for activity-feed lines"
```

---

## Task 4: Add broadcast helper + WS lifecycle hooks to QuorumAgent

**Files:**
- Modify: `quorum/src/agent.ts`

- [ ] **Step 1: Add imports near the top of agent.ts**

After the existing `import` block (around line 1-15), append:

```ts
import type { Wire, ActorRef, Presence, ActivityRow, SocketAttachment } from "./wire";
import { renderSummary } from "./summary";
```

- [ ] **Step 2: Add the broadcast helper as a private method on `QuorumAgent`**

Insert this method inside the class body (e.g. just before `addIdea`). The signature is exact — every existing state-mutation method will call `this.broadcast(...)` later.

```ts
  /**
   * Send a typed event to every connected WebSocket on this DO.
   * Hibernation-aware: reads from ctx.getWebSockets() each call (no
   * in-memory socket map) and ignores send errors on dead sockets.
   */
  private broadcast(event: Wire): void {
    const frame = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(frame);
      } catch {
        // Dead socket — ctx.getWebSockets() will drop it on the next call.
      }
    }
  }

  /**
   * Compose an ActivityRow from the row that was just appended to `events`.
   * Returns null when the event kind shouldn't surface on the feed
   * (presence-style or internal kinds).
   */
  private activityRowFromEvent(args: {
    event_id: number;
    event_kind: import("./schema").EventType;
    target_uid: string | null;
    by: ActorRef;
    ts: number;
    payload: Record<string, unknown>;
  }): ActivityRow {
    return {
      id: args.event_id,
      event_kind: args.event_kind,
      summary: renderSummary({
        event_kind: args.event_kind,
        target_uid: args.target_uid,
        by: args.by,
        payload: args.payload,
      }),
      by: args.by,
      ts: args.ts,
      target_uid: args.target_uid,
    };
  }
```

- [ ] **Step 3: Add WebSocket lifecycle hooks**

Append these methods to the `QuorumAgent` class (after the existing methods):

```ts
  // ── WebSocket lifecycle (Hibernating WebSockets API) ─────────────

  webSocketMessage(_ws: WebSocket, _msg: string | ArrayBuffer): void {
    // v1: clients send no messages. Ignore.
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att) return;
    this.broadcast({ kind: "presence_leave", connection_id: att.connection_id });
  }

  webSocketError(_ws: WebSocket, _err: unknown): void {
    // close hook will follow; no broadcast here.
  }

  /**
   * Snapshot of currently-connected actors. Used to populate Presence in
   * the hello message and (indirectly) by presence_join consumers.
   */
  private currentPresence(): Presence[] {
    const out: Presence[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att) continue;
      out.push({
        connection_id: att.connection_id,
        actor: att.login
          ? { kind: "user", login: att.login, avatar: att.avatar ?? "" }
          : { kind: "anon", id: att.voter_key.startsWith("anon:") ? att.voter_key.slice(5) : att.voter_key },
        joined_at: att.joined_at,
      });
    }
    return out;
  }
```

- [ ] **Step 4: Verify typecheck**

Run: `cd quorum && npm run check`
Expected: PASS. (May surface unused-variable warnings on `_ws` etc. — that's fine because of the underscore prefix.)

- [ ] **Step 5: Commit**

```bash
git add quorum/src/agent.ts
git commit -m "Add broadcast helper + WS lifecycle hooks to QuorumAgent"
```

---

## Task 5: Add `/socket` route inside QuorumAgent

**Files:**
- Modify: `quorum/src/agent.ts`

- [ ] **Step 1: Locate the `onRequest` method**

Find `async onRequest(request: Request): Promise<Response>` (around line 59). It already routes paths like `/onUpdate`, `/board`, `/board/dev-seed`, `/board/ideas/...`. Add a new `/socket` branch.

- [ ] **Step 2: Add the upgrade handler**

Inside `onRequest`, before the existing `/board/...` routes, add this block. Identity headers are forwarded by the Worker (Task 7).

```ts
    if (url.pathname === "/socket") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 });
      }

      // 50-socket soft cap per DO.
      if (this.ctx.getWebSockets().length >= 50) {
        return new Response("too many connections", { status: 503 });
      }

      const voterKey = request.headers.get("x-quorum-voter") ?? "";
      const login = request.headers.get("x-quorum-login") || null;
      const avatar = request.headers.get("x-quorum-avatar") || null;
      if (!voterKey) return new Response("missing identity", { status: 400 });

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      const attachment: SocketAttachment = {
        connection_id: crypto.randomUUID(),
        voter_key: voterKey,
        login,
        avatar,
        joined_at: Date.now(),
      };
      server.serializeAttachment(attachment);

      this.ctx.acceptWebSocket(server);

      // Build & send the hello snapshot.
      const sql = this.sql;
      const lastEventRow = sql`SELECT COALESCE(MAX(id), 0) AS id FROM events`[0] as { id: number } | undefined;
      const last_event_id = lastEventRow?.id ?? 0;

      const activityRows = sql`
        SELECT id, event_type, idea_id, payload, created_at
        FROM events
        ORDER BY id DESC
        LIMIT 50
      ` as Array<{ id: number; event_type: string; idea_id: number | null; payload: string | null; created_at: number }>;

      const activity: ActivityRow[] = activityRows
        .reverse()
        .map((row) => {
          let payload: Record<string, unknown> = {};
          if (row.payload) {
            try { payload = JSON.parse(row.payload); } catch { payload = {}; }
          }
          const by = (payload.by as ActorRef | undefined) ?? { kind: "agent" };
          const target_uid = row.idea_id != null
            ? `qrm_${String(row.idea_id).padStart(6, "0")}`
            : null;
          return this.activityRowFromEvent({
            event_id: row.id,
            event_kind: row.event_type as import("./schema").EventType,
            target_uid,
            by,
            ts: row.created_at,
            payload,
          });
        });

      const presence = this.currentPresence();

      const helloActor: ActorRef = login
        ? { kind: "user", login, avatar: avatar ?? "" }
        : { kind: "anon", id: voterKey.startsWith("anon:") ? voterKey.slice(5) : voterKey };

      const helloMsg: Wire = {
        kind: "hello",
        snapshot: {
          ideas: this.getBoard(voterKey),
          activity,
          presence,
          me: {
            voter_key: voterKey,
            login,
            can_edit: request.headers.get("x-quorum-editor") === "1",
          },
          last_event_id,
        },
      };

      try {
        server.send(JSON.stringify(helloMsg));
      } catch {
        // unlikely on a freshly-accepted socket
      }

      // Tell everyone else this person joined.
      this.broadcast({
        kind: "presence_join",
        presence: {
          connection_id: attachment.connection_id,
          actor: helloActor,
          joined_at: attachment.joined_at,
        },
      });

      return new Response(null, { status: 101, webSocket: client });
    }
```

- [ ] **Step 3: Verify typecheck**

Run: `cd quorum && npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add quorum/src/agent.ts
git commit -m "Add /socket upgrade route to QuorumAgent with hello snapshot"
```

---

## Task 6: Wire `/api/socket` route in Worker + wrangler config

**Files:**
- Modify: `quorum/src/index.ts`
- Modify: `quorum/wrangler.jsonc`

- [ ] **Step 1: Add `/api/socket` to `run_worker_first`**

Edit `quorum/wrangler.jsonc`. The existing line is:

```jsonc
"run_worker_first": ["/webhook", "/healthz", "/api/*", "/auth/*", "/g/*"]
```

`/api/*` already matches `/api/socket`, so no change is required. Verify by inspection — leave as is.

- [ ] **Step 2: Add `/api/socket` to the Worker fetch handler**

Edit `quorum/src/index.ts`. After the existing `/api/dev-seed` block but before `/api/board`, add:

```ts
    // ── WebSocket upgrade for the live board ────────────────────────
    if (url.pathname === "/api/socket" && request.headers.get("Upgrade") === "websocket") {
      // Origin check. Browsers don't enforce CORS on WS upgrades, so
      // we enforce it server-side. PUBLIC_BASE_URL is canonical in
      // prod; localhost:5173 is allowed in dev.
      const origin = request.headers.get("Origin");
      const allowed = new Set<string>();
      if (env.PUBLIC_BASE_URL) allowed.add(env.PUBLIC_BASE_URL.replace(/\/$/, ""));
      allowed.add("http://localhost:5173");
      allowed.add("http://127.0.0.1:5173");
      if (!origin || !allowed.has(origin)) {
        return new Response("forbidden origin", { status: 403 });
      }

      const session = await readSession(request, env);
      const chat = resolveBoardChat(env, url);
      if (!chat) return new Response("no chat", { status: 400 });

      // Identity. Authed = gh:<login>; otherwise mint a per-tab anon key.
      let voter = session ? voterKey(session.login) : "";
      let login: string | null = session?.login ?? null;
      let avatar: string | null = session?.avatar_url ?? null;
      if (!voter) {
        // Random 12-byte hex id; ephemeral, per-connection.
        const bytes = new Uint8Array(12);
        crypto.getRandomValues(bytes);
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        voter = `anon:${hex}`;
      }

      const id = env.QuorumAgent.idFromName(chat);
      const stub = env.QuorumAgent.get(id);
      const headers = new Headers(request.headers);
      headers.set("x-quorum-voter", voter);
      headers.set("x-quorum-login", login ?? "");
      headers.set("x-quorum-avatar", avatar ?? "");
      if (session && isEditor(session.login, env)) {
        headers.set("x-quorum-editor", "1");
      }
      return stub.fetch(
        new Request(new URL("/socket", request.url).toString(), {
          method: "GET",
          headers,
        }),
      );
    }
```

- [ ] **Step 3: Verify typecheck**

Run: `cd quorum && npm run check`
Expected: PASS.

- [ ] **Step 4: Smoke-test locally**

Start the dev server in one shell:

```bash
cd quorum && CLOUDFLARE_ACCOUNT_ID=89a5603e30493fa6a1fd7555c6a86353 npm run dev
```

In another shell, hit the upgrade with a manual `wscat` or `websocat` if available, otherwise just verify the 403 path:

```bash
curl -i -H "Upgrade: websocket" -H "Connection: Upgrade" http://127.0.0.1:8787/api/socket?chat=-5224131572
```

Expected: `403 forbidden origin` (no Origin header). With `-H "Origin: http://localhost:5173"`, expect a `400` (cloudflare's wrangler dev returns 400 for incomplete WS upgrades — that's fine; it means the route was reached).

- [ ] **Step 5: Commit**

```bash
git add quorum/src/index.ts
git commit -m "Add /api/socket Worker route — auth, anon fallback, origin check"
```

---

## Task 7: Hook broadcasts into addIdea

**Files:**
- Modify: `quorum/src/agent.ts`

- [ ] **Step 1: Locate `addIdea`**

Around line 146 of `agent.ts`. Current shape:

```ts
addIdea(text: string, authorId: string): { id: number } {
  // ... INSERT INTO ideas ... INSERT INTO events ...
  return { id: <newId> };
}
```

- [ ] **Step 2: Capture event ID + actor; broadcast at the end**

Replace the body so the function records the inserted event ID and broadcasts. The exact new text depends on the existing implementation — modify the function so:

1. The `events` insert uses a payload that contains `{ by: ActorRef, ... }`. Use `{ kind: "agent" }` as a default for now since `addIdea` doesn't know the GitHub login of the Telegram author. Where the Worker calls `addIdea` from a web context (none today, but reserved), pass actor via a new optional param.

2. After the insert, fetch the new event row's id (`SELECT last_insert_rowid() AS id`) and the new BoardIdea via `getBoard()` filtered by uid.

3. Call `this.broadcast({ kind: "idea_added", idea: newIdea, activity })`.

Concrete edit — wrap the existing function so the broadcast happens after the existing writes succeed. Append at the end of `addIdea`, before `return`:

```ts
    // Broadcast for live board.
    const newId = (this.sql`SELECT last_insert_rowid() AS id`[0] as { id: number }).id;
    const eventRow = this.sql`SELECT id, created_at FROM events WHERE id = (SELECT MAX(id) FROM events)`[0] as { id: number; created_at: number } | undefined;
    if (eventRow) {
      const idea = this.getBoard(null).find((i) => i.uid === `qrm_${String(newId).padStart(6, "0")}`);
      if (idea) {
        const by: ActorRef = { kind: "agent" };
        const activity = this.activityRowFromEvent({
          event_id: eventRow.id,
          event_kind: "idea_added",
          target_uid: idea.uid,
          by,
          ts: eventRow.created_at,
          payload: {},
        });
        this.broadcast({ kind: "idea_added", idea, activity });
      }
    }
```

(Adjust the `newId` extraction to match the existing return shape — if `addIdea` already has `const id = ...` from the insert, reuse it directly.)

- [ ] **Step 3: Verify typecheck**

Run: `cd quorum && npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add quorum/src/agent.ts
git commit -m "Broadcast idea_added on addIdea"
```

---

## Task 8: Hook broadcasts into toggleVote

**Files:**
- Modify: `quorum/src/agent.ts`

- [ ] **Step 1: Locate `toggleVote(id, voterKey)` (around line 240)**

Current return shape: `{ votes: number; voted: boolean } | null`.

- [ ] **Step 2: Append broadcast before each return**

Inside the function, after the SQL writes that determine the new `votes` and `voted`, but before the `return`, capture the latest event row and broadcast. Insert just above the success return:

```ts
    const uid = `qrm_${String(id).padStart(6, "0")}`;
    const eventRow = this.sql`SELECT id, created_at, payload FROM events WHERE id = (SELECT MAX(id) FROM events WHERE idea_id = ${id} AND event_type = 'idea_voted')`[0] as { id: number; created_at: number; payload: string | null } | undefined;
    if (eventRow) {
      // The actor is encoded in the events.payload — voteIdea/toggleVote
      // should write `{ by: { kind: "user", login: <voter login>, avatar: "" } }`
      // when called from the web. For Telegram regex `+1 #N`, by is agent/anon.
      let by: ActorRef = { kind: "agent" };
      try {
        const parsed = eventRow.payload ? JSON.parse(eventRow.payload) : {};
        if (parsed.by) by = parsed.by as ActorRef;
      } catch { /* keep agent */ }
      const activity = this.activityRowFromEvent({
        event_id: eventRow.id,
        event_kind: "idea_voted",
        target_uid: uid,
        by,
        ts: eventRow.created_at,
        payload: { voted },
      });
      this.broadcast({
        kind: "idea_voted",
        uid,
        votes,
        voter_key: voterKey,
        voted,
        activity,
      });
    }
```

(Where `voted` and `votes` are the local variables `toggleVote` already computes. If they're named differently in the existing implementation, adapt the names without changing semantics.)

- [ ] **Step 3: Ensure the `events.payload` insert in toggleVote includes `{ by }`**

Find the `INSERT INTO events` statement inside `toggleVote`. Modify the payload to include the voter's identity. The function signature only has `voterKey` (e.g. `gh:alice`); derive a minimal `ActorRef`:

```ts
const actor: ActorRef = voterKey.startsWith("gh:")
  ? { kind: "user", login: voterKey.slice(3), avatar: "" }
  : { kind: "anon", id: voterKey };
// existing INSERT, with payload JSON containing { by: actor, voted }:
this.sql`INSERT INTO events (idea_id, event_type, payload, created_at)
         VALUES (${id}, 'idea_voted', ${JSON.stringify({ by: actor, voted })}, ${Date.now()})`;
```

- [ ] **Step 4: Verify typecheck**

Run: `cd quorum && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add quorum/src/agent.ts
git commit -m "Broadcast idea_voted on toggleVote"
```

---

## Task 9: Hook broadcasts into updateIdea

**Files:**
- Modify: `quorum/src/agent.ts`

- [ ] **Step 1: Locate `updateIdea(id, patch, editor, voterKey)` (search for `updateIdea`)**

- [ ] **Step 2: Append broadcast before successful return**

After the SQL UPDATE + the existing `events` insert (`idea_edited`), and before returning the BoardIdea:

```ts
    const uid = `qrm_${String(id).padStart(6, "0")}`;
    const eventRow = this.sql`SELECT id, created_at FROM events WHERE id = (SELECT MAX(id) FROM events WHERE idea_id = ${id} AND event_type = 'idea_edited')`[0] as { id: number; created_at: number } | undefined;
    if (eventRow) {
      const by: ActorRef = editor
        ? { kind: "user", login: editor, avatar: "" }
        : { kind: "agent" };
      const fields = Object.keys(patch);
      const activity = this.activityRowFromEvent({
        event_id: eventRow.id,
        event_kind: "idea_edited",
        target_uid: uid,
        by,
        ts: eventRow.created_at,
        payload: { fields },
      });
      this.broadcast({ kind: "idea_edited", uid, patch, activity });
    }
```

- [ ] **Step 3: Make sure the `events` insert in updateIdea writes the editor as `by`**

In the existing `INSERT INTO events ... VALUES (...)`, modify the payload to include `{ by: { kind: "user", login: editor, avatar: "" }, fields: Object.keys(patch) }`.

- [ ] **Step 4: Verify typecheck**

Run: `cd quorum && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add quorum/src/agent.ts
git commit -m "Broadcast idea_edited on updateIdea"
```

---

## Task 10: Hook broadcasts into setStatus, validateIdea, reanimate

**Files:**
- Modify: `quorum/src/agent.ts`

- [ ] **Step 1: setStatus — broadcast `idea_phase_change`**

Inside `setStatus(id, status, reason)`, after the SQL UPDATE + events insert:

```ts
    const uid = `qrm_${String(id).padStart(6, "0")}`;
    const eventRow = this.sql`SELECT id, created_at FROM events WHERE id = (SELECT MAX(id) FROM events WHERE idea_id = ${id} AND event_type = 'idea_phase_change')`[0] as { id: number; created_at: number } | undefined;
    if (eventRow) {
      const by: ActorRef = { kind: "agent" };
      const activity = this.activityRowFromEvent({
        event_id: eventRow.id,
        event_kind: "idea_phase_change",
        target_uid: uid,
        by,
        ts: eventRow.created_at,
        payload: { status, reason },
      });
      this.broadcast({ kind: "idea_phase_change", uid, status, activity });
    }
```

- [ ] **Step 2: validateIdea — broadcast `scored`**

Inside `validateIdea(id)`, after the LLM scoring writes `score_team/score_resource/score_market` and appends the `scored` event:

```ts
    const uid = `qrm_${String(id).padStart(6, "0")}`;
    const ideaRow = this.getBoard(null).find((i) => i.uid === uid);
    const eventRow = this.sql`SELECT id, created_at FROM events WHERE id = (SELECT MAX(id) FROM events WHERE idea_id = ${id} AND event_type = 'scored')`[0] as { id: number; created_at: number } | undefined;
    if (ideaRow && eventRow) {
      const by: ActorRef = { kind: "agent" };
      const activity = this.activityRowFromEvent({
        event_id: eventRow.id,
        event_kind: "scored",
        target_uid: uid,
        by,
        ts: eventRow.created_at,
        payload: { score: ideaRow.score },
      });
      this.broadcast({
        kind: "scored",
        uid,
        score: ideaRow.score,
        components: { team, resource, market }, // local vars from the scoring pipeline
        activity,
      });
    }
```

- [ ] **Step 3: reanimate — broadcast `idea_phase_change` per affected + `constraint_applied` summary**

Inside `reanimate(constraint)`, after the loop that updates statuses, iterate over the affected ideas and broadcast a phase change for each. Then broadcast a single `constraint_applied` summary event. Pseudo:

```ts
    for (const id of reanimatedIds) {
      const uid = `qrm_${String(id).padStart(6, "0")}`;
      const eventRow = this.sql`SELECT id, created_at FROM events WHERE id = (SELECT MAX(id) FROM events WHERE idea_id = ${id} AND event_type = 'reanimated')`[0] as { id: number; created_at: number } | undefined;
      if (!eventRow) continue;
      const activity = this.activityRowFromEvent({
        event_id: eventRow.id,
        event_kind: "idea_phase_change",
        target_uid: uid,
        by: { kind: "agent" },
        ts: eventRow.created_at,
        payload: { status: "validating" },
      });
      this.broadcast({ kind: "idea_phase_change", uid, status: "validating", activity });
    }
    for (const id of demotedIds) {
      const uid = `qrm_${String(id).padStart(6, "0")}`;
      const eventRow = this.sql`SELECT id, created_at FROM events WHERE id = (SELECT MAX(id) FROM events WHERE idea_id = ${id} AND event_type = 'demoted')`[0] as { id: number; created_at: number } | undefined;
      if (!eventRow) continue;
      const activity = this.activityRowFromEvent({
        event_id: eventRow.id,
        event_kind: "idea_phase_change",
        target_uid: uid,
        by: { kind: "agent" },
        ts: eventRow.created_at,
        payload: { status: "parked" },
      });
      this.broadcast({ kind: "idea_phase_change", uid, status: "parked", activity });
    }

    // Single summary event.
    const summaryEventRow = this.sql`INSERT INTO events (event_type, payload, created_at)
      VALUES ('reanimated', ${JSON.stringify({ by: { kind: "agent" }, reanimated: reanimatedIds.length, demoted: demotedIds.length, reason: constraint })}, ${Date.now()})
      RETURNING id, created_at`[0] as { id: number; created_at: number };
    const reanimatedUids = reanimatedIds.map((id) => `qrm_${String(id).padStart(6, "0")}`);
    const demotedUids = demotedIds.map((id) => `qrm_${String(id).padStart(6, "0")}`);
    const summaryActivity = this.activityRowFromEvent({
      event_id: summaryEventRow.id,
      event_kind: "reanimated",
      target_uid: null,
      by: { kind: "agent" },
      ts: summaryEventRow.created_at,
      payload: { reanimated: reanimatedIds.length, demoted: demotedIds.length, reason: constraint },
    });
    this.broadcast({
      kind: "constraint_applied",
      reanimated: reanimatedUids,
      demoted: demotedUids,
      reason: constraint,
      activity: summaryActivity,
    });
```

(If `reanimate` already inserts a summary `events` row, reuse its id instead of inserting again.)

- [ ] **Step 4: Verify typecheck**

Run: `cd quorum && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add quorum/src/agent.ts
git commit -m "Broadcast scored, idea_phase_change, constraint_applied"
```

---

## Task 11: Anon-IP throttle for /api/socket

**Files:**
- Modify: `quorum/src/index.ts`

- [ ] **Step 1: Add an in-memory throttle map at module scope**

At the top of `quorum/src/index.ts` (after imports), add:

```ts
// Anon WS upgrade throttle: <ip>::<chat> -> array of upgrade timestamps
// in the last 60s. >5 entries = 429. Module-scope state is fine here
// because the Worker isolate is per-region per-handler — collisions
// only happen when one IP genuinely floods, which is what we're
// guarding against.
const ANON_UPGRADE_LOG = new Map<string, number[]>();
function checkAnonRate(ip: string, chat: string): boolean {
  const key = `${ip}::${chat}`;
  const now = Date.now();
  const cutoff = now - 60_000;
  const entries = (ANON_UPGRADE_LOG.get(key) ?? []).filter((t) => t > cutoff);
  if (entries.length >= 5) {
    ANON_UPGRADE_LOG.set(key, entries);
    return false;
  }
  entries.push(now);
  ANON_UPGRADE_LOG.set(key, entries);
  return true;
}
```

- [ ] **Step 2: Apply the throttle in /api/socket, only for anon connections**

Inside the `/api/socket` handler from Task 6, after computing `voter` and *before* `stub.fetch`:

```ts
      if (!session) {
        const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
        if (!checkAnonRate(ip, chat)) {
          return new Response("rate limit", { status: 429 });
        }
      }
```

- [ ] **Step 3: Verify typecheck**

Run: `cd quorum && npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add quorum/src/index.ts
git commit -m "Throttle anon /api/socket upgrades to 5/min/IP/chat"
```

---

## Task 12: Multiclient integration smoke script

**Files:**
- Create: `quorum/scripts/multiclient-smoke.ts`

- [ ] **Step 1: Write the script**

```ts
// quorum/scripts/multiclient-smoke.ts
//
// Smoke test against `wrangler dev`. Opens 3 anon WebSockets to the
// dev seed chat, drives a vote via REST, asserts each socket sees the
// idea_voted event. Exit code 0 = pass. Run with:
//   cd quorum && npx tsx scripts/multiclient-smoke.ts
//
// Assumes wrangler dev is already running at 127.0.0.1:8787 with at
// least one idea in chat -5120669057 (or whatever you pass as CHAT).

import WebSocket from "ws";

const BASE = process.env.QUORUM_BASE ?? "http://127.0.0.1:8787";
const WS_BASE = BASE.replace(/^http/, "ws");
const CHAT = process.env.QUORUM_CHAT ?? "-5120669057";
const ORIGIN = "http://localhost:5173";

type Frame = Record<string, unknown> & { kind: string };

function open(label: string): Promise<{ ws: WebSocket; got: Frame[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/api/socket?chat=${encodeURIComponent(CHAT)}`, {
      headers: { Origin: ORIGIN },
    });
    const got: Frame[] = [];
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      got.push(frame);
      console.log(`[${label}] ←`, frame.kind);
    });
    ws.on("open", () => resolve({ ws, got }));
    ws.on("error", reject);
  });
}

async function main() {
  const a = await open("A");
  const b = await open("B");
  const c = await open("C");

  // Wait for all to receive hello.
  await new Promise((r) => setTimeout(r, 500));
  for (const [label, conn] of [["A", a], ["B", b], ["C", c]] as const) {
    if (!conn.got.some((f) => f.kind === "hello")) {
      throw new Error(`${label} never received hello`);
    }
  }

  // Find an idea uid to vote on.
  const board = await fetch(`${BASE}/api/board?chat=${encodeURIComponent(CHAT)}`).then((r) => r.json()) as { ideas: Array<{ uid: string }> };
  const uid = board.ideas[0]?.uid;
  if (!uid) throw new Error("no ideas in board to vote on — seed first");

  // Vote (this requires auth; if no session cookie, the server will return 401
  // and the test fails quickly with a clear message).
  const voteRes = await fetch(`${BASE}/api/ideas/${uid}/vote?chat=${encodeURIComponent(CHAT)}`, {
    method: "POST",
    headers: { Cookie: process.env.QUORUM_COOKIE ?? "" },
  });
  if (voteRes.status === 401) {
    console.warn("vote returned 401 — set QUORUM_COOKIE=quorum_session=<token> to test the broadcast pipeline");
    process.exit(2);
  }
  if (!voteRes.ok) throw new Error(`vote failed: ${voteRes.status}`);

  // Each socket should see the broadcast.
  await new Promise((r) => setTimeout(r, 500));
  for (const [label, conn] of [["A", a], ["B", b], ["C", c]] as const) {
    if (!conn.got.some((f) => f.kind === "idea_voted")) {
      throw new Error(`${label} never received idea_voted`);
    }
  }

  console.log("OK — 3 sockets all received idea_voted");
  a.ws.close(); b.ws.close(); c.ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add `ws` as a devDep**

Run: `cd quorum && npm install --save-dev ws @types/ws`

- [ ] **Step 3: Add a script entry**

Edit `quorum/package.json`:

```json
"smoke": "tsx scripts/multiclient-smoke.ts"
```

- [ ] **Step 4: Manual run**

In one shell: `cd quorum && CLOUDFLARE_ACCOUNT_ID=89a5603e30493fa6a1fd7555c6a86353 npm run dev`

In another:
```bash
cd quorum && npm run smoke
```

Expected (with no cookie): exits 2 with the "set QUORUM_COOKIE" hint, after confirming all three sockets received `hello`. Exit 0 only when an authed cookie is provided.

- [ ] **Step 5: Commit**

```bash
git add quorum/scripts/multiclient-smoke.ts quorum/package.json quorum/package-lock.json
git commit -m "Add multiclient smoke script for live broadcast pipeline"
```

---

## Task 13: Frontend reducer (with tests)

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.js`
- Create: `web/src/reducer.js`
- Create: `web/test/reducer.test.js`

- [ ] **Step 1: Install vitest**

Run: `cd web && npm install --save-dev vitest`

- [ ] **Step 2: Add test script**

Edit `web/package.json` `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Vitest config**

```js
// web/vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
```

- [ ] **Step 4: Write the failing test**

```js
// web/test/reducer.test.js
import { describe, expect, it } from "vitest";
import { initial, reduce } from "../src/reducer.js";

const baseSnapshot = {
  ideas: [
    { uid: "qrm_000001", name: "x", brief: "x", long: "", score: 5, hours: null, stage: "bucket", votes: 0, voted_by_me: false },
  ],
  activity: [],
  presence: [],
  me: { voter_key: "anon:abc", login: null, can_edit: false },
  last_event_id: 0,
};

describe("reducer", () => {
  it("hello replaces all state", () => {
    const s = reduce(initial, { kind: "hello", snapshot: baseSnapshot });
    expect(s.ideas.length).toBe(1);
    expect(s.me.voter_key).toBe("anon:abc");
  });

  it("idea_voted patches votes and voted_by_me when local user voted", () => {
    const s0 = reduce(initial, { kind: "hello", snapshot: { ...baseSnapshot, me: { ...baseSnapshot.me, voter_key: "gh:alice" } } });
    const s1 = reduce(s0, {
      kind: "idea_voted",
      uid: "qrm_000001",
      votes: 1,
      voter_key: "gh:alice",
      voted: true,
      activity: { id: 1, event_kind: "idea_voted", summary: "alice voted qrm_000001", by: { kind: "user", login: "alice", avatar: "" }, ts: 0, target_uid: "qrm_000001" },
    });
    expect(s1.ideas[0].votes).toBe(1);
    expect(s1.ideas[0].voted_by_me).toBe(true);
  });

  it("idea_voted from another user does not flip voted_by_me", () => {
    const s0 = reduce(initial, { kind: "hello", snapshot: { ...baseSnapshot, me: { ...baseSnapshot.me, voter_key: "gh:alice" } } });
    const s1 = reduce(s0, {
      kind: "idea_voted",
      uid: "qrm_000001",
      votes: 1,
      voter_key: "gh:bob",
      voted: true,
      activity: { id: 1, event_kind: "idea_voted", summary: "bob voted qrm_000001", by: { kind: "user", login: "bob", avatar: "" }, ts: 0, target_uid: "qrm_000001" },
    });
    expect(s1.ideas[0].votes).toBe(1);
    expect(s1.ideas[0].voted_by_me).toBe(false);
  });

  it("idea_phase_change drops cards leaving board statuses", () => {
    const s0 = reduce(initial, { kind: "hello", snapshot: baseSnapshot });
    const s1 = reduce(s0, {
      kind: "idea_phase_change",
      uid: "qrm_000001",
      status: "parked",
      activity: { id: 1, event_kind: "idea_phase_change", summary: "Quorum moved qrm_000001 to parked", by: { kind: "agent" }, ts: 0, target_uid: "qrm_000001" },
    });
    expect(s1.ideas.find((i) => i.uid === "qrm_000001")).toBeUndefined();
  });

  it("activity rows append, capped at 50", () => {
    let s = reduce(initial, { kind: "hello", snapshot: baseSnapshot });
    for (let i = 0; i < 60; i++) {
      s = reduce(s, {
        kind: "idea_voted", uid: "qrm_000001", votes: i, voter_key: "gh:bob", voted: true,
        activity: { id: i, event_kind: "idea_voted", summary: `bob voted (${i})`, by: { kind: "user", login: "bob", avatar: "" }, ts: i, target_uid: "qrm_000001" },
      });
    }
    expect(s.activity.length).toBe(50);
    expect(s.activity[0].id).toBe(59); // newest first
  });

  it("presence_join + presence_leave", () => {
    const s0 = reduce(initial, { kind: "hello", snapshot: baseSnapshot });
    const s1 = reduce(s0, { kind: "presence_join", presence: { connection_id: "x", actor: { kind: "user", login: "bob", avatar: "" }, joined_at: 0 } });
    expect(s1.presence.length).toBe(1);
    const s2 = reduce(s1, { kind: "presence_leave", connection_id: "x" });
    expect(s2.presence.length).toBe(0);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd web && npm test`
Expected: FAIL with "Cannot find module '../src/reducer.js'".

- [ ] **Step 6: Implement the reducer**

```js
// web/src/reducer.js
//
// Pure reducer for live-board state. Consumes Wire events and produces
// new { ideas, activity, presence, me } on each call. No side effects.

const BOARD_STAGES = new Set(["bucket", "candidates", "selected"]);
const STATUS_TO_STAGE = {
  ideating: "bucket",
  validating: "candidates",
  planning: "selected",
};

export const initial = {
  ideas: [],
  activity: [],
  presence: [],
  me: { voter_key: "", login: null, can_edit: false },
  last_event_id: 0,
};

function pushActivity(activity, row) {
  // Newest first; cap at 50.
  return [row, ...activity].slice(0, 50);
}

export function reduce(state, ev) {
  switch (ev.kind) {
    case "hello":
      return {
        ideas: ev.snapshot.ideas,
        activity: [...ev.snapshot.activity].reverse(), // server sends chronological → reverse to newest-first
        presence: ev.snapshot.presence,
        me: ev.snapshot.me,
        last_event_id: ev.snapshot.last_event_id,
      };

    case "idea_added":
      return {
        ...state,
        ideas: [...state.ideas, ev.idea],
        activity: pushActivity(state.activity, ev.activity),
      };

    case "idea_voted": {
      const meKey = state.me.voter_key;
      const ideas = state.ideas.map((i) => {
        if (i.uid !== ev.uid) return i;
        return {
          ...i,
          votes: ev.votes,
          voted_by_me: ev.voter_key === meKey ? ev.voted : i.voted_by_me,
        };
      });
      return { ...state, ideas, activity: pushActivity(state.activity, ev.activity) };
    }

    case "idea_edited": {
      const ideas = state.ideas.map((i) =>
        i.uid === ev.uid ? { ...i, ...ev.patch } : i,
      );
      return { ...state, ideas, activity: pushActivity(state.activity, ev.activity) };
    }

    case "idea_phase_change": {
      const stage = STATUS_TO_STAGE[ev.status];
      let ideas;
      if (!stage) {
        // Status moved off-board (parked/killed) — drop the card.
        ideas = state.ideas.filter((i) => i.uid !== ev.uid);
      } else {
        ideas = state.ideas.map((i) =>
          i.uid === ev.uid ? { ...i, stage } : i,
        );
      }
      return { ...state, ideas, activity: pushActivity(state.activity, ev.activity) };
    }

    case "scored": {
      const ideas = state.ideas.map((i) =>
        i.uid === ev.uid ? { ...i, score: ev.score } : i,
      );
      return { ...state, ideas, activity: pushActivity(state.activity, ev.activity) };
    }

    case "constraint_applied":
      return { ...state, activity: pushActivity(state.activity, ev.activity) };

    case "presence_join":
      return {
        ...state,
        presence: [...state.presence.filter((p) => p.connection_id !== ev.presence.connection_id), ev.presence],
      };

    case "presence_leave":
      return {
        ...state,
        presence: state.presence.filter((p) => p.connection_id !== ev.connection_id),
      };

    default:
      return state;
  }
}
```

- [ ] **Step 7: Run tests — verify pass**

Run: `cd web && npm test`
Expected: 6 tests pass.

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.js web/src/reducer.js web/test/reducer.test.js
git commit -m "Add live-board reducer with vitest coverage"
```

---

## Task 14: useLiveBoard hook

**Files:**
- Create: `web/src/useLiveBoard.js`

- [ ] **Step 1: Implement the hook**

```js
// web/src/useLiveBoard.js
//
// React hook that owns the WebSocket lifecycle for the live board.
// Dispatches incoming Wire events to the pure reducer. Exposes
// { ideas, activity, presence, me, connectionState, send }.
//
// Reconnect: exponential backoff with 20% jitter. After >10s offline,
// triggers a one-shot REST refetch via the optional onStaleFallback
// callback so the UI doesn't sit on a stale snapshot.

import { useEffect, useReducer, useRef, useState } from "react";
import { initial, reduce } from "./reducer.js";

const BACKOFF_SCHEDULE = [1000, 2000, 4000, 8000, 15000];
function jittered(ms) {
  const delta = ms * 0.2;
  return ms + Math.floor((Math.random() * 2 - 1) * delta);
}

export function useLiveBoard({ chat, onStaleFallback }) {
  const [state, dispatch] = useReducer(reduce, initial);
  const [connectionState, setConnectionState] = useState("connecting");
  const wsRef = useRef(null);
  const attemptRef = useRef(0);
  const offlineTimerRef = useRef(null);
  const closedByUserRef = useRef(false);

  useEffect(() => {
    closedByUserRef.current = false;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setConnectionState((cur) => (cur === "open" ? "reconnecting" : "connecting"));
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/socket${chat ? `?chat=${encodeURIComponent(chat)}` : ""}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = null;
        }
        setConnectionState("open");
      };

      ws.onmessage = (msg) => {
        try {
          const ev = JSON.parse(msg.data);
          dispatch(ev);
        } catch {
          // Bad frame — ignore.
        }
      };

      ws.onclose = () => {
        if (closedByUserRef.current || cancelled) return;
        setConnectionState("reconnecting");
        const delay = jittered(BACKOFF_SCHEDULE[Math.min(attemptRef.current, BACKOFF_SCHEDULE.length - 1)]);
        attemptRef.current += 1;
        // Schedule the fallback if we stay offline >10s.
        if (!offlineTimerRef.current) {
          offlineTimerRef.current = setTimeout(() => {
            setConnectionState("offline");
            if (onStaleFallback) onStaleFallback();
          }, 10_000);
        }
        setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire too — backoff handles the rest.
      };
    }

    connect();

    return () => {
      cancelled = true;
      closedByUserRef.current = true;
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
      }
    };
  }, [chat, onStaleFallback]);

  return { ...state, connectionState };
}
```

- [ ] **Step 2: Verify the file imports cleanly**

Run: `cd web && npm run build`
Expected: Vite builds without errors. (Hook is unused at this point, but the import graph must resolve.)

If build fails because the hook isn't imported anywhere yet, that's fine — wait until Task 18 wires it up. Otherwise check for syntax errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/useLiveBoard.js
git commit -m "Add useLiveBoard hook with reconnect + stale-fallback"
```

---

## Task 15: ConnectionDot component

**Files:**
- Create: `web/src/components/ConnectionDot.jsx`

- [ ] **Step 1: Implement the component**

```jsx
// web/src/components/ConnectionDot.jsx
import React from "react";

const TITLES = {
  connecting: "Connecting…",
  open: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline — refresh to retry",
};

export function ConnectionDot({ state }) {
  const cls = `conn-dot conn-dot--${state}`;
  return <span className={cls} title={TITLES[state] ?? state} aria-label={TITLES[state] ?? state} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ConnectionDot.jsx
git commit -m "Add ConnectionDot component"
```

---

## Task 16: PresencePile component

**Files:**
- Create: `web/src/components/PresencePile.jsx`

- [ ] **Step 1: Implement the component**

```jsx
// web/src/components/PresencePile.jsx
import React from "react";

const VISIBLE = 5;

function avatarFor(actor) {
  if (actor.kind === "user") {
    return actor.avatar || `https://github.com/${actor.login}.png?size=40`;
  }
  return null; // anon → silhouette via CSS
}

function titleFor(actor) {
  if (actor.kind === "user") return actor.login;
  if (actor.kind === "agent") return "Quorum";
  return "anonymous";
}

export function PresencePile({ presence }) {
  const visible = presence.slice(0, VISIBLE);
  const overflow = Math.max(0, presence.length - VISIBLE);
  return (
    <div className="presence-pile" aria-label={`${presence.length} viewer${presence.length === 1 ? "" : "s"}`}>
      {visible.map((p) => {
        const url = avatarFor(p.actor);
        return (
          <span key={p.connection_id} className="presence-pile__slot" title={titleFor(p.actor)}>
            {url ? <img src={url} alt={titleFor(p.actor)} /> : <span className="presence-pile__anon" />}
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="presence-pile__overflow">+{overflow}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/PresencePile.jsx
git commit -m "Add PresencePile component"
```

---

## Task 17: ActivityRail component

**Files:**
- Create: `web/src/components/ActivityRail.jsx`

- [ ] **Step 1: Implement the component**

```jsx
// web/src/components/ActivityRail.jsx
import React, { useEffect, useRef, useState } from "react";

function formatRelative(ts) {
  const dt = Math.max(0, Date.now() - ts);
  const s = Math.floor(dt / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ActivityRail({ activity }) {
  const scrollRef = useRef(null);
  const [unseen, setUnseen] = useState(0);
  const lastTopRef = useRef(0);

  useEffect(() => {
    // If the user is at the top, keep them pinned. Otherwise show the
    // "N new" pill so they're not yanked.
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop <= 8) {
      el.scrollTop = 0;
      setUnseen(0);
    } else {
      setUnseen((n) => n + 1);
    }
    lastTopRef.current = el.scrollTop;
  }, [activity.length]);

  function jumpToTop() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setUnseen(0);
  }

  return (
    <aside className="rail">
      <header className="rail__header">activity</header>
      {unseen > 0 && (
        <button className="rail__pill" onClick={jumpToTop}>
          {unseen} new ↑
        </button>
      )}
      <div className="rail__scroll" ref={scrollRef}>
        {activity.map((row) => (
          <div key={row.id} className="rail__row">
            <span className="rail__chevron">{">"}</span>
            <span className="rail__summary">{row.summary}</span>
            <span className="rail__ts">{formatRelative(row.ts)}</span>
          </div>
        ))}
        {activity.length === 0 && (
          <div className="rail__empty">no activity yet</div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ActivityRail.jsx
git commit -m "Add ActivityRail component with N-new pill"
```

---

## Task 18: Wire useLiveBoard into App.jsx

**Files:**
- Modify: `web/src/App.jsx`

- [ ] **Step 1: Replace the existing fetch-on-mount logic**

Find the existing `useEffect` that calls `Promise.all([fetchBoard(), fetchMe()])`. Replace it with a `useLiveBoard` call.

```jsx
// near the top of App.jsx imports
import { useLiveBoard } from "./useLiveBoard.js";
import { ConnectionDot } from "./components/ConnectionDot.jsx";
import { PresencePile } from "./components/PresencePile.jsx";
import { ActivityRail } from "./components/ActivityRail.jsx";
import { fetchBoard } from "./api.js";
```

Inside the `App` component, replace the current state/effect block that fetches the board with:

```jsx
  const chat = new URLSearchParams(location.search).get("chat") || "";

  // One-shot REST fallback if the socket goes offline for >10s.
  const handleStale = React.useCallback(() => {
    fetchBoard(chat).then(/* update fallback state if you want */).catch(() => {});
  }, [chat]);

  const { ideas, activity, presence, me, connectionState } = useLiveBoard({
    chat,
    onStaleFallback: handleStale,
  });
```

- [ ] **Step 2: Mount the new components**

Where the header currently renders, add `<ConnectionDot state={connectionState} />` and `<PresencePile presence={presence} />`. Replace the existing board layout container so the rail sits as a third column:

```jsx
return (
  <div className="app app--live">
    <Header total={ideas.length} me={me}>
      <ConnectionDot state={connectionState} />
      <PresencePile presence={presence} />
    </Header>
    <main className="board-with-rail">
      <Board ideas={ideas} me={me} /* existing props */ />
      <ActivityRail activity={activity} />
    </main>
  </div>
);
```

(Adjust to whatever the current `App` returns — the goal is `<Header>...<ConnectionDot/><PresencePile/></Header>` and a `main` containing the existing board + the new rail.)

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build`
Expected: Vite builds clean. No unused-import warnings on the new modules.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.jsx
git commit -m "Wire useLiveBoard, ConnectionDot, PresencePile, ActivityRail into App"
```

---

## Task 19: Layout + component CSS

**Files:**
- Modify: `web/src/styles.css`

- [ ] **Step 1: Append new styles**

Add at the end of `web/src/styles.css`:

```css
/* ── Live board layout ─────────────────────────────────────────── */

.board-with-rail {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 24px;
  align-items: start;
}

@media (max-width: 1100px) {
  .board-with-rail {
    grid-template-columns: 1fr;
  }
  .rail {
    max-height: 280px;
  }
}

/* ── Connection dot ───────────────────────────────────────────── */

.conn-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin: 0 8px;
  vertical-align: middle;
}
.conn-dot--connecting   { background: #cbb35a; }
.conn-dot--open         { background: #6ee36e; }
.conn-dot--reconnecting { background: #cbb35a; animation: dotPulse 1.2s infinite; }
.conn-dot--offline      { background: #d05050; }

@keyframes dotPulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}

/* ── Presence pile ────────────────────────────────────────────── */

.presence-pile {
  display: inline-flex;
  align-items: center;
  margin-left: 12px;
}
.presence-pile__slot {
  display: inline-block;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--bg, #0e0e0e);
  margin-left: -8px;
  overflow: hidden;
  background: #2a2a2a;
}
.presence-pile__slot:first-child { margin-left: 0; }
.presence-pile__slot img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.presence-pile__anon {
  display: block;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #444, #2a2a2a);
}
.presence-pile__overflow {
  margin-left: 6px;
  font-family: var(--mono, "JetBrains Mono", ui-monospace, monospace);
  font-size: 11px;
  color: var(--muted, #888);
}

/* ── Activity rail ────────────────────────────────────────────── */

.rail {
  position: sticky;
  top: 16px;
  border: 1px solid var(--rule, #222);
  background: var(--panel, #111);
  font-family: var(--mono, "JetBrains Mono", ui-monospace, monospace);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 32px);
}
.rail__header {
  padding: 8px 12px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted, #888);
  border-bottom: 1px solid var(--rule, #222);
}
.rail__pill {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: 36px;
  background: var(--accent, #c8ff5a);
  color: #0a0a0a;
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.rail__scroll {
  overflow-y: auto;
  padding: 6px 12px 12px;
}
.rail__row {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
  color: var(--text, #d8d8d8);
  border-bottom: 1px dashed var(--rule, #222);
}
.rail__row:last-child { border-bottom: none; }
.rail__chevron { color: var(--accent, #c8ff5a); }
.rail__summary { word-break: break-word; }
.rail__ts {
  color: var(--muted, #888);
  font-size: 11px;
  white-space: nowrap;
}
.rail__empty {
  padding: 20px 0;
  text-align: center;
  color: var(--muted, #888);
  font-size: 12px;
}
```

- [ ] **Step 2: Verify build**

Run: `cd web && npm run build`
Expected: PASS, CSS bundle slightly larger.

- [ ] **Step 3: Commit**

```bash
git add web/src/styles.css
git commit -m "Style activity rail, presence pile, connection dot"
```

---

## Task 20: Manual demo runbook + deploy

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append the runbook**

Append at the end of `CLAUDE.md`:

```md
## Realtime board demo runbook

Two browsers side-by-side. Both at `https://quorum.joao-f-o-goncalves.workers.dev/?chat=-5224131572`.

1. **Connect** — both windows show a green dot in the header (live). Each shows the other's avatar in the presence pile.
2. **Vote propagation** — Alice clicks thumbs-up on a card. Bob's window shows the count tick + a `> alice voted qrm_…` row on the rail within ~500ms.
3. **Edit propagation** — open a card on Alice's window, change the name, save. Bob's card updates in place.
4. **Agent move** — in the Telegram demo group, fire `/constraint budget down to $5k`. On both windows, cards glide between columns and a `> Quorum reanimated 2, demoted 1 — budget down to $5k` row appears on the rail.
5. **Reconnect** — disable Alice's network for 5s, restore. Header dot cycles green → amber pulsing → green; the snapshot resyncs.

If any step fails, check `wrangler tail` for the `/api/socket` upgrade — the most common failure is the Origin check rejecting an unexpected host.
```

- [ ] **Step 2: Deploy**

```bash
cd quorum && CLOUDFLARE_ACCOUNT_ID=89a5603e30493fa6a1fd7555c6a86353 npm run deploy
```

Expected: deploy completes, prints the version ID.

- [ ] **Step 3: Smoke test on prod**

Open two browser windows at `https://quorum.joao-f-o-goncalves.workers.dev/?chat=-5224131572` and walk through steps 1–5 of the runbook above.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Document realtime board demo runbook"
```

---

## Self-review

**Spec coverage**

| Spec section | Task(s) |
|---|---|
| Goal — live state across browsers | 4–10, 13–18 |
| Non-goals — narration, client→server, replay, multi-region, compression | enforced by absence (no tasks for these) |
| Architecture — Hibernating WS in QuorumAgent | 4, 5 |
| Wire protocol — typed events | 1 |
| `summary` rendered server-side | 2, 3 |
| Cross-package types via relative import | 1 (header comment + import in App.jsx through the hook) |
| Vote scenario | 8 + 13/14 |
| Edit scenario | 9 + 13/14 |
| Agent move via /constraint | 10 + 13/14 |
| Connect / reconnect with snapshot + backoff | 5, 6, 14 |
| Server components — broadcast, hooks, `/socket` | 4, 5 |
| Worker `/api/socket` route + origin check | 6 |
| 50-socket cap | 5 (in DO route) |
| Anon throttle | 11 |
| Frontend reducer + hook | 13, 14 |
| Components: ConnectionDot, PresencePile, ActivityRail | 15, 16, 17 |
| App.jsx integration | 18 |
| Layout shift CSS | 19 |
| `summary` plain text only / no HTML | enforced via reducer + ActivityRail using text content |
| `run_worker_first` covers `/api/socket` | 6 (already matches via `/api/*`) |
| Tests: renderSummary snapshots | 2, 3 |
| Tests: reducer unit | 13 |
| Tests: integration smoke | 12 |
| Manual demo runbook | 20 |

No gaps.

**Placeholder scan**

No "TBD"/"TODO"/"add appropriate error handling"/"similar to Task N" patterns. Where existing-code shape is referenced (e.g. `addIdea` body), the instructions describe the modification by structural anchors ("after the SQL writes", "before the `return`") because the exact bytes of the current function aren't reproducible without re-reading the file at execution time. This is the safest way to express modifications to a 686-line file inside the plan.

**Type consistency**

- `Wire`, `ActorRef`, `Presence`, `ActivityRow`, `SocketAttachment`, `HelloSnapshot` defined in Task 1, used consistently in Tasks 4, 5, 6, 13, 14.
- `broadcast` signature `(event: Wire) => void` defined in Task 4, called identically in Tasks 5, 7, 8, 9, 10.
- `activityRowFromEvent` signature defined in Task 4, used identically in Tasks 5, 7, 8, 9, 10.
- `reduce(state, ev)` and `initial` defined in Task 13, imported identically in Task 14.
- `voter_key` is the single canonical name for the per-user token everywhere (DO, Worker, frontend, wire).
- `connection_id` is the single canonical name for the per-socket id.

Plan is internally consistent.
