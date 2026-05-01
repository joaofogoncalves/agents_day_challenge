/**
 * Workers AI wrapper. Path A: Llama 3.3 70B default,
 * Llama 3.1 8B fallback. No Anthropic dependency — keeps the
 * stack 100% on Cloudflare and stays inside the free 10K Neurons/day
 * tier for the demo.
 *
 * If 70B times out / hits Neuron quota, we transparently fall through
 * to 8B. Caller never sees the model swap.
 *
 * Two call shapes:
 *   - `complete(ai, messages, opts) → string` for plain text generation
 *   - `completeWithTools(ai, messages, tools, opts) → ToolResult` for
 *     OpenAI-compatible tool calling (the router uses this).
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
  /** Override the model chain. First entry is primary, rest are fallbacks. */
  models?: readonly string[];
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string; enum?: string[] }>;
      required?: string[];
    };
  };
};

export type ToolResult = {
  text?: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
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
  for (const model of opts.models ?? ([PRIMARY, FALLBACK] as const)) {
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
 * Tool-calling completion. Used by the intent router. Defaults to the 8B
 * model first because routing is a small structured task and 8B is roughly
 * 3× cheaper per call.
 */
export async function completeWithTools(
  ai: Ai,
  messages: ChatMessage[],
  tools: Tool[],
  opts: CompleteOpts = {},
): Promise<ToolResult> {
  const params = {
    messages,
    tools,
    max_tokens: opts.maxTokens ?? 256,
    temperature: opts.temperature ?? 0.1,
  } as unknown as AiTextGenerationInput;

  const chain = opts.models ?? ([FALLBACK, PRIMARY] as const);
  const errors: unknown[] = [];
  for (const model of chain) {
    try {
      const res = (await ai.run(model, params)) as {
        response?: string;
        tool_calls?: Array<{
          type?: string;
          name?: string;
          arguments?: unknown;
          function?: { name?: string; arguments?: unknown };
        }>;
      };
      const calls: ToolResult["toolCalls"] = [];
      for (const tc of res.tool_calls ?? []) {
        // Workers AI has been observed returning tool calls in two shapes:
        //   { name, arguments }  and  { function: { name, arguments } }
        const name = tc.function?.name ?? tc.name;
        const rawArgs = tc.function?.arguments ?? tc.arguments;
        if (!name) continue;
        let args: Record<string, unknown> = {};
        if (typeof rawArgs === "string") {
          try {
            args = JSON.parse(rawArgs) as Record<string, unknown>;
          } catch {
            args = {};
          }
        } else if (rawArgs && typeof rawArgs === "object") {
          args = rawArgs as Record<string, unknown>;
        }
        calls.push({ name, args });
      }
      return { text: res.response, toolCalls: calls };
    } catch (e) {
      errors.push(e);
    }
  }
  throw new AggregateError(errors, "all tool-calling models failed");
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

/**
 * Safe JSON parse for LLM output.
 * 1. Strips leading/trailing ```json fences (common Llama output).
 * 2. Falls back to extracting the first `{…}` block in case the model
 *    prepended a stray word or whitespace before the JSON.
 */
export function parseJson<T>(raw: string): T | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
