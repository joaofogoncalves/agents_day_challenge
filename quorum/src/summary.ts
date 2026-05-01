// quorum/src/summary.ts
//
// Pure function that turns a typed event into a one-line activity-feed
// summary. Plain text only — output is rendered as-is on the client
// without any HTML/Markdown processing, so this is the only place that
// decides how each event reads.

import type { ActorRef } from "./wire";
import type { EventType } from "./schema";

type SummaryInput = {
  event_kind: EventType;
  target_uid: string | null;
  by: ActorRef;
  payload: Record<string, unknown>;
};

function actorName(actor: ActorRef): string {
  if (actor.kind === "user") return actor.login;
  if (actor.kind === "agent") return "Quorum";
  return "someone";
}

export function renderSummary(input: SummaryInput): string {
  const who = actorName(input.by);
  const uid = input.target_uid ?? "";
  const p = input.payload;

  switch (input.event_kind) {
    case "idea_added":
      return `${who} added ${uid}`;
    case "idea_voted":
      return p.voted ? `${who} voted ${uid}` : `${who} unvoted ${uid}`;
    case "idea_edited": {
      const fields = Array.isArray(p.fields) ? (p.fields as string[]).join(", ") : "";
      return fields ? `${who} edited ${uid} (${fields})` : `${who} edited ${uid}`;
    }
    case "idea_phase_change":
      return `${who} moved ${uid} to ${String(p.status ?? "?")}`;
    case "scored":
      return `${who} scored ${uid} → ${String(p.score ?? "?")}`;
    case "reanimated":
      return `${who} reanimated ${String(p.reanimated ?? 0)}, demoted ${String(p.demoted ?? 0)} — ${String(p.reason ?? "")}`;
    case "demoted":
      return `${who} demoted ${uid}`;
    case "context_changed":
      return `${who} changed context`;
    case "observed":
      return `${who} observed`;
    case "router_call":
      return `${who} routed`;
    case "injection_blocked":
      return `${who} blocked input`;
    default:
      return `${who} ${String(input.event_kind)} ${uid}`.trim();
  }
}
