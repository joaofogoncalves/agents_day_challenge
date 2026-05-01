/**
 * Workers AI wrapper. Path A: Llama 3.3 70B default,
 * Llama 3.1 8B fallback. No Anthropic dependency — keeps the
 * stack 100% on Cloudflare and stays inside the free 10K Neurons/day
 * tier for the demo.
 *
 * If 70B times out / hits Neuron quota, we transparently fall through
 * to 8B. Caller never sees the model swap.
 */

const PRIMARY = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK = "@cf/meta/llama-3.1-8b-instruct-fast";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompleteOpts = {
  /** Force JSON output. The system prompt should already say "respond with JSON only". */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
};

export async function complete(
  ai: Ai,
  messages: ChatMessage[],
  opts: CompleteOpts = {},
): Promise<string> {
  const params: AiTextGenerationInput = {
    messages,
    max_tokens: opts.maxTokens ?? 512,
    temperature: opts.temperature ?? 0.2,
  };

  const errors: unknown[] = [];
  for (const model of [PRIMARY, FALLBACK] as const) {
    try {
      const res = (await ai.run(model, params)) as { response?: string };
      if (res?.response) return res.response;
      errors.push(new Error(`empty response from ${model}`));
    } catch (e) {
      errors.push(e);
    }
  }
  throw new AggregateError(errors, "all LLM models failed");
}

/**
 * Split a prompt template on SYSTEM: / USER: markers and substitute
 * {{name}} placeholders in the user portion.
 * The system portion is taken verbatim — no placeholder substitution.
 */
export function loadPrompt(
  template: string,
  vars: Record<string, string>,
): { system: string; user: string } {
  const sysIdx = template.indexOf("SYSTEM:");
  const userIdx = template.indexOf("USER:");
  if (sysIdx === -1 || userIdx === -1 || userIdx < sysIdx) {
    throw new Error("prompt missing SYSTEM:/USER: markers");
  }
  const system = template.slice(sysIdx + "SYSTEM:".length, userIdx).trim();
  const userTemplate = template.slice(userIdx + "USER:".length).trim();
  const user = userTemplate.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? "");
  return { system, user };
}

/** Safe JSON parse for LLM output. Strips ```json fences if present. */
export function parseJson<T>(raw: string): T | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
