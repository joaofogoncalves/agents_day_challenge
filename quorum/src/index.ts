/**
 * Worker entry. Routes HTTP traffic to the right QuorumAgent DO.
 *
 * - POST /webhook    Telegram update intake (signature-checked, then forwarded by chat ID)
 * - GET  /healthz    Liveness ping
 * - GET  /g/<token>  Read-only HTML view (stretch — Rui)
 *
 * The Telegram secret check happens here (at the edge) so invalid
 * traffic never reaches a DO. Once authenticated, the chat ID from
 * the update body keys the DO (one DO per Telegram chat).
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
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

    if (url.pathname.startsWith("/g/")) {
      // Stretch: token-keyed read-only view (Rui).
      return new Response("not implemented", { status: 501 });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
