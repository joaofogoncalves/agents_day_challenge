/**
 * Auth helpers for the board UI.
 *
 * Session = stateless signed cookie. Payload = { login, avatar_url, exp },
 * format = `<base64url(payloadJson)>.<hexHmac>`. No DB-side session store.
 *
 * Whitelist (env.EDITOR_WHITELIST) is comma-separated GitHub logins,
 * compared lowercased.
 *
 * GitHub OAuth Web App flow (read:user scope only). The callback redirects
 * to `/` with the session cookie set.
 */

const SESSION_COOKIE = "quorum_session";
const OAUTH_STATE_COOKIE = "quorum_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const OAUTH_STATE_TTL_SECONDS = 60 * 10; // 10 minutes

export type SessionPayload = {
  login: string;
  avatar_url: string;
  exp: number; // unix seconds
};

export type Session = {
  login: string;
  avatar_url: string;
  can_vote: boolean;
  can_edit: boolean;
};

// ── Cookies ──────────────────────────────────────────────────────

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const piece of header.split(";")) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    const k = piece.slice(0, eq).trim();
    const v = piece.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setCookie(name: string, value: string, opts: { maxAge?: number; secure?: boolean } = {}): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return setCookie(name, "", { maxAge: 0, secure });
}

// ── HMAC (WebCrypto) ─────────────────────────────────────────────

async function hmacKey(rawHexKey: string): Promise<CryptoKey> {
  const bytes = hexToBytes(rawHexKey);
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function hmacHex(key: CryptoKey, data: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToHex(new Uint8Array(sig));
}

async function hmacVerify(key: CryptoKey, data: string, hexSig: string): Promise<boolean> {
  // Constant-time compare via subtle.verify.
  const sig = hexToBytes(hexSig);
  return crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(data));
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): string {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

// ── Session token ────────────────────────────────────────────────

export async function signSession(payload: SessionPayload, signingKeyHex: string): Promise<string> {
  const key = await hmacKey(signingKeyHex);
  const json = JSON.stringify(payload);
  const body = base64urlEncode(json);
  const sig = await hmacHex(key, body);
  return `${body}.${sig}`;
}

export async function verifySession(token: string, signingKeyHex: string): Promise<SessionPayload | null> {
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let key: CryptoKey;
  try {
    key = await hmacKey(signingKeyHex);
  } catch {
    return null;
  }
  const ok = await hmacVerify(key, body, sig).catch(() => false);
  if (!ok) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(base64urlDecode(body)) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.login !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ── Session resolution + permission helpers ──────────────────────

export async function readSession(request: Request, env: Env): Promise<Session | null> {
  if (!env.SESSION_SIGNING_KEY) return null;
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const payload = await verifySession(token, env.SESSION_SIGNING_KEY);
  if (!payload) return null;
  const can_edit = isEditor(payload.login, env);
  return {
    login: payload.login,
    avatar_url: payload.avatar_url,
    can_vote: true,
    can_edit,
  };
}

export function isEditor(login: string, env: Env): boolean {
  const list = (env.EDITOR_WHITELIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(login.toLowerCase());
}

export function voterKey(login: string): string {
  return `gh:${login.toLowerCase()}`;
}

// ── OAuth flow ───────────────────────────────────────────────────

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

function originOf(request: Request, env: Env): string {
  // Prefer explicit env var when configured (deployed Worker), fall back to request origin (local dev).
  if (env.PUBLIC_BASE_URL && /^https?:\/\//.test(env.PUBLIC_BASE_URL)) return env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function callbackUrl(request: Request, env: Env): string {
  // The browser-facing origin (where the user clicks "sign in"). In local dev
  // this comes back via the Vite proxy at :5173. We persist it so the Worker
  // returns the user to the correct origin on callback.
  const origin = new URL(request.url).origin;
  void env; // origin from the request is canonical for OAuth callback
  return `${origin}/auth/github/callback`;
}

export async function startOAuth(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.SESSION_SIGNING_KEY) {
    return new Response("oauth not configured (missing GITHUB_OAUTH_CLIENT_ID or SESSION_SIGNING_KEY)", { status: 500 });
  }

  const state = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const stateToken = await signSession(
    { login: `__oauth_state__:${state}`, avatar_url: "", exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS },
    env.SESSION_SIGNING_KEY,
  );

  const params = new URLSearchParams({
    client_id: env.GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: callbackUrl(request, env),
    scope: "read:user",
    state,
    allow_signup: "true",
  });

  const secure = new URL(request.url).protocol === "https:";
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${GITHUB_AUTHORIZE_URL}?${params.toString()}`,
      "Set-Cookie": setCookie(OAUTH_STATE_COOKIE, stateToken, { maxAge: OAUTH_STATE_TTL_SECONDS, secure }),
    },
  });
}

export async function finishOAuth(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET || !env.SESSION_SIGNING_KEY) {
    return new Response("oauth not configured", { status: 500 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateFromUrl = url.searchParams.get("state");
  if (!code || !stateFromUrl) return new Response("missing code or state", { status: 400 });

  const cookies = parseCookies(request.headers.get("Cookie"));
  const stateToken = cookies[OAUTH_STATE_COOKIE];
  if (!stateToken) return new Response("missing oauth state cookie", { status: 400 });

  const stateClaims = await verifySession(stateToken, env.SESSION_SIGNING_KEY);
  if (!stateClaims || stateClaims.login !== `__oauth_state__:${stateFromUrl}`) {
    return new Response("invalid oauth state", { status: 400 });
  }

  // Exchange code for access token.
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(request, env),
    }),
  });
  if (!tokenRes.ok) return new Response(`github token exchange failed (${tokenRes.status})`, { status: 502 });
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) return new Response(`github error: ${tokenJson.error ?? "unknown"}`, { status: 502 });

  // Fetch the user's login.
  const userRes = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "quorum-board",
    },
  });
  if (!userRes.ok) return new Response(`github /user failed (${userRes.status})`, { status: 502 });
  const user = (await userRes.json()) as { login?: string; avatar_url?: string };
  if (!user.login) return new Response("github /user missing login", { status: 502 });

  const session = await signSession(
    {
      login: user.login,
      avatar_url: user.avatar_url ?? "",
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    env.SESSION_SIGNING_KEY,
  );

  const secure = url.protocol === "https:";
  const headers = new Headers();
  headers.append("Location", "/");
  headers.append("Set-Cookie", setCookie(SESSION_COOKIE, session, { maxAge: SESSION_TTL_SECONDS, secure }));
  headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE, secure));
  return new Response(null, { status: 302, headers });
}

export function logoutResponse(request: Request): Response {
  const secure = new URL(request.url).protocol === "https:";
  const headers = new Headers();
  headers.append("Content-Type", "application/json; charset=utf-8");
  headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, secure));
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
