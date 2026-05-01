// Quorum board API — minimal Cloudflare Worker fronting a Durable Object
// with embedded SQLite. One global DO instance ("default") for the prototype.
// When the real per-chat QuorumAgent lands, the schema and route shapes carry over.
//
// Adaptations to SPEC.md are documented inline; see SPEC.md "Board API" section.

import { seed as SEED_IDEAS } from './seed.js';

// ─── Mappings (board ↔ SPEC) ────────────────────────────────────────────────

const STAGE_TO_STATUS = {
  bucket: 'ideating',
  candidates: 'validating',
  selected: 'planning',
};
const STATUS_TO_STAGE = {
  ideating: 'bucket',
  validating: 'candidates',
  planning: 'selected',
};
const BOARD_STATUSES = ['ideating', 'validating', 'planning'];

function uidFromId(id) {
  return 'qrm_' + String(id).padStart(6, '0');
}
function idFromUid(uid) {
  const m = /^qrm_0*(\d+)$/.exec(uid ?? '');
  return m ? parseInt(m[1], 10) : null;
}

// composite per SPEC: 0.5*team + 0.4*resource + 0.1*market (market default 0.5)
function compositeScore(row) {
  const t = row.score_team ?? 0;
  const r = row.score_resource ?? 0;
  const m = row.score_market ?? 0.5;
  return 0.5 * t + 0.4 * r + 0.1 * m;
}

function rowToIdea(row) {
  return {
    uid: uidFromId(row.id),
    name: row.name || '',
    brief: row.brief || row.text || '',
    long: row.long || '',
    hours: row.hours,
    score: Math.max(0, Math.min(10, Math.round(compositeScore(row) * 10))),
    stage: STATUS_TO_STAGE[row.status] ?? 'bucket',
  };
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

// ─── Worker entry ───────────────────────────────────────────────────────────

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: CORS });
    }
    if (url.pathname.startsWith('/api/')) {
      const id = env.BOARD.idFromName('default');
      const stub = env.BOARD.get(id);
      return stub.fetch(req);
    }
    return json({ error: 'not found' }, 404);
  },
};

// ─── Durable Object: BoardAgent ─────────────────────────────────────────────

export class BoardAgent {
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this.state.blockConcurrencyWhile(async () => this.#init());
  }

  #init() {
    // Schema mirrors SPEC.md `ideas` plus board-specific additive columns.
    // Migrations are append-only — never DROP COLUMN.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ideas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id TEXT NOT NULL DEFAULT 'system',
        text TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        brief TEXT NOT NULL DEFAULT '',
        long TEXT NOT NULL DEFAULT '',
        hours INTEGER,
        status TEXT NOT NULL DEFAULT 'ideating',
        score_team REAL,
        score_resource REAL,
        score_market REAL DEFAULT 0.5,
        votes INTEGER DEFAULT 0,
        last_validated_at INTEGER,
        last_reason TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idea_id INTEGER,
        event_type TEXT NOT NULL,
        payload TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    const [{ c }] = [...this.sql.exec('SELECT COUNT(*) AS c FROM ideas')];
    if (c === 0) this.#seed();
  }

  #seed() {
    const now = Date.now();
    for (const idea of SEED_IDEAS) {
      const status = STAGE_TO_STATUS[idea.stage] ?? 'ideating';
      // Reverse the composite formula so seed `score` (1–10) round-trips
      // closely. With market=0.5: composite = 0.9*x + 0.05 where x = team = res.
      const x = Math.max(0, Math.min(1, (idea.score / 10 - 0.05) / 0.9));
      this.sql.exec(
        `INSERT INTO ideas
           (author_id, text, name, brief, long, hours,
            status, score_team, score_resource, score_market,
            votes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'system',
        idea.brief,
        idea.name,
        idea.brief,
        idea.long,
        idea.hours,
        status,
        x,
        x,
        0.5,
        0,
        now,
      );
    }
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/api/board') {
      const placeholders = BOARD_STATUSES.map(() => '?').join(',');
      const rows = [...this.sql.exec(
        `SELECT * FROM ideas WHERE status IN (${placeholders}) ORDER BY id ASC`,
        ...BOARD_STATUSES,
      )];
      return json({ ideas: rows.map(rowToIdea) });
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/ideas/')) {
      const uid = decodeURIComponent(url.pathname.slice('/api/ideas/'.length));
      const id = idFromUid(uid);
      if (!id) return json({ error: 'invalid uid' }, 400);

      let body;
      try { body = await req.json(); }
      catch { return json({ error: 'invalid json' }, 400); }

      const patch = {};
      if (typeof body?.name === 'string') patch.name = body.name.trim().slice(0, 200);
      if (typeof body?.long === 'string') patch.long = body.long.slice(0, 5000);
      if (Object.keys(patch).length === 0) return json({ error: 'nothing to update' }, 400);

      const existing = [...this.sql.exec('SELECT * FROM ideas WHERE id = ?', id)][0];
      if (!existing) return json({ error: 'not found' }, 404);

      const cols = Object.keys(patch);
      const sets = cols.map((c) => `${c} = ?`).join(', ');
      this.sql.exec(
        `UPDATE ideas SET ${sets} WHERE id = ?`,
        ...cols.map((c) => patch[c]),
        id,
      );
      this.sql.exec(
        `INSERT INTO events (idea_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)`,
        id,
        'idea_edited',
        JSON.stringify(patch),
        Date.now(),
      );
      const row = [...this.sql.exec('SELECT * FROM ideas WHERE id = ?', id)][0];
      return json({ idea: rowToIdea(row) });
    }

    return json({ error: 'not found' }, 404);
  }
}
