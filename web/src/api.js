// Tiny API client for the Quorum board.
// Set VITE_API_BASE in .env (e.g. https://quorum-api.<account>.workers.dev).
// If unset, falls back to /mock.json so dev still works without a backend.

const BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, '') || '';

export const usingMock = !BASE;

export async function fetchBoard() {
  if (!BASE) {
    const r = await fetch('/mock.json');
    if (!r.ok) throw new Error(`mock fetch failed: ${r.status}`);
    return r.json();
  }
  const r = await fetch(`${BASE}/api/board`);
  if (!r.ok) throw new Error(`GET /api/board failed: ${r.status}`);
  return r.json();
}

export async function patchIdea(uid, patch) {
  if (!BASE) return { idea: null }; // mock mode: no-op
  const r = await fetch(`${BASE}/api/ideas/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`PATCH /api/ideas/${uid} failed: ${r.status}`);
  return r.json();
}
