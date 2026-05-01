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
import { parseDeadline } from "./deadline";

export function createBot(agent: QuorumAgent, token: string): Bot {
  // Let grammy fetch botInfo via getMe() lazily on first request. Hardcoding
  // it previously caused command-matching bugs when the BotFather username
  // didn't match what we'd typed in code. One extra round-trip per DO cold
  // start is a fair price for correctness — and it means a BotFather rename
  // (e.g. @quorom_bot → @quorum_bot) takes effect without a code change.
  const bot = new Bot(token);

  // Auto-add anyone interacting with the bot to the team. Fires before any
  // command/message handler, so `/idea`, `/vote`, raw chatter — all of it
  // counts. Idempotent: noteTelegramMember is INSERT-if-missing.
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (id != null) {
      agent.noteTelegramMember(String(id), ctx.from?.first_name ?? null);
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    const base = agent.bindings.PUBLIC_BASE_URL ?? "https://quorum.joao-f-o-goncalves.workers.dev";
    const boardUrl = `${base}/?chat=${ctx.chat.id}`;
    // /start <name> wins. If no arg and no name yet, fall back to the
    // Telegram group's title so the board has *some* identity without
    // forcing the user to /name. Only nag if we still end up nameless
    // (1:1 DMs have no chat.title).
    const arg = ctx.match.trim();
    if (arg) {
      agent.setBoardName(arg);
    } else if (!agent.getBoardName()) {
      const chatTitle = "title" in ctx.chat ? (ctx.chat.title ?? "").trim() : "";
      if (chatTitle) agent.setBoardName(chatTitle);
    }
    const name = agent.getBoardName();
    const deadline = agent.getDeadline();
    const lines = [fmt.welcome(name), "", "📋 Live board for this chat:", boardUrl];
    if (!name) {
      lines.push("", "What should we call this board? Reply with `/name <something>`.");
    }
    if (!deadline) {
      lines.push(
        "",
        "When are you shipping? Reply with `/deadline <when>` (e.g. `/deadline May 1 2026`).",
      );
    } else {
      lines.push("", `🗓 Deadline: ${deadline}`);
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

  bot.command("deadline", async (ctx) => {
    const text = ctx.match.trim();
    if (!text) {
      const current = agent.getDeadline();
      return ctx.reply(
        current
          ? `Deadline: ${current}\nUse "/deadline <when>" to change it, or "/deadline -" to clear.`
          : `No deadline set. Use "/deadline <when>" (e.g. "/deadline May 1 2026").`,
      );
    }
    if (text === "-" || text === "—") {
      await agent.setDeadline("");
      return ctx.reply("Deadline cleared.");
    }
    const saved = await agent.setDeadline(text);
    const note = parseDeadline(text)
      ? "I'll nudge the chat at T-72h, T-24h, and T-0."
      : "(I couldn't parse a date — I'll keep it on the board, but I won't be able to nudge you.)";
    await ctx.reply(`Deadline set: ${saved ?? text}\n${note}`);
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

  // /brief <id> <text> — replace the one-line description on a card.
  // /long <id> <text> — replace the long description shown in the modal.
  // Both reuse updateIdea so the audit log + board fetch see them the same
  // as a web edit. No editor whitelist on Telegram (the chat is the gate).
  bot.command("brief", async (ctx) => {
    const m = /^(\d+)\s+([\s\S]+)$/.exec(ctx.match.trim());
    if (!m) return ctx.reply("usage: /brief <id> <text>");
    const id = parseInt(m[1] ?? "0", 10);
    const text = m[2]!.trim();
    const out = agent.updateIdea(id, { brief: text }, `tg:${authorOf(ctx)}`);
    await ctx.reply(out ? `#${id} brief updated.` : fmt.notFound(id));
  });

  bot.command("long", async (ctx) => {
    const m = /^(\d+)\s+([\s\S]+)$/.exec(ctx.match.trim());
    if (!m) return ctx.reply("usage: /long <id> <text>");
    const id = parseInt(m[1] ?? "0", 10);
    const text = m[2]!.trim();
    const out = agent.updateIdea(id, { long: text }, `tg:${authorOf(ctx)}`);
    await ctx.reply(out ? `#${id} long description updated.` : fmt.notFound(id));
  });

  bot.command("ideas", async (ctx) => {
    const phase = ctx.match.trim() || undefined;
    const ideas = agent.listIdeas(phase);
    const lines = ideas.map((idea) => ({
      idea,
      score: idea.score_team == null ? null : composite({ team: idea.score_team, resource: idea.score_resource, votes: idea.votes }),
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
        const c = composite({ team: scores.team, resource: scores.resource, votes: scores.votes });
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
      score: idea.score_team == null ? null : composite({ team: idea.score_team, resource: idea.score_resource, votes: idea.votes }),
    }));
    await ctx.reply(fmt.ideasList(lines));
  });

  bot.command("me", async (ctx) => {
    const text = ctx.match.trim();
    if (!text) return ctx.reply("usage: /me <free-text about your skills, role, availability>");
    // Show "typing…" so the chat doesn't go silent during the Workers-AI
    // round-trip (can be several seconds on the 8B fallback). Mirrors /gh.
    await ctx.replyWithChatAction("typing").catch(() => {});
    let skills: string[];
    try {
      skills = await extractSkills(agent.bindings.AI, text);
    } catch (e) {
      return ctx.reply(`Skill extraction failed: ${(e as Error).message}`);
    }
    const userId = authorOf(ctx);
    const displayName = ctx.from?.first_name ?? null;
    agent.setMember(userId, {
      display_name: displayName,
      skills_json: JSON.stringify(skills),
    });
    await ctx.reply(
      skills.length
        ? `Saved skills: [${skills.join(", ")}]`
        : `Saved — but I couldn't pull a clean skill list out of that. Try listing concrete tools/languages (e.g. "/me python, postgres, react").`,
    );
  });

  bot.command("gh", async (ctx) => {
    const raw = ctx.match;
    const handle = parseGithubHandle(raw);
    if (!handle) {
      return ctx.reply(
        `usage: /gh <github-username>  (got: "${(raw ?? "").slice(0, 80)}")`,
      );
    }
    // Immediate ack so the chat doesn't go silent during the GH + LLM round-trips
    // (extractSkills can take several seconds, especially on the 8B fallback).
    await ctx.reply(`Looking up @${handle} on GitHub…`);
    let gh: Awaited<ReturnType<typeof github.profile>> = null;
    try {
      gh = await github.profile(handle, agent.bindings.GITHUB_TOKEN);
    } catch (e) {
      return ctx.reply(`GitHub fetch failed for @${handle}: ${(e as Error).message}`);
    }
    if (!gh) return ctx.reply(`Couldn't reach GitHub for @${handle}.`);
    let skills: string[] = [];
    try {
      skills = await extractSkills(agent.bindings.AI, "", gh.summary);
    } catch (e) {
      return ctx.reply(
        `Got @${handle}'s profile, but skill extraction failed: ${(e as Error).message}`,
      );
    }
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
    if (extracted.constraints?.length) updates.constraints = JSON.stringify(extracted.constraints);
    if (extracted.challenges?.length) updates.challenges = JSON.stringify(extracted.challenges);
    const result = await agent.setContext(updates);
    // Route deadline through setDeadline so it triggers the T-72h/T-24h/T-0
    // schedule wiring, not just a bare context write.
    if (extracted.deadline) await agent.setDeadline(extracted.deadline);
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
    if (!text) {
      return ctx.reply(
        `usage: /constraint <text>  (or "/constraint -" to clear all constraints)`,
      );
    }
    if (text === "-" || text === "—") {
      agent.clearConstraints();
      return ctx.reply("Constraints cleared.");
    }
    await ctx.reply(`Re-validating against: "${text}" …`);
    const out = await agent.reanimate(text);
    const re = out.reanimated.length ? `[${out.reanimated.map((id) => `#${id}`).join(", ")}]` : "[]";
    const dem = out.demoted.length ? `[${out.demoted.map((id) => `#${id}`).join(", ")}]` : "[]";
    await ctx.reply(`Reanimated: ${re}. Demoted: ${dem}. Reason: ${out.reason}`);
  });

  bot.command("validate", async (ctx) => {
    const id = parseInt(ctx.match.trim(), 10);
    if (!Number.isFinite(id)) return ctx.reply("usage: /validate <id>");
    await ctx.reply(`Scoring #${id} …`);
    try {
      const scores = await agent.validateIdea(id);
      const c = composite({ team: scores.team, resource: scores.resource, votes: scores.votes });
      await ctx.reply(`#${id} score: ${(c * 10).toFixed(0)}/10 — ${scores.reason}`);
    } catch (e) {
      await ctx.reply(`#${id} scoring failed: ${(e as Error).message}`);
    }
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
    const messageId = agent.observe(text, authorId, authorName, addressed);

    // Step 2: "yes" reply confirms whatever the bot last proposed to this user.
    if (isAffirmative(text)) {
      const pending = agent.pendingConfirmation(authorId);
      if (pending) {
        agent.clearPendingConfirmation(authorId);
        await executePlan(ctx, agent, pending, authorId);
        agent.markRouted(messageId, { kind: "noop" });
        return;
      }
    }

    if (await tryRegexShortcut(ctx, agent, text, authorId)) {
      agent.markRouted(messageId, { kind: "noop" });
      return;
    }

    if (!addressed) return; // overheard chatter — observe only, leave unrouted.

    // Step 4: addressed → run the LLM router with explicit target/prior split.
    // The target is THIS message; prior context is the recent unrouted history.
    // markRouted at the end stamps this row so the next turn doesn't re-act on it.
    try {
      await ctx.replyWithChatAction("typing").catch(() => {});
      const target = { id: messageId, author_id: authorId, author_name: authorName,
        text, ts: Date.now(), addressed_bot: 1, intent_json: null };
      const prior = agent.priorContext(messageId, 7);
      const decision = await routeIntent(agent.bindings.AI, target, prior, true);
      await dispatchDecision(ctx, agent, decision, authorId);
      agent.markRouted(messageId, decision.plan);
    } catch (e) {
      console.error("router failed:", e);
      // bot.catch will also see this; reply something brief so the chat isn't silent.
      await ctx.reply("hmm, I couldn't think that through. try a slash command? `/help`");
      agent.markRouted(messageId, { kind: "noop" });
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
 *   • the message contains an @quor[u/o]m_bot lookalike (legacy tolerance:
 *     an older deploy used @quorom_bot; canonical is @quorum_bot)
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

  // Tolerant match — the canonical handle is @quorum_bot, but an older deploy
  // used @quorom_bot. Accept either spelling so legacy mentions keep working.
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

    case "validate_idea": {
      // Re-scoring is read-and-update: it spends Neurons and overwrites the
      // current score/reason, but doesn't move the idea between phases. Run
      // directly when the router is confident; otherwise propose-confirm.
      if (confidence >= HIGH_CONFIDENCE) {
        await runValidateIdea(ctx, agent, plan.idea_id);
      } else {
        agent.setPendingConfirmation(authorId, plan);
        await ctx.reply(`Re-score idea #${plan.idea_id}? Reply *yes* — or run \`/validate ${plan.idea_id}\`.`);
      }
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
    case "validate_idea": {
      await runValidateIdea(ctx, agent, plan.idea_id);
      return;
    }
    case "answer_question":
    case "noop":
      // Nothing to do; the proposal was for read-only or no-action.
      await ctx.reply("ok — done.");
      return;
  }
}

/** Shared body of /validate and the validate_idea router arm. */
async function runValidateIdea(ctx: Context, agent: QuorumAgent, ideaId: number): Promise<void> {
  await ctx.reply(`Scoring #${ideaId} …`);
  try {
    const scores = await agent.validateIdea(ideaId);
    const c = composite({ team: scores.team, resource: scores.resource, votes: scores.votes });
    await ctx.reply(`#${ideaId} score: ${(c * 10).toFixed(0)}/10 — ${scores.reason}`);
  } catch (e) {
    await ctx.reply(`#${ideaId} scoring failed: ${(e as Error).message}`);
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
        const c = composite({ team: scores.team, resource: scores.resource, votes: scores.votes });
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
