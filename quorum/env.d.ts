/// <reference types="@cloudflare/workers-types" />

import type { QuorumAgent } from "./src/agent";

declare global {
  interface Env {
    AI: Ai;
    QuorumAgent: DurableObjectNamespace<QuorumAgent>;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_WEBHOOK_SECRET: string;
    GITHUB_TOKEN?: string;
    /** Telegram chat ID the board API targets when no `?chat=` override is given. */
    DEFAULT_BOARD_CHAT?: string;
    /** Public origin of this Worker. Used by /start to build the per-chat board URL. */
    PUBLIC_BASE_URL?: string;
    /** Comma-separated GitHub logins permitted to edit ideas. Lowercase, exact match. */
    EDITOR_WHITELIST?: string;
    /** GitHub OAuth App client id. */
    GITHUB_OAUTH_CLIENT_ID?: string;
    /** GitHub OAuth App client secret. */
    GITHUB_OAUTH_CLIENT_SECRET?: string;
    /** 32-byte hex string. HMAC key for session cookies. */
    SESSION_SIGNING_KEY?: string;
  }
}

export {};
