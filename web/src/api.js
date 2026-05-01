// Quorum board API client.
//
// Same-origin assumption: in dev, Vite proxies /api and /auth to the
// Wrangler Worker (see vite.config.js); in prod the Worker serves the
// built web/dist directly. Either way, paths here are relative — that's
// what makes HttpOnly session cookies ride along without CORS gymnastics.
//
// Mock mode (VITE_USE_MOCK=1) bypasses the network and reads /mock.json
// for layout work. Voting and editing are no-ops in mock mode.
//
// `?chat=<telegram_chat_id>` in the page URL pins to a specific DO.
// Without it, the Worker uses DEFAULT_BOARD_CHAT.
//
// CSRF: the Worker mints a `quorum_csrf` cookie at session creation and
// echoes the same token in /api/me's body. We cache it in memory and send
// it as `X-Quorum-CSRF` on every state-changing request. Double-submit:
// cross-origin attackers can't read the cookie, so they can't forge the
// header even if the browser ships the session cookie.

export const usingMock = import.meta.env.VITE_USE_MOCK === '1';

const FETCH_OPTS = { credentials: 'include' };

let csrfToken = null;

function chatParam() {
  if (typeof window === 'undefined') return '';
  const chat = new URLSearchParams(window.location.search).get('chat');
  return chat ? `?chat=${encodeURIComponent(chat)}` : '';
}

function csrfHeaders() {
  return csrfToken ? { 'X-Quorum-CSRF': csrfToken } : {};
}

export async function fetchBoard() {
  if (usingMock) {
    const r = await fetch('/mock.json');
    if (!r.ok) throw new Error(`mock fetch failed: ${r.status}`);
    return r.json();
  }
  const r = await fetch(`/api/board${chatParam()}`, FETCH_OPTS);
  if (!r.ok) throw new Error(`GET /api/board failed: ${r.status}`);
  return r.json();
}

export async function fetchMe() {
  if (usingMock) return {};
  try {
    const r = await fetch('/api/me', FETCH_OPTS);
    if (!r.ok) return {};
    const me = await r.json();
    if (me && typeof me.csrf_token === 'string') csrfToken = me.csrf_token;
    return me;
  } catch {
    return {};
  }
}

export async function patchIdea(uid, patch) {
  if (usingMock) return { idea: null };
  const r = await fetch(`/api/ideas/${encodeURIComponent(uid)}${chatParam()}`, {
    ...FETCH_OPTS,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(patch),
  });
  if (r.status === 401) throw new Error('unauthorized — sign in first');
  if (r.status === 403) throw new Error('forbidden — editor whitelist required');
  if (!r.ok) throw new Error(`PATCH /api/ideas/${uid} failed: ${r.status}`);
  return r.json();
}

export async function voteIdea(uid) {
  if (usingMock) return { votes: 0, voted: false };
  const r = await fetch(`/api/ideas/${encodeURIComponent(uid)}/vote${chatParam()}`, {
    ...FETCH_OPTS,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: '{}',
  });
  if (r.status === 401) throw new Error('unauthorized — sign in first');
  if (!r.ok) throw new Error(`POST vote failed: ${r.status}`);
  return r.json();
}

export async function logout() {
  if (usingMock) return;
  await fetch('/auth/logout', {
    ...FETCH_OPTS,
    method: 'POST',
    headers: { ...csrfHeaders() },
  });
  csrfToken = null;
}
