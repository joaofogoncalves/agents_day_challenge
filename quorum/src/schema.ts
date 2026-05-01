/**
 * SQLite schema (per-chat, owned by QuorumAgent).
 *
 * Source of truth: SPEC.md. Migrations are append-only — never
 * DROP COLUMN mid-day.
 *
 * Run inside QuorumAgent.onStart() via this.sql; CREATE IF NOT EXISTS
 * makes it idempotent across DO restarts.
 */

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ideating',
    score_team REAL,
    score_resource REAL,
    score_market REAL,
    votes INTEGER DEFAULT 0,
    last_validated_at INTEGER,
    last_reason TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    user_id TEXT PRIMARY KEY,
    display_name TEXT,
    gh_user TEXT,
    skills_json TEXT,
    availability TEXT,
    joined_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS context (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id INTEGER,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER NOT NULL
  )`,
] as const;

/**
 * Additive migrations. Run after SCHEMA on every onStart() in a try/catch
 * (SQLite throws on duplicate column add). Append-only — never reorder.
 *
 * The board UI (web/) needs name/brief/long/hours. New ideas seed
 * name=brief=text so the board renders pre-existing rows transparently.
 */
export const ADDITIVE_MIGRATIONS = [
  `ALTER TABLE ideas ADD COLUMN name TEXT`,
  `ALTER TABLE ideas ADD COLUMN brief TEXT`,
  `ALTER TABLE ideas ADD COLUMN long TEXT`,
  `ALTER TABLE ideas ADD COLUMN hours INTEGER`,
  // feat/social-ranking-and-auth: per-user vote tracking. PRIMARY KEY enforces
  // one vote per (idea, voter). voter_key = "gh:<lowercased_login>" for web,
  // "tg:<user_id>" reserved for a future Telegram unification.
  `CREATE TABLE IF NOT EXISTS idea_votes (
    idea_id INTEGER NOT NULL,
    voter_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (idea_id, voter_key)
  )`,
] as const;

export type Status =
  | "ideating"
  | "validating"
  | "planning"
  | "parked"
  | "killed";

export type Idea = {
  id: number;
  author_id: string;
  text: string;
  status: Status;
  score_team: number | null;
  score_resource: number | null;
  score_market: number | null;
  votes: number;
  last_validated_at: number | null;
  last_reason: string | null;
  created_at: number;
  name: string | null;
  brief: string | null;
  long: string | null;
  hours: number | null;
};

/**
 * Idea shape for the board UI (web/FRONTEND.md). Distinct from the SQL row
 * to keep the API stable across backend refactors.
 */
export type BoardIdea = {
  uid: string;
  name: string;
  brief: string;
  long: string;
  score: number;
  hours: number | null;
  stage: "bucket" | "candidates" | "selected";
  votes: number;
  voted_by_me: boolean;
};

/** Status → board stage. Statuses outside the board are excluded from the API response. */
export const STATUS_TO_STAGE: Partial<Record<Status, BoardIdea["stage"]>> = {
  ideating: "bucket",
  validating: "candidates",
  planning: "selected",
};

export const BOARD_STATUSES: Status[] = ["ideating", "validating", "planning"];

/** "qrm_000123" ↔ 123. Opaque on the wire, reversible on the server. */
export function uidFromId(id: number): string {
  return `qrm_${String(id).padStart(6, "0")}`;
}
export function idFromUid(uid: string): number | null {
  const m = /^qrm_0*(\d+)$/.exec(uid);
  return m ? parseInt(m[1] ?? "", 10) : null;
}

export type Member = {
  user_id: string;
  display_name: string | null;
  gh_user: string | null;
  skills_json: string | null;
  availability: string | null;
  joined_at: number;
};

export type EventType =
  | "idea_added"
  | "idea_voted"
  | "idea_phase_change"
  | "context_changed"
  | "scored"
  | "reanimated"
  | "demoted"
  | "idea_edited";
