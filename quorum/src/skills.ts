/**
 * Skill extraction. Given /me text and (optionally) a GitHub profile summary,
 * return a deduplicated, canonicalized skill list.
 *
 * The prompt template lives in prompts/skill.md and is imported as a string at
 * build time (see Wrangler "Text" rule in wrangler.jsonc). The file uses two
 * markers — SYSTEM: and USER: — splitting it into the system message and a
 * user template with {{placeholders}}.
 *
 * llm.complete() already handles 70B → 8B model fallback internally. Here we
 * add a single JSON-shape retry on top of that, then post-process to
 * canonicalize common aliases, drop garbage, dedupe, and sort.
 */

import promptTemplate from "../prompts/skill.md";
import { complete, loadPrompt, parseJson, type ChatMessage } from "./llm";

/**
 * Common skill-name variants the model occasionally produces despite the
 * "use the most common form" rule. Applied after parse — cheaper than a
 * re-prompt. Add entries as dogfooding surfaces them.
 */
const CANON: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  k8s: "kubernetes",
  psql: "postgres",
  postgresql: "postgres",
  py: "python",
  tf: "terraform",
  nodejs: "node.js",
  node: "node.js",
};

const MAX_SKILLS = 20;

export async function extractSkills(
  ai: Ai,
  meText: string,
  ghSummary?: string,
): Promise<string[]> {
  const { system, user } = loadPrompt(promptTemplate, {
    me_text: meText.trim(),
    gh_summary: (ghSummary ?? "(none)").trim(),
  });
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await complete(ai, messages, {
      json: true,
      temperature: 0,
      maxTokens: 256,
    });
    const parsed = parseJson<{ skills: unknown }>(raw);
    if (parsed && Array.isArray(parsed.skills)) {
      return postProcess(parsed.skills);
    }
  }
  return [];
}

function postProcess(skills: unknown[]): string[] {
  const cleaned = new Set<string>();
  for (const raw of skills) {
    if (typeof raw !== "string") continue;
    const lower = raw.trim().toLowerCase();
    if (!lower) continue;
    const canon = CANON[lower] ?? lower;
    if (canon.length > 30) continue;
    if (canon.split(/\s+/).length > 3) continue;
    cleaned.add(canon);
  }
  return [...cleaned].sort().slice(0, MAX_SKILLS);
}
