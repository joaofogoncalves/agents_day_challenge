// Tiny API client for the Quorum board.
// Set VITE_API_BASE in .env (e.g. https://quorum.joao-f-o-goncalves.workers.dev).
// If unset, falls back to /mock.json so dev still works without a backend.
//
// The chat is read from `?chat=<telegram_chat_id>` in the page URL — one DO
// per Telegram chat. Without it the API uses its DEFAULT_BOARD_CHAT var.

const BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, '') || '';

export const usingMock = !BASE;

function chatParam() {
  if (typeof window === 'undefined') return '';
  const chat = new URLSearchParams(window.location.search).get('chat');
  return chat ? `?chat=${encodeURIComponent(chat)}` : '';
}

export async function fetchBoard() {
  if (!BASE) {
    const r = await fetch('/mock.json');
    if (!r.ok) throw new Error(`mock fetch failed: ${r.status}`);
    return r.json();
  }
  const r = await fetch(`${BASE}/api/board${chatParam()}`);
  if (!r.ok) throw new Error(`GET /api/board failed: ${r.status}`);
  return r.json();
}

export async function patchIdea(uid, patch) {
  if (!BASE) return { idea: null }; // mock mode: no-op
  const r = await fetch(`${BASE}/api/ideas/${encodeURIComponent(uid)}${chatParam()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`PATCH /api/ideas/${uid} failed: ${r.status}`);
  return r.json();
}
