import { describe, expect, it } from "vitest";
import { renderSummary } from "../src/summary";
import type { ActorRef } from "../src/wire";

const alice: ActorRef = { kind: "user", login: "alice", avatar: "" };
const agent: ActorRef = { kind: "agent" };
const anon: ActorRef = { kind: "anon", id: "abc123" };

describe("renderSummary", () => {
  it("renders a vote by a user", () => {
    expect(
      renderSummary({
        event_kind: "idea_voted",
        target_uid: "qrm_000003",
        by: alice,
        payload: { voted: true },
      }),
    ).toBe("alice voted qrm_000003");
  });

  it("renders an unvote", () => {
    expect(
      renderSummary({
        event_kind: "idea_voted",
        target_uid: "qrm_000003",
        by: alice,
        payload: { voted: false },
      }),
    ).toBe("alice unvoted qrm_000003");
  });

  it("renders an idea added", () => {
    expect(
      renderSummary({
        event_kind: "idea_added",
        target_uid: "qrm_000010",
        by: alice,
        payload: {},
      }),
    ).toBe("alice added qrm_000010");
  });

  it("renders an edit", () => {
    expect(
      renderSummary({
        event_kind: "idea_edited",
        target_uid: "qrm_000004",
        by: alice,
        payload: { fields: ["name", "long"] },
      }),
    ).toBe("alice edited qrm_000004 (name, long)");
  });

  it("renders a phase change by the agent", () => {
    expect(
      renderSummary({
        event_kind: "idea_phase_change",
        target_uid: "qrm_000007",
        by: agent,
        payload: { status: "validating" },
      }),
    ).toBe("Quorum moved qrm_000007 to validating");
  });

  it("renders a score result", () => {
    expect(
      renderSummary({
        event_kind: "scored",
        target_uid: "qrm_000007",
        by: agent,
        payload: { score: 7 },
      }),
    ).toBe("Quorum scored qrm_000007 → 7");
  });

  it("renders a constraint applied", () => {
    expect(
      renderSummary({
        event_kind: "reanimated",
        target_uid: null,
        by: agent,
        payload: { reanimated: 2, demoted: 1, reason: "budget cut to $5k" },
      }),
    ).toBe("Quorum reanimated 2, demoted 1 — budget cut to $5k");
  });

  it("renders an anonymous actor as 'someone'", () => {
    expect(
      renderSummary({
        event_kind: "idea_voted",
        target_uid: "qrm_000003",
        by: anon,
        payload: { voted: true },
      }),
    ).toBe("someone voted qrm_000003");
  });
});
