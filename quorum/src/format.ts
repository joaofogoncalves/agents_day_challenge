/**
 * Reply-text formatting. Owned by Rui — all reply text from command
 * handlers passes through these helpers before sendMessage so escaping
 * and visual style stay consistent.
 *
 * Telegram MarkdownV2 requires escaping these chars: _ * [ ] ( ) ~ ` >
 * # + - = | { } . !
 *
 * For the H+1 echo, plain text is fine. Rui upgrades the renderers
 * (status badges, score breakdowns, audit trails) at H+2/H+6.
 */

import type { Idea } from "./schema";

const MDV2_RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMdV2(s: string): string {
  return s.replace(MDV2_RESERVED, "\\$&");
}

export function ideaLine(idea: Idea, score?: number | null): string {
  const head = `#${idea.id}`;
  const sc = score == null ? "" : ` ${score.toFixed(2)}`;
  return `${head}${sc} ${idea.text} [${idea.status}]`;
}

export function ideasList(ideas: Array<{ idea: Idea; score: number | null }>): string {
  if (ideas.length === 0) return "No ideas yet. Try `/idea <text>`.";
  return ideas.map(({ idea, score }) => ideaLine(idea, score)).join("\n");
}

export function ideaAdded(id: number, text: string): string {
  return `Idea #${id} added — "${text}"`;
}

export function voted(votes: number): string {
  return `Voted. Total: ${votes}`;
}

export function notFound(id: number): string {
  return `Idea #${id} not found.`;
}

/** Conversational welcome — what /start posts. No command catalog. */
export function welcome(): string {
  return [
    "Hi 👋 I'm Quorum. I sit in your chat and help your team converge on *what to build*.",
    "",
    "Just talk to me. Tag me (`@`-mention or reply) and say things like:",
    "  • *what if we built X?* — I'll add it as an idea",
    "  • *we just lost our backend lead* — I'll re-validate everything",
    "  • *what's our top idea right now?* — I'll tell you, with the score",
    "  • *I'm a backend engineer, 8 years Python* — I'll save your skills",
    "",
    "Quick votes work without tagging me: `+1 #3`, `kill #2`, `park #5`, `promote #1`.",
    "",
    "I'm also tracking the conversation silently so I can answer *why* later.",
    "",
    "If you want the full command list, run `/help`.",
  ].join("\n");
}

/** Full command reference — what /help posts. */
export function help(): string {
  return [
    "*Quorum — full command list*",
    "",
    "_Ideation_",
    "  /idea <text> — add an idea",
    "  /ideas [phase] — list ideas (optional filter)",
    "  /vote <id> — +1 an idea",
    "  /rank — top 3 active ideas",
    "",
    "_Phase moves_",
    "  /promote <id> — move forward in the pipeline",
    "  /park <id> — set aside (eligible for backflow)",
    "  /kill <id> — drop (still queryable)",
    "",
    "_Context_",
    "  /event <url> — pull deadline & challenges from a page",
    "  /constraint <text> — re-validate against a new constraint",
    "",
    "_Team_",
    "  /me <text> — record your skills/availability",
    "  /gh <handle> — pull skills from GitHub",
    "  /team — aggregate skills across the team",
    "  /forget — wipe your member record",
    "",
    "_Insight_",
    "  /why <id> — full audit trail for an idea",
    "  /plan <id> — generate a plan: milestones, risks, owners",
    "",
    "_Meta_",
    "  /board — link to this chat's board UI",
    "  /whoami — show chat + user id (debug)",
    "",
    "Or just talk to me by tagging me — I'll figure out what you mean.",
  ].join("\n");
}
