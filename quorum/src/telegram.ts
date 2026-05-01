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
import { extractSkills } from "./skills";
import { extractEvent } from "./extract-event";
import * as github from "./github";

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
    const base = agent.bindings.PUBLIC_BASE_URL ?? "https://quorum.joao-f-o-goncalves.workers.dev";
    const boardUrl = `${base}/?chat=${ctx.chat.id}`;
    await ctx.reply(`${fmt.help()}\n\n📋 Board for this chat:\n${boardUrl}`);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(fmt.help());
  });

  bot.command("board", async (ctx) => {
    const base = agent.bindings.PUBLIC_BASE_URL ?? "https://quorum.joao-f-o-goncalves.workers.dev";
    await ctx.reply(`${base}/?chat=${ctx.chat.id}`);
  });

  bot.command("whoami", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from?.id ?? "?";
    await ctx.reply(`chat=${chatId} user=${userId}`);
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

  bot.command("me", async (ctx) => {
    const text = ctx.match.trim();
    if (!text) return ctx.reply("usage: /me <free-text about your skills, role, availability>");
    const skills = await extractSkills(agent.bindings.AI, text);
    const userId = authorOf(ctx);
    const displayName = ctx.from?.first_name ?? null;
    agent.setMember(userId, {
      display_name: displayName,
      skills_json: JSON.stringify(skills),
    });
    await ctx.reply(`Saved skills: [${skills.join(", ")}]`);
  });

  bot.command("gh", async (ctx) => {
    const handle = ctx.match.trim().replace(/^@/, "");
    if (!handle) return ctx.reply("usage: /gh <github-username>");
    const gh = await github.profile(handle, agent.bindings.GITHUB_TOKEN);
    if (!gh) return ctx.reply(`Couldn't reach GitHub for @${handle}.`);
    const skills = await extractSkills(agent.bindings.AI, "", gh.summary);
    const userId = authorOf(ctx);
    const displayName = ctx.from?.first_name ?? null;
    agent.setMember(userId, {
      display_name: displayName,
      gh_user: handle,
      skills_json: JSON.stringify(skills),
    });
    await ctx.reply(`@${handle} → skills: [${skills.join(", ")}]`);
  });

  bot.command("team", async (ctx) => {
    const summary = agent.teamSummary();
    const strong = summary.strong.length ? summary.strong.join(", ") : "—";
    const gaps = summary.gaps.length ? summary.gaps.join(", ") : "—";
    await ctx.reply(`Strong: [${strong}]. Gaps: [${gaps}]. Members: ${summary.members}.`);
  });

  bot.command("forget", async (ctx) => {
    agent.forgetMember(authorOf(ctx));
    await ctx.reply("Wiped.");
  });

  bot.command("event", async (ctx) => {
    const url = ctx.match.trim();
    if (!url || !/^https?:\/\//.test(url)) return ctx.reply("usage: /event <url>");
    await ctx.reply(`Fetching ${url} …`);
    let body: string;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "Quorum/0.1 (+https://quorum.joao-f-o-goncalves.workers.dev)" },
      });
      if (!res.ok) return ctx.reply(`Fetch failed: ${res.status}`);
      body = await res.text();
    } catch (e) {
      return ctx.reply(`Fetch error: ${(e as Error).message}`);
    }
    const extracted = await extractEvent(agent.bindings.AI, body.slice(0, 16000));
    const updates: Record<string, string> = { event_url: url };
    if (extracted.deadline) updates.deadline = extracted.deadline;
    if (extracted.constraints?.length) updates.constraints = JSON.stringify(extracted.constraints);
    if (extracted.challenges?.length) updates.challenges = JSON.stringify(extracted.challenges);
    const result = await agent.setContext(updates);
    const summary = [
      extracted.deadline ? `deadline=${extracted.deadline}` : null,
      extracted.constraints?.length ? `constraints=${extracted.constraints.length}` : null,
      extracted.challenges?.length ? `challenges=${extracted.challenges.length}` : null,
    ]
      .filter(Boolean)
      .join(", ") || "(no fields extracted)";
    await ctx.reply(`Context set: ${summary}. Recomputed ${result.recomputed} ideas.`);
  });

  bot.command("constraint", async (ctx) => {
    const text = ctx.match.trim();
    if (!text) return ctx.reply("usage: /constraint <text>");
    await ctx.reply(`Re-validating against: "${text}" …`);
    const out = await agent.reanimate(text);
    const re = out.reanimated.length ? `[${out.reanimated.map((id) => `#${id}`).join(", ")}]` : "[]";
    const dem = out.demoted.length ? `[${out.demoted.map((id) => `#${id}`).join(", ")}]` : "[]";
    await ctx.reply(`Reanimated: ${re}. Demoted: ${dem}. Reason: ${out.reason}`);
  });

  bot.command("plan", async (ctx) => {
    const id = parseInt(ctx.match.trim(), 10);
    if (!Number.isFinite(id)) return ctx.reply("usage: /plan <id>");
    await ctx.reply(`Drafting a plan for #${id} …`);
    const md = await agent.planFor(id);
    await ctx.reply(md);
  });

  // H+1 DoD: bot echoes any non-command message in our test group.
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    await ctx.reply(`echo: ${ctx.message.text}`);
  });

  // Surface command errors back to the chat so silent failures stop happening.
  bot.catch(async (err) => {
    const chatId = err.ctx.chat?.id;
    const cmd = err.ctx.message?.text ?? "(non-message)";
    const message = err.error instanceof Error ? err.error.message : String(err.error);
    console.error(`bot error in chat=${chatId} cmd=${cmd}: ${message}`);
    try {
      await err.ctx.reply(`⚠️ command failed: ${message.slice(0, 200)}`);
    } catch {
      /* swallow — original chat may be gone */
    }
  });

  return bot;
}

function authorOf(ctx: Context): string {
  return String(ctx.from?.id ?? "anon");
}
