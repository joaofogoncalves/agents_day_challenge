import { describe, expect, it } from "vitest";
import { initial, reduce } from "../src/reducer.js";

const baseSnapshot = {
  ideas: [
    { uid: "qrm_000001", name: "x", brief: "x", long: "", score: 5, hours: null, stage: "bucket", votes: 0, voted_by_me: false },
  ],
  activity: [],
  presence: [],
  me: { voter_key: "anon:abc", login: null, can_edit: false },
  last_event_id: 0,
};

describe("reducer", () => {
  it("hello replaces all state", () => {
    const s = reduce(initial, { kind: "hello", snapshot: baseSnapshot });
    expect(s.ideas.length).toBe(1);
    expect(s.me.voter_key).toBe("anon:abc");
  });

  it("idea_voted patches votes and voted_by_me when local user voted", () => {
    const s0 = reduce(initial, { kind: "hello", snapshot: { ...baseSnapshot, me: { ...baseSnapshot.me, voter_key: "gh:alice" } } });
    const s1 = reduce(s0, {
      kind: "idea_voted",
      uid: "qrm_000001",
      votes: 1,
      voter_key: "gh:alice",
      voted: true,
      activity: { id: 1, event_kind: "idea_voted", summary: "alice voted qrm_000001", by: { kind: "user", login: "alice", avatar: "" }, ts: 0, target_uid: "qrm_000001" },
    });
    expect(s1.ideas[0].votes).toBe(1);
    expect(s1.ideas[0].voted_by_me).toBe(true);
  });

  it("idea_voted from another user does not flip voted_by_me", () => {
    const s0 = reduce(initial, { kind: "hello", snapshot: { ...baseSnapshot, me: { ...baseSnapshot.me, voter_key: "gh:alice" } } });
    const s1 = reduce(s0, {
      kind: "idea_voted",
      uid: "qrm_000001",
      votes: 1,
      voter_key: "gh:bob",
      voted: true,
      activity: { id: 1, event_kind: "idea_voted", summary: "bob voted qrm_000001", by: { kind: "user", login: "bob", avatar: "" }, ts: 0, target_uid: "qrm_000001" },
    });
    expect(s1.ideas[0].votes).toBe(1);
    expect(s1.ideas[0].voted_by_me).toBe(false);
  });

  it("idea_phase_change drops cards leaving board statuses", () => {
    const s0 = reduce(initial, { kind: "hello", snapshot: baseSnapshot });
    const s1 = reduce(s0, {
      kind: "idea_phase_change",
      uid: "qrm_000001",
      status: "parked",
      activity: { id: 1, event_kind: "idea_phase_change", summary: "Quorum moved qrm_000001 to parked", by: { kind: "agent" }, ts: 0, target_uid: "qrm_000001" },
    });
    expect(s1.ideas.find((i) => i.uid === "qrm_000001")).toBeUndefined();
  });

  it("activity rows append, capped at 50", () => {
    let s = reduce(initial, { kind: "hello", snapshot: baseSnapshot });
    for (let i = 0; i < 60; i++) {
      s = reduce(s, {
        kind: "idea_voted", uid: "qrm_000001", votes: i, voter_key: "gh:bob", voted: true,
        activity: { id: i, event_kind: "idea_voted", summary: `bob voted (${i})`, by: { kind: "user", login: "bob", avatar: "" }, ts: i, target_uid: "qrm_000001" },
      });
    }
    expect(s.activity.length).toBe(50);
    expect(s.activity[0].id).toBe(59);
  });

  it("presence_join + presence_leave", () => {
    const s0 = reduce(initial, { kind: "hello", snapshot: baseSnapshot });
    const s1 = reduce(s0, { kind: "presence_join", presence: { connection_id: "x", actor: { kind: "user", login: "bob", avatar: "" }, joined_at: 0 } });
    expect(s1.presence.length).toBe(1);
    const s2 = reduce(s1, { kind: "presence_leave", connection_id: "x" });
    expect(s2.presence.length).toBe(0);
  });
});
