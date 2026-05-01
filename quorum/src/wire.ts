// quorum/src/wire.ts
//
// Realtime board events. Single source of truth for both the Worker/DO
// and the web/ frontend (imported as type-only from the relative path
// `../../quorum/src/wire`). Pure types — no runtime code.

import type { BoardIdea, Status, EventType } from "./schema";

export type ActorRef =
  | { kind: "user"; login: string; avatar: string }
  | { kind: "agent" }
  | { kind: "anon"; id: string };

export type Presence = {
  connection_id: string;
  actor: ActorRef;
  joined_at: number; // unix ms
};

export type ActivityRow = {
  id: number;             // events.id from DB, monotonic per chat
  event_kind: EventType;
  summary: string;        // server-rendered, plain text only
  by: ActorRef;
  ts: number;             // unix ms
  target_uid: string | null;
};

export type HelloSnapshot = {
  ideas: BoardIdea[];
  activity: ActivityRow[]; // last 50, newest LAST (chronological)
  presence: Presence[];
  me: { voter_key: string; login: string | null; can_edit: boolean };
  last_event_id: number;
};

export type Wire =
  | { kind: "hello"; snapshot: HelloSnapshot }
  | { kind: "idea_added";        idea: BoardIdea;                                                                     activity: ActivityRow }
  | { kind: "idea_voted";        uid: string; votes: number; voter_key: string; voted: boolean;                       activity: ActivityRow }
  | { kind: "idea_edited";       uid: string; patch: { name?: string; long?: string; brief?: string };                activity: ActivityRow }
  | { kind: "idea_phase_change"; uid: string; status: Status;                                                         activity: ActivityRow }
  | { kind: "scored";            uid: string; score: number; components: { team: number; resource: number; market: number }; activity: ActivityRow }
  | { kind: "constraint_applied"; reanimated: string[]; demoted: string[]; reason: string;                            activity: ActivityRow }
  | { kind: "presence_join";  presence: Presence }
  | { kind: "presence_leave"; connection_id: string };

export type WireKind = Wire["kind"];

/** Per-connection metadata persisted via ws.serializeAttachment. */
export type SocketAttachment = {
  connection_id: string;
  voter_key: string;        // gh:<login> | anon:<nanoid>
  login: string | null;
  avatar: string | null;
  joined_at: number;        // unix ms
};
