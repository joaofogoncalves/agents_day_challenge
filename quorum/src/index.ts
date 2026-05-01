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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
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
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200, headers: CORS_HEADERS });
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

      const id = env.QuorumAgent.idFromName(chatId);
      const stub = env.QuorumAgent.get(id);
      return stub.fetch(
        new Request(new URL("/onUpdate", request.url).toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      );
    }

    // ── Board API (web/) ─────────────────────────────────────────────

    if (url.pathname === "/api/board" && request.method === "GET") {
      const chat = resolveBoardChat(env, url);
      if (!chat) return corsJson({ error: "no chat — set DEFAULT_BOARD_CHAT or pass ?chat=<id>" }, 400);
      const id = env.QuorumAgent.idFromName(chat);
      const stub = env.QuorumAgent.get(id);
      return stub.fetch(new Request(new URL("/board", request.url).toString()));
    }

    if (url.pathname.startsWith("/api/ideas/") && request.method === "PATCH") {
      const uid = decodeURIComponent(url.pathname.slice("/api/ideas/".length));
      const chat = resolveBoardChat(env, url);
      if (!chat) return corsJson({ error: "no chat — set DEFAULT_BOARD_CHAT or pass ?chat=<id>" }, 400);
      const id = env.QuorumAgent.idFromName(chat);
      const stub = env.QuorumAgent.get(id);
      return stub.fetch(
        new Request(new URL(`/board/ideas/${encodeURIComponent(uid)}`, request.url).toString(), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
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
