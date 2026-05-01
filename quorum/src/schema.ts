/**
 * SQLite schema (per-chat, owned by QuorumAgent).
 *
 * Source of truth: SPEC.md. Migrations are append-only — never
 * DROP COLUMN mid-day.
 *
 * Two arrays, two roles:
 *   • SCHEMA — the canonical shape *today*. CREATE TABLE IF NOT EXISTS, so
 *     fresh DOs land on the current shape in one pass. Re-running on an
 *     existing DO is a no-op.
 *   • ADDITIVE_MIGRATIONS — the upgrade path for DOs that started on an
 *     earlier SCHEMA. Each entry runs in try/catch (SQLite throws on
 *     duplicate ADD COLUMN); for fresh DOs the canonical CREATE already has
 *     these columns, so the ALTER just throws and is swallowed.
 *
 * Both arrays run in QuorumAgent.onStart() on every boot.
 *
 * Columns (name/brief/long/hours) and tables (idea_votes) added later are
 * mirrored into SCHEMA so a fresh reader sees the truth, *and* kept in
 * ADDITIVE_MIGRATIONS so existing DOs pick them up. Don't remove migration
 * entries when you mirror them — old DOs still need the upgrade.
 */

export const SCHEMA = [
  // name/brief/long/hours are nullable on purpose: existing DOs in prod added
  // them via nullable ALTER, so fresh DOs match (no NOT NULL divergence).
  // Code reading these columns already null-coalesces (see getBoard).
  `CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id TEXT NOT NULL,
    text TEXT NOT NULL,
    name TEXT,
    brief TEXT,
    long TEXT,
    hours INTEGER,
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
  // Conversation log — every text message in the chat, command or not,
  // addressed or not. Foundation for the agentic / "reads everything" pitch.
  // The router uses recent rows as context.
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id TEXT,
    author_name TEXT,
    text TEXT NOT NULL,
    ts INTEGER NOT NULL,
    addressed_bot INTEGER NOT NULL DEFAULT 0,
    intent_json TEXT
  )`,
  // Short-lived per-user "did you mean X?" state. When the bot proposes an
  // action (e.g. /constraint), it stashes the action here; the next "yes"
  // from that user inside the TTL executes it. Cheap state machine, no
  // inline keyboards needed.
  `CREATE TABLE IF NOT EXISTS pending_confirmations (
    user_id TEXT PRIMARY KEY,
    action_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  // Per-user vote tracking (feat/social-ranking-and-auth). PRIMARY KEY
  // enforces one vote per (idea, voter). voter_key shapes:
  //   • "gh:<lowercased_login>" — web (GitHub OAuth) and Telegram users who
  //     have linked a GitHub account via /gh (so the same person voting on
  //     web and Telegram doesn't double-count).
  //   • "tg:<telegram_user_id>" — Telegram users without a linked GH account.
  // Resolution lives in QuorumAgent.voterKeyForTelegram.
  `CREATE TABLE IF NOT EXISTS idea_votes (
    idea_id INTEGER NOT NULL,
    voter_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (idea_id, voter_key)
  )`,
] as const;

/**
 * Upgrade-path entries for DOs that started on an earlier SCHEMA version.
 * Append-only — never reorder. Run after SCHEMA in a try/catch (SQLite
 * throws on duplicate ADD COLUMN; CREATE IF NOT EXISTS is fine).
 *
 * Mirror any new entry into SCHEMA above so fresh DOs land on the canonical
 * shape directly; keep the entry here so existing DOs still upgrade.
 */
export const ADDITIVE_MIGRATIONS = [
  `ALTER TABLE ideas ADD COLUMN name TEXT`,
  `ALTER TABLE ideas ADD COLUMN brief TEXT`,
  `ALTER TABLE ideas ADD COLUMN long TEXT`,
  `ALTER TABLE ideas ADD COLUMN hours INTEGER`,
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
  /** 0–10 integer, derived from composite of the three fits. */
  score: number;
  /** Raw fit values in [0, 1], or null when the idea has not been validated yet. */
  score_team: number | null;
  score_resource: number | null;
  /** Always set; current placeholder is constant 0.5 until a market signal is wired. */
  score_market: number;
  /** One-sentence rationale from the last scoring pass. Null until validated. */
  score_reason: string | null;
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
  | "idea_edited"
  | "observed"
  | "router_call"
  | "injection_blocked"
  | "stall_nudge";

export type Message = {
  id: number;
  author_id: string | null;
  author_name: string | null;
  text: string;
  ts: number;
  addressed_bot: number;
  intent_json: string | null;
};

/**
 * An ActionPlan is what the router emits and what gets stashed in
 * pending_confirmations when a proposal needs a yes. Mirrors the tool-call
 * surface in src/router.ts.
 */
export type ActionPlan =
  | { kind: "add_idea"; text: string }
  | { kind: "propose_constraint"; text: string }
  | { kind: "answer_question"; question: string }
  | { kind: "record_member"; text: string }
  | { kind: "noop" };
