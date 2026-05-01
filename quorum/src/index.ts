/**
 * Worker entry. Routes HTTP traffic to the right QuorumAgent DO.
 *
 * - POST /webhook              Telegram update intake (signature-checked, forwarded by chat ID)
 * - GET  /api/board            Board view of one chat's ideas (web/ UI)
 * - PATCH /api/ideas/:uid      Edit name/long on an idea
 * - GET  /healthz              Liveness ping
 *
 * Telegram secret check happens at the edge so invalid traffic never reaches
 * a DO. The chat ID keys the DO (one DO per Telegram chat).
 *
 * The board API targets a single "default" chat, configurable via the
 * DEFAULT_BOARD_CHAT var in wrangler.jsonc, or `?chat=<id>` per request.
 */

import { QuorumAgent } from "./agent";
import {
  csrfSetCookie,
  finishOAuth,
  getCsrfFromCookies,
  isEditor,
  logoutResponse,
  mintCsrfToken,
  readSession,
  startOAuth,
  validateCsrf,
  voterKey,
} from "./auth";

export { QuorumAgent };

type TelegramUpdate = {
  message?: { chat?: { id?: number } };
  edited_message?: { chat?: { id?: number } };
  callback_query?: { message?: { chat?: { id?: number } } };
  channel_post?: { chat?: { id?: number } };
  my_chat_member?: { chat?: { id?: number } };
};

function extractChatId(update: TelegramUpdate): string | null {
  const id =
    update.message?.chat?.id ??
    update.edited_message?.chat?.id ??
    update.callback_query?.message?.chat?.id ??
    update.channel_post?.chat?.id ??
    update.my_chat_member?.chat?.id;
  return id == null ? null : String(id);
}

function corsHeaders(env: Env): Record<string, string> {
  // Same-origin in prod (assets served by this Worker), so CORS only matters
  // for stray third-party calls. Restrict to PUBLIC_BASE_URL when set;
  // fall back to wildcard for local/dev where the origin isn't pinned.
  const origin = env.PUBLIC_BASE_URL ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PATCH, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Dev-Seed-Token, X-Quorum-CSRF",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function corsJson(env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(env),
    },
  });
}

function resolveBoardChat(env: Env, url: URL): string | null {
  const fromQuery = url.searchParams.get("chat");
  if (fromQuery) return fromQuery;
  return env.DEFAULT_BOARD_CHAT ?? null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight for the board API.
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200, headers: corsHeaders(env) });
    }

    // ── Auth (GitHub OAuth) ─────────────────────────────────────────
    if (url.pathname === "/auth/github/start" && request.method === "GET") {
      return startOAuth(request, env);
    }
    if (url.pathname === "/auth/github/callback" && request.method === "GET") {
      return finishOAuth(request, env);
    }
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      if (!validateCsrf(request)) return corsJson(env, { error: "csrf" }, 403);
      return logoutResponse(request);
    }
    if (url.pathname === "/api/me" && request.method === "GET") {
      const session = await readSession(request, env);
      if (!session) return corsJson(env, {});
      // Lazy CSRF backfill: sessions issued before the CSRF rollout don't
      // have a quorum_csrf cookie. Mint one on the first /api/me hit so
      // existing tabs upgrade transparently. Sessions issued by finishOAuth
      // already have a cookie — keep the same value (no rotation per call,
      // which would break multi-tab POSTs).
      let csrfToken = getCsrfFromCookies(request);
      const setCsrf = !csrfToken;
      if (!csrfToken) csrfToken = mintCsrfToken();
      const body = {
        login: session.login,
        avatar_url: session.avatar_url,
        can_vote: session.can_vote,
        can_edit: session.can_edit,
        csrf_token: csrfToken,
      };
      const headers: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders(env),
      };
      const res = new Response(JSON.stringify(body), { status: 200, headers });
      if (setCsrf) {
        res.headers.append("Set-Cookie", csrfSetCookie(csrfToken, url.protocol === "https:"));
      }
      return res;
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      const got = request.headers.get("x-telegram-bot-api-secret-token");
      if (got !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }

      const body = await request.text();
      let update: TelegramUpdate;
      try {
        update = JSON.parse(body);
      } catch {
        return new Response("bad json", { status: 400 });
      }

      const chatId = extractChatId(update);
      if (!chatId) {
        return new Response("no chat id", { status: 200 });
      }
      console.log(`webhook: chat=${chatId}`);

      const id = env.QuorumAgent.idFromName(chatId);
      const stub = env.QuorumAgent.get(id);
      return stub.fetch(
        new Request(new URL("/onUpdate", request.url).toString(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // The DO is keyed by an opaque hash of chatId, not the ID itself.
            // Forward the raw chat ID so the agent can stash it for the
            // stall-nudge cron's out-of-band sendMessage.
            "x-quorum-chat": chatId,
          },
          body,
        }),
      );
    }

    // ── Board API (web/) ─────────────────────────────────────────────

    // Dev-only seed (no-op if data exists). Forwarded to the resolved chat DO.
    // Gated on DEV_SEED_TOKEN — set the secret + send matching X-Dev-Seed-Token
    // header. Unset secret (prod) makes the route invisible (404).
    if (url.pathname === "/api/dev-seed" && request.method === "POST") {
      const expected = env.DEV_SEED_TOKEN;
      const got = request.headers.get("x-dev-seed-token");
      if (!expected || got !== expected) {
        return new Response("not found", { status: 404 });
      }
      const chat = resolveBoardChat(env, url);
      if (!chat) return corsJson(env, { error: "no chat — set DEFAULT_BOARD_CHAT or pass ?chat=<id>" }, 400);
      const id = env.QuorumAgent.idFromName(chat);
      const stub = env.QuorumAgent.get(id);
      return stub.fetch(
        new Request(new URL("/board/dev-seed", request.url).toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: await request.text(),
        }),
      );
    }

    if (url.pathname === "/api/board" && request.method === "GET") {
      const chat = resolveBoardChat(env, url);
      if (!chat) return corsJson(env, { error: "no chat — set DEFAULT_BOARD_CHAT or pass ?chat=<id>" }, 400);
      const session = await readSession(request, env);
      const id = env.QuorumAgent.idFromName(chat);
      const stub = env.QuorumAgent.get(id);
      const headers: Record<string, string> = {};
      if (session) {
        headers["x-quorum-voter"] = voterKey(session.login);
        // Also forward the login so the DO can auto-add this GitHub user
        // to the chat's team — no `/gh` from Telegram required.
        headers["x-quorum-login"] = session.login;
      }
      return stub.fetch(
        new Request(new URL("/board", request.url).toString(), { headers }),
      );
    }

    // DELETE /api/board/constraints — editor-only clear of all constraint rows
    // (both the singular `constraint` and the JSON-array `constraints`).
    if (url.pathname === "/api/board/constraints" && request.method === "DELETE") {
      const session = await readSession(request, env);
      if (!session) return corsJson(env, { error: "unauthorized" }, 401);
      if (!isEditor(session.login, env)) return corsJson(env, { error: "forbidden" }, 403);
      if (!validateCsrf(request)) return corsJson(env, { error: "csrf" }, 403);
      const chat = resolveBoardChat(env, url);
      if (!chat) return corsJson(env, { error: "no chat — set DEFAULT_BOARD_CHAT or pass ?chat=<id>" }, 400);
      const id = env.QuorumAgent.idFromName(chat);
      const stub = env.QuorumAgent.get(id);
      return stub.fetch(
        new Request(new URL("/board/constraints", request.url).toString(), {
          method: "DELETE",
          headers: {
            "x-quorum-voter": voterKey(session.login),
            "x-quorum-login": session.login,
            "x-quorum-editor": "1",
          },
        }),
      );
    }

    // PATCH /api/board — board-level metadata (name, deadline). Editor-gated + CSRF.
    if (url.pathname === "/api/board" && request.method === "PATCH") {
      const session = await readSession(request, env);
      if (!session) return corsJson(env, { error: "unauthorized" }, 401);
      if (!isEditor(session.login, env)) return corsJson(env, { error: "forbidden" }, 403);
      if (!validateCsrf(request)) return corsJson(env, { error: "csrf" }, 403);
      const chat = resolveBoardChat(env, url);
      if (!chat) return corsJson(env, { error: "no chat — set DEFAULT_BOARD_CHAT or pass ?chat=<id>" }, 400);
      const id = env.QuorumAgent.idFromName(chat);
      const stub = env.QuorumAgent.get(id);
      return stub.fetch(
        new Request(new URL("/board", request.url).toString(), {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-quorum-voter": voterKey(session.login),
            "x-quorum-login": session.login,
            "x-quorum-editor": "1",
          },
          body: await request.text(),
        }),
      );
    }

    // POST /api/ideas/<uid>/vote — toggle vote (auth required, any GitHub user).
    if (
      url.pathname.startsWith("/api/ideas/") &&
      url.pathname.endsWith("/vote") &&
      request.method === "POST"
    ) {
      const session = await readSession(request, env);
      if (!session) return corsJson(env, { error: "unauthorized" }, 401);
      if (!validateCsrf(request)) return corsJson(env, { error: "csrf" }, 403);
      const uid = decodeURIComponent(
        url.pathname.slice("/api/ideas/".length, -"/vote".length),
      );
      const chat = resolveBoardChat(env, url);
      if (!chat) return corsJson(env, { error: "no chat — set DEFAULT_BOARD_CHAT or pass ?chat=<id>" }, 400);
      const id = env.QuorumAgent.idFromName(chat);
      const stub = env.QuorumAgent.get(id);
      return stub.fetch(
        new Request(
          new URL(`/board/ideas/${encodeURIComponent(uid)}/vote`, request.url).toString(),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-quorum-voter": voterKey(session.login),
              "x-quorum-login": session.login,
            },
          },
        ),
      );
    }

    if (url.pathname.startsWith("/api/ideas/") && request.method === "PATCH") {
      const session = await readSession(request, env);
      if (!session) return corsJson(env, { error: "unauthorized" }, 401);
      if (!isEditor(session.login, env)) return corsJson(env, { error: "forbidden" }, 403);
      if (!validateCsrf(request)) return corsJson(env, { error: "csrf" }, 403);
      const uid = decodeURIComponent(url.pathname.slice("/api/ideas/".length));
      const chat = resolveBoardChat(env, url);
      if (!chat) return corsJson(env, { error: "no chat — set DEFAULT_BOARD_CHAT or pass ?chat=<id>" }, 400);
      const id = env.QuorumAgent.idFromName(chat);
      const stub = env.QuorumAgent.get(id);
      return stub.fetch(
        new Request(new URL(`/board/ideas/${encodeURIComponent(uid)}`, request.url).toString(), {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-quorum-voter": voterKey(session.login),
            "x-quorum-login": session.login,
            "x-quorum-editor": "1",
          },
          body: await request.text(),
        }),
      );
    }

    if (url.pathname.startsWith("/g/")) {
      // Stretch: token-keyed read-only HTML view (Rui).
      return new Response("not implemented", { status: 501 });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
