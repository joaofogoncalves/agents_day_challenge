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
import { routeIntent } from "./router";
import type { ActionPlan } from "./schema";
import { composite } from "./scoring";

export function createBot(agent: QuorumAgent, token: string): Bot {
  // Let grammy fetch botInfo via getMe() lazily on first request.
  // Hardcoding it caused command-matching bugs because @BotFather registered
  // "Quorom_bot" (typo) while we'd typed "quorum_bot". One extra round-trip
  // per DO cold start is a fair price for correctness.
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const base = agent.bindings.PUBLIC_BASE_URL ?? "https://quorum.joao-f-o-goncalves.workers.dev";
    const boardUrl = `${base}/?chat=${ctx.chat.id}`;
    // /start can be called with a name as the argument: `/start <name>`. If
    // supplied, save it. Otherwise use whatever the chat already named the
    // board (might be null for fresh chats).
    const arg = ctx.match.trim();
    if (arg) agent.setBoardName(arg);
    const name = agent.getBoardName();
    const lines = [fmt.welcome(name), "", "📋 Live board for this chat:", boardUrl];
    if (!name) {
      lines.push("", "What should we call this board? Reply with `/name <something>`.");
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  bot.command("name", async (ctx) => {
    const text = ctx.match.trim();
    if (!text) {
      const current = agent.getBoardName();
      return ctx.reply(
        current
          ? `This board is called: ${current}\nUse "/name <new name>" to change it, or "/name -" to clear.`
          : `This board has no name yet. Use "/name <something>" to set one.`,
      );
    }
    if (text === "-" || text === "—") {
      agent.setBoardName("");
      return ctx.reply("Board name cleared.");
    }
    const saved = agent.setBoardName(text);
    await ctx.reply(`Board renamed to: ${saved ?? text}`);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(fmt.help(), { parse_mode: "Markdown" });
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
      score: idea.score_team == null ? null : composite({ team: idea.score_team, resource: idea.score_resource }),
    }));
    await ctx.reply(fmt.ideasList(lines));
  });

  bot.command("vote", async (ctx) => {
    const id = parseInt(ctx.match.trim(), 10);
    if (!Number.isFinite(id)) return ctx.reply("usage: /vote <id>");
    const voterKey = agent.voterKeyForTelegram(authorOf(ctx));
    const result = agent.toggleVote(id, voterKey);
    if (result == null) return ctx.reply(fmt.notFound(id));
    await ctx.reply(fmt.voted(result.votes, result.voted));
  });

  bot.command("promote", async (ctx) => {
    const id = parseInt(ctx.match.trim(), 10);
    if (!Number.isFinite(id)) return ctx.reply("usage: /promote <id>");
    const out = agent.promote(id);
    if (!out) return ctx.reply(fmt.notFound(id));
    // Auto-validate when landing at 'validating' so scores appear immediately.
    if (out.includes("→ validating")) {
      await ctx.reply(out + "\nScoring…");
      try {
        const scores = await agent.validateIdea(id);
        const c = composite({ team: scores.team, resource: scores.resource });
        await ctx.reply(`#${id} score: ${(c * 10).toFixed(0)}/10 — ${scores.reason}`);
      } catch {
        await ctx.reply(`#${id} scoring failed — will retry on /constraint`);
      }
    } else {
      await ctx.reply(out);
    }
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
      score: idea.score_team == null ? null : composite({ team: idea.score_team, resource: idea.score_resource }),
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
    const handle = parseGithubHandle(ctx.match);
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

  // Plain-text handler — runs only for messages grammy didn't route to a
  // command. Pipeline (each step short-circuits if it handled the message):
  //   1. observe (always, free)
  //   2. pending confirmation? "yes" reply to a previous proposal
  //   3. regex shortcuts (+1 #N, kill #N, park #N, promote #N) — free
  //   4. addressed-mode LLM router (mention/reply/DM only)
  //   5. otherwise silent
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;
    const authorId = String(ctx.from?.id ?? "anon");
    const authorName = ctx.from?.first_name ?? null;
    const addressed = isAddressed(ctx);
    agent.observe(text, authorId, authorName, addressed);

    // Step 2: "yes" reply confirms whatever the bot last proposed to this user.
    if (isAffirmative(text)) {
      const pending = agent.pendingConfirmation(authorId);
      if (pending) {
        agent.clearPendingConfirmation(authorId);
        await executePlan(ctx, agent, pending, authorId);
        return;
      }
    }

    if (await tryRegexShortcut(ctx, agent, text, authorId)) return;

    if (!addressed) return; // overheard chatter — observe only.

    // Step 4: addressed → run the LLM router.
    try {
      await ctx.replyWithChatAction("typing").catch(() => {});
      const recent = agent.recentMessages(8);
      const decision = await routeIntent(agent.bindings.AI, recent, true);
      await dispatchDecision(ctx, agent, decision, authorId);
    } catch (e) {
      console.error("router failed:", e);
      // bot.catch will also see this; reply something brief so the chat isn't silent.
      await ctx.reply("hmm, I couldn't think that through. try a slash command? `/help`");
    }
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

/**
 * Accept any of: `octocat`, `@octocat`, `https://github.com/octocat`,
 * `github.com/octocat`, `github.com/octocat/repo`, with or without trailing
 * slash. Returns just the handle, or null if we can't pick one out.
 */
function parseGithubHandle(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = /github\.com\/([A-Za-z0-9-]+)(?:\/.*)?$/i.exec(trimmed);
  if (urlMatch) return urlMatch[1] ?? null;
  const cleaned = trimmed.replace(/^@/, "").split(/[\/\s]/)[0] ?? "";
  return /^[A-Za-z0-9-]+$/.test(cleaned) ? cleaned : null;
}

/**
 * The bot is "addressed" when:
 *   • the chat is private (1:1 DM with the bot)
 *   • the message text contains @<botUsername>
 *   • the message is a direct reply to one of the bot's previous messages
 *   • the message contains an @quor[u/o]m_bot lookalike (typo tolerance —
 *     @BotFather registered "quorom_bot" but users naturally type "quorum_bot")
 *   • the message has any text_mention entity pointing at the bot
 * Anything else is overheard chatter — observed but not acted upon.
 */
function isAddressed(ctx: Context): boolean {
  if (ctx.chat?.type === "private") return true;

  const text = ctx.message?.text ?? "";
  const me = ctx.me;

  // Strict @-mention via username
  if (me?.username && text.toLowerCase().includes(`@${me.username.toLowerCase()}`)) {
    return true;
  }

  // Reply-to-bot
  const replyTo = ctx.message?.reply_to_message?.from;
  if (me?.id && replyTo?.id === me.id) return true;

  // Typo-tolerant match — the BotFather name is "quorom_bot" (one missing u)
  // but the product name is "Quorum" so users will keep typing both. Accept
  // either spelling.
  if (/@quor[uo]m_bot\b/i.test(text)) return true;

  // text_mention entities (used for users without @-username, e.g. by ID)
  const entities = ctx.message?.entities ?? [];
  for (const e of entities) {
    if (
      e.type === "text_mention" &&
      "user" in e &&
      (e as { user?: { id?: number } }).user?.id === me?.id
    ) {
      return true;
    }
  }

  return false;
}

/** Loose match for "yes I confirm" replies that resolve a pending proposal. */
function isAffirmative(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(yes|y|yep|yeah|sim|sí|ok|okay|do it|go|👍|✅)\b\.?$/i.test(t);
}

/**
 * Confidence thresholds. High → execute. Below → propose for confirmation.
 * Constraint changes never auto-execute regardless of confidence — the
 * reanimation cascade is the demo moment, it must be intentional.
 */
const HIGH_CONFIDENCE = 0.75;

async function dispatchDecision(
  ctx: Context,
  agent: QuorumAgent,
  decision: { plan: ActionPlan; confidence: number; blocked?: string },
  authorId: string,
): Promise<void> {
  if (decision.blocked === "injection") {
    // Stay silent. The message is in the observe log if /why ever needs it.
    return;
  }
  const { plan, confidence } = decision;
  switch (plan.kind) {
    case "noop":
      // The bot was addressed but the message didn't have a clear ask.
      // Reply something minimal so the user doesn't think the bot is dead.
      await ctx.reply("got it — noted. (try /help for commands)");
      return;

    case "add_idea": {
      if (confidence >= HIGH_CONFIDENCE) {
        const { id } = agent.addIdea(plan.text, authorId);
        await ctx.reply(fmt.ideaAdded(id, plan.text));
      } else {
        agent.setPendingConfirmation(authorId, plan);
        await ctx.reply(`Should I add this as an idea: "${plan.text}"? Reply *yes* to confirm.`);
      }
      return;
    }

    case "propose_constraint": {
      // Constraints are always proposed, never auto-executed.
      agent.setPendingConfirmation(authorId, plan);
      await ctx.reply(
        `Sounds like a team constraint: "${plan.text}". Want me to re-validate parked/killed ideas? Reply *yes* — or run \`/constraint ${plan.text}\`.`,
      );
      return;
    }

    case "record_member": {
      if (confidence >= HIGH_CONFIDENCE) {
        const skills = await extractSkills(agent.bindings.AI, plan.text);
        const displayName = ctx.from?.first_name ?? null;
        agent.setMember(authorId, {
          display_name: displayName,
          skills_json: JSON.stringify(skills),
        });
        await ctx.reply(`Saved skills for you: [${skills.join(", ")}]`);
      } else {
        agent.setPendingConfirmation(authorId, plan);
        await ctx.reply(`Want me to save your skills from "${plan.text}"? Reply *yes*.`);
      }
      return;
    }

    case "answer_question": {
      const base = agent.bindings.PUBLIC_BASE_URL ?? "https://quorum.joao-f-o-goncalves.workers.dev";
      const boardUrl = ctx.chat ? `${base}/?chat=${ctx.chat.id}` : undefined;
      const answer = await agent.answerQuestion(plan.question, {
        boardUrl,
        chatId: ctx.chat?.id,
        botUsername: ctx.me?.username,
      });
      await ctx.reply(answer);
      return;
    }
  }
}

/**
 * Run a previously-stashed plan after the user replied "yes". Mirrors the
 * high-confidence dispatch arms above.
 */
async function executePlan(
  ctx: Context,
  agent: QuorumAgent,
  plan: ActionPlan,
  authorId: string,
): Promise<void> {
  switch (plan.kind) {
    case "add_idea": {
      const { id } = agent.addIdea(plan.text, authorId);
      await ctx.reply(fmt.ideaAdded(id, plan.text));
      return;
    }
    case "propose_constraint": {
      await ctx.reply(`Re-validating against: "${plan.text}" …`);
      const out = await agent.reanimate(plan.text);
      const re = out.reanimated.length ? `[${out.reanimated.map((id) => `#${id}`).join(", ")}]` : "[]";
      const dem = out.demoted.length ? `[${out.demoted.map((id) => `#${id}`).join(", ")}]` : "[]";
      await ctx.reply(`Reanimated: ${re}. Demoted: ${dem}. Reason: ${out.reason}`);
      return;
    }
    case "record_member": {
      const skills = await extractSkills(agent.bindings.AI, plan.text);
      const displayName = ctx.from?.first_name ?? null;
      agent.setMember(authorId, {
        display_name: displayName,
        skills_json: JSON.stringify(skills),
      });
      await ctx.reply(`Saved skills for you: [${skills.join(", ")}]`);
      return;
    }
    case "answer_question":
    case "noop":
      // Nothing to do; the proposal was for read-only or no-action.
      await ctx.reply("ok — done.");
      return;
  }
}

/**
 * Deterministic shortcuts for high-confidence syntax. No LLM call.
 * Returns true if the message matched and was handled — caller should stop.
 */
async function tryRegexShortcut(
  ctx: Context,
  agent: QuorumAgent,
  text: string,
  authorId: string,
): Promise<boolean> {
  const trimmed = text.trim();

  // +1 #N  /  👍 #N  /  vote #N → upvote (toggle, idempotent per-user)
  const voteMatch = /^(?:\+1|👍|vote)\s+#?(\d+)$/i.exec(trimmed);
  if (voteMatch) {
    const id = parseInt(voteMatch[1] ?? "0", 10);
    const voterKey = agent.voterKeyForTelegram(authorId);
    const result = agent.toggleVote(id, voterKey);
    if (result == null) await ctx.reply(fmt.notFound(id));
    else await ctx.reply(fmt.voted(result.votes, result.voted));
    return true;
  }

  // kill #N
  const killMatch = /^kill\s+#?(\d+)$/i.exec(trimmed);
  if (killMatch) {
    const id = parseInt(killMatch[1] ?? "0", 10);
    const ok = agent.setStatus(id, "killed", "shortcut: 'kill #N'");
    await ctx.reply(ok ? `#${id} killed. Still queryable.` : fmt.notFound(id));
    return true;
  }

  // park #N
  const parkMatch = /^park\s+#?(\d+)$/i.exec(trimmed);
  if (parkMatch) {
    const id = parseInt(parkMatch[1] ?? "0", 10);
    const ok = agent.setStatus(id, "parked", "shortcut: 'park #N'");
    await ctx.reply(ok ? `#${id} parked. Eligible for backflow.` : fmt.notFound(id));
    return true;
  }

  // promote #N
  const promoteMatch = /^promote\s+#?(\d+)$/i.exec(trimmed);
  if (promoteMatch) {
    const id = parseInt(promoteMatch[1] ?? "0", 10);
    const out = agent.promote(id);
    if (!out) { await ctx.reply(fmt.notFound(id)); return true; }
    if (out.includes("→ validating")) {
      await ctx.reply(out + "\nScoring…");
      try {
        const scores = await agent.validateIdea(id);
        const c = composite({ team: scores.team, resource: scores.resource });
        await ctx.reply(`#${id} score: ${(c * 10).toFixed(0)}/10 — ${scores.reason}`);
      } catch {
        await ctx.reply(`#${id} scoring failed — will retry on /constraint`);
      }
    } else {
      await ctx.reply(out);
    }
    return true;
  }

  return false;
}
