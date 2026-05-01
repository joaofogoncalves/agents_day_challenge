/**
 * Intent router. Reads recent chat, calls Workers AI with a fixed tool
 * surface, returns a structured ActionPlan that the caller dispatches.
 *
 * The LLM never executes anything — it only chooses which tool to "call",
 * and the dispatcher in src/telegram.ts decides whether to act, propose,
 * or stay silent based on the confidence band.
 *
 * Cost discipline: 8B model first (cheap), 70B as fallback. Mention-gating
 * happens in the caller — we only get invoked when worth spending Neurons.
 */

import { completeWithTools, loadPrompt, type ChatMessage, type Tool } from "./llm";
import type { Message, ActionPlan } from "./schema";
import routerPrompt from "../prompts/router.md";

/**
 * Anything matching this pattern is almost certainly a prompt-injection
 * attempt. We call `noop` without spending a Neuron.
 */
const INJECTION_PATTERNS = [
  /ignore (?:all )?previous/i,
  /\bsystem:/i,
  /you are now/i,
  /disregard .* instruction/i,
  /jailbreak/i,
];

const ROUTER_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "add_idea",
      description:
        "Record a new idea the team should consider. Only when the message is a concrete proposal addressed to the bot.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Concise restatement of the idea, max 200 chars." },
          confidence: { type: "number", description: "0..1; <0.75 means propose, don't execute." },
        },
        required: ["text", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_constraint",
      description:
        "Surface a team-capacity / deadline / budget change. The caller will ask the user to confirm before re-validating.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The constraint as a single sentence." },
          confidence: { type: "number", description: "0..1." },
        },
        required: ["text", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "answer_question",
      description: "Answer a read-only question about the team's ideas, scores, or audit trail.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The user's question, restated." },
          confidence: { type: "number", description: "0..1." },
        },
        required: ["question", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_member",
      description: "Capture a member's stated skills or availability.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The free-form self-description." },
          confidence: { type: "number", description: "0..1." },
        },
        required: ["text", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_idea",
      description:
        "Re-run scoring on a specific idea by numeric id. Use when the user explicitly asks to validate, score, re-score, or revalidate an idea — e.g. 'validate #3', 'rescore idea 7', 'check fit on #2'.",
      parameters: {
        type: "object",
        properties: {
          idea_id: { type: "number", description: "The integer idea id (e.g. 3 for '#3')." },
          confidence: { type: "number", description: "0..1." },
        },
        required: ["idea_id", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "noop",
      description: "Default. The message doesn't warrant action — small talk, off-topic, ambiguous, or unsafe.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export type RouterDecision = {
  plan: ActionPlan;
  confidence: number;
  /** Set when we short-circuited the LLM (e.g. injection guard). */
  blocked?: "injection";
};

export async function routeIntent(
  ai: Ai,
  target: Message,
  priorContext: Message[],
  addressed: boolean,
): Promise<RouterDecision> {
  if (INJECTION_PATTERNS.some((re) => re.test(target.text))) {
    return { plan: { kind: "noop" }, confidence: 0, blocked: "injection" };
  }

  const renderLine = (m: Message) => {
    const who = m.author_name ?? m.author_id ?? "?";
    return `[${who}] ${m.text.slice(0, 240)}`;
  };

  const priorBlock = priorContext.length
    ? priorContext.map(renderLine).join("\n")
    : "(no prior unrouted messages)";

  const { system, user } = loadPrompt(routerPrompt, {
    prior_context: priorBlock,
    target_message: renderLine(target),
    addressed_state: addressed ? "directly addressed (mention/reply/DM)" : "overheard",
  });

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const result = await completeWithTools(ai, messages, ROUTER_TOOLS, { maxTokens: 256 });
  const call = result.toolCalls[0];
  if (!call) return { plan: { kind: "noop" }, confidence: 0 };

  const conf = typeof call.args["confidence"] === "number" ? (call.args["confidence"] as number) : 0.5;
  switch (call.name) {
    case "add_idea": {
      const text = String(call.args["text"] ?? "").slice(0, 200).trim();
      if (!text) return { plan: { kind: "noop" }, confidence: 0 };
      return { plan: { kind: "add_idea", text }, confidence: conf };
    }
    case "propose_constraint": {
      const text = String(call.args["text"] ?? "").slice(0, 200).trim();
      if (!text) return { plan: { kind: "noop" }, confidence: 0 };
      return { plan: { kind: "propose_constraint", text }, confidence: conf };
    }
    case "answer_question": {
      const question = String(call.args["question"] ?? "").slice(0, 200).trim() || target.text;
      return { plan: { kind: "answer_question", question }, confidence: conf };
    }
    case "record_member": {
      const text = String(call.args["text"] ?? "").trim() || target.text;
      return { plan: { kind: "record_member", text }, confidence: conf };
    }
    case "validate_idea": {
      const raw = call.args["idea_id"];
      const ideaId = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
      if (!Number.isFinite(ideaId) || ideaId <= 0) {
        return { plan: { kind: "noop" }, confidence: 0 };
      }
      return { plan: { kind: "validate_idea", idea_id: ideaId }, confidence: conf };
    }
    default:
      return { plan: { kind: "noop" }, confidence: 0 };
  }
}
