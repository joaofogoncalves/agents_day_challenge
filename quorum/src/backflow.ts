/**
 * Backflow / reanimation logic. The DEMO MOMENT: when a /constraint
 * changes the team's context, parked or killed ideas are re-validated
 * against the new context. Ones that now clear the threshold come
 * back to `ideating`.
 *
 * H+7 milestone (joao). Stub for now — wired in once validateIdea
 * exists.
 */

import type { QuorumAgent } from "./agent";
import { REANIMATE_THRESHOLD, composite } from "./scoring";

export type ReanimateResult = {
  reanimated: number[];
  demoted: number[];
  reason: string;
};

export async function reanimate(
  agent: QuorumAgent,
  constraint: string,
): Promise<ReanimateResult> {
  // 1. Persist constraint into context table (caller does this via setContext).
  // 2. SELECT all ideas where status IN ('parked','killed').
  // 3. For each, re-run validateIdea(id) with the updated context.
  // 4. If new composite >= REANIMATE_THRESHOLD → status = 'ideating',
  //    append 'reanimated' event. Else leave (or demote validating ideas
  //    that fall below threshold).
  // 5. Return delta.

  const candidates = agent.listIdeas("parked").concat(agent.listIdeas("killed"));
  const reanimated: number[] = [];
  const demoted: number[] = [];

  for (const idea of candidates) {
    const scores = await agent.validateIdea(idea.id);
    const score = composite({ team: scores.team, resource: scores.resource, votes: idea.votes });
    if (score >= REANIMATE_THRESHOLD) {
      agent.setStatus(idea.id, "ideating", `reanimated by: ${constraint}`);
      reanimated.push(idea.id);
    }
  }

  // Append a summary event then broadcast per-idea phase changes + summary.
  agent.appendEvent(null, "reanimated", {
    by: { kind: "agent" },
    reanimated: reanimated.length,
    demoted: demoted.length,
    reason: constraint,
  });

  // Broadcast a constraint_applied summary.
  const reanimatedUids = reanimated.map((rid) => `qrm_${String(rid).padStart(6, "0")}`);
  const demotedUids = demoted.map((rid) => `qrm_${String(rid).padStart(6, "0")}`);
  const summaryRow = (agent.sql`SELECT id, created_at FROM events WHERE id = (SELECT MAX(id) FROM events)`)[0] as { id: number; created_at: number } | undefined;
  if (summaryRow) {
    const summaryActivity = agent.activityRowFromEvent({
      event_id: summaryRow.id,
      event_kind: "reanimated",
      target_uid: null,
      by: { kind: "agent" },
      ts: summaryRow.created_at,
      payload: { reanimated: reanimated.length, demoted: demoted.length, reason: constraint },
    });
    agent.broadcastWire({
      kind: "constraint_applied",
      reanimated: reanimatedUids,
      demoted: demotedUids,
      reason: constraint,
      activity: summaryActivity,
    });
  }

  return {
    reanimated,
    demoted,
    reason: constraint,
  };
}
