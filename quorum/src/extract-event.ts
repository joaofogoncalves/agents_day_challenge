/**
 * Event page extraction. Given raw HTML/markdown from a hackathon page,
 * returns structured deadline, challenges, and constraints.
 *
 * The prompt template lives in prompts/event.md (SYSTEM:/USER: format).
 * Wrangler Text rule imports it as a string at build time.
 */

import promptTemplate from "../prompts/event.md";
import { complete, loadPrompt, parseJson, type ChatMessage } from "./llm";

export type Challenge = {
  name: string;
  prize?: string;
  requirements?: string;
};

export type EventInfo = {
  deadline?: string;
  challenges?: Challenge[];
  constraints?: string[];
};

/** Max HTML chars forwarded to the LLM (keeps token usage bounded). */
const MAX_INPUT_CHARS = 16_000;

export async function extractEvent(ai: Ai, html: string): Promise<EventInfo> {
  const { system, user } = loadPrompt(promptTemplate, {
    event_markdown: html.slice(0, MAX_INPUT_CHARS).trim(),
  });
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await complete(ai, messages, { json: true, maxTokens: 600 });
    const parsed = parseJson<EventInfo>(raw);
    if (parsed && typeof parsed === "object") {
      return normalise(parsed);
    }
  }
  return {};
}

function normalise(raw: EventInfo): EventInfo {
  const out: EventInfo = {};

  if (raw.deadline && typeof raw.deadline === "string" && raw.deadline !== "null") {
    out.deadline = raw.deadline;
  }

  if (Array.isArray(raw.challenges) && raw.challenges.length > 0) {
    out.challenges = raw.challenges
      .filter((c): c is Challenge => !!c && typeof c.name === "string" && c.name.length > 0)
      .map((c) => ({
        name: c.name,
        ...(c.prize ? { prize: c.prize } : {}),
        ...(c.requirements ? { requirements: c.requirements } : {}),
      }));
  }

  if (Array.isArray(raw.constraints) && raw.constraints.length > 0) {
    out.constraints = raw.constraints.filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
  }

  return out;
}
