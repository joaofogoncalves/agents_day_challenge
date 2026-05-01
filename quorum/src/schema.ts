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
};

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
  | "demoted";
