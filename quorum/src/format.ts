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

export function help(): string {
  return [
    "Quorum — converge on what to build.",
    "",
    "Ideation: /idea /ideas /vote /promote /park /kill",
    "Context:  /event <url> /constraint <text>",
    "Team:     /me <text> /gh <user> /team /forget",
    "Insight:  /why <id> /rank /plan <id>",
  ].join("\n");
}
