/**
 * grammY wiring. Builds a Bot instance bound to a QuorumAgent and
 * registers all command handlers.
 *
 * Webhook signature is checked at the Worker edge (src/index.ts) — by
 * the time we get here, the update is trusted. We still escape user
 * payloads when they hit prompts (LLM injection defense).
 *
 * Bot init: we set botInfo manually so handleUpdate doesn't make a
 * blocking getMe() call on every cold start.
 */

import { Bot, type Context } from "grammy";
import type { QuorumAgent } from "./agent";
import * as fmt from "./format";

export function createBot(agent: QuorumAgent, token: string): Bot {
  const bot = new Bot(token, {
    botInfo: {
      id: 0,
      is_bot: true,
      first_name: "Quorum",
      username: "quorum_bot",
      can_join_groups: true,
      can_read_all_group_messages: true,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      can_manage_bots: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    },
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(fmt.help());
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(fmt.help());
  });

  bot.command("idea", async (ctx) => {
    const text = ctx.match.trim();
    if (!text) return ctx.reply("usage: /idea <text>");
    const author = authorOf(ctx);
    const { id } = agent.addIdea(text, author);
    await ctx.reply(fmt.ideaAdded(id, text));
  });

  bot.command("ideas", async (ctx) => {
    const phase = ctx.match.trim() || undefined;
    const ideas = agent.listIdeas(phase);
    const lines = ideas.map((idea) => ({
      idea,
      score: idea.score_team == null ? null : idea.score_team,
    }));
    await ctx.reply(fmt.ideasList(lines));
  });

  bot.command("vote", async (ctx) => {
    const id = parseInt(ctx.match.trim(), 10);
    if (!Number.isFinite(id)) return ctx.reply("usage: /vote <id>");
    const result = agent.voteIdea(id, authorOf(ctx));
    if (result == null) return ctx.reply(fmt.notFound(id));
    await ctx.reply(fmt.voted(result.votes));
  });

  bot.command("promote", async (ctx) => {
    const id = parseInt(ctx.match.trim(), 10);
    if (!Number.isFinite(id)) return ctx.reply("usage: /promote <id>");
    const out = agent.promote(id);
    await ctx.reply(out ?? fmt.notFound(id));
  });

  bot.command("park", async (ctx) => {
    const id = parseInt(ctx.match.trim(), 10);
    if (!Number.isFinite(id)) return ctx.reply("usage: /park <id>");
    const ok = agent.setStatus(id, "parked", "manual /park");
    await ctx.reply(ok ? `#${id} parked. Eligible for backflow.` : fmt.notFound(id));
  });

  bot.command("kill", async (ctx) => {
    const id = parseInt(ctx.match.trim(), 10);
    if (!Number.isFinite(id)) return ctx.reply("usage: /kill <id>");
    const ok = agent.setStatus(id, "killed", "manual /kill");
    await ctx.reply(ok ? `#${id} killed. Still queryable.` : fmt.notFound(id));
  });

  bot.command("why", async (ctx) => {
    const id = parseInt(ctx.match.trim(), 10);
    if (!Number.isFinite(id)) return ctx.reply("usage: /why <id>");
    const out = agent.why(id);
    await ctx.reply(out ?? fmt.notFound(id));
  });

  bot.command("rank", async (ctx) => {
    const ideas = agent.rank(3);
    const lines = ideas.map((idea) => ({
      idea,
      score: idea.score_team == null ? null : idea.score_team,
    }));
    await ctx.reply(fmt.ideasList(lines));
  });

  // Stubs — wired up at H+5..H+7 by Twody7 / Rui / João pairs.
  bot.command("me", async (ctx) => ctx.reply("/me — skills extraction wired at H+5."));
  bot.command("gh", async (ctx) => ctx.reply("/gh — github skills wired at H+5."));
  bot.command("team", async (ctx) => ctx.reply("/team — aggregate wired at H+5."));
  bot.command("forget", async (ctx) => ctx.reply("/forget — wiped (stub)."));
  bot.command("event", async (ctx) => ctx.reply("/event — scrape wired at H+3."));
  bot.command("constraint", async (ctx) => ctx.reply("/constraint — backflow wired at H+7."));
  bot.command("plan", async (ctx) => ctx.reply("/plan — generation wired at H+7."));

  // H+1 DoD: bot echoes any non-command message in our test group.
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    await ctx.reply(`echo: ${ctx.message.text}`);
  });

  return bot;
}

function authorOf(ctx: Context): string {
  return String(ctx.from?.id ?? "anon");
}
