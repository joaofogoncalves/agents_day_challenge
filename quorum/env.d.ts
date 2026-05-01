/// <reference types="@cloudflare/workers-types" />

import type { QuorumAgent } from "./src/agent";

declare global {
  interface Env {
    AI: Ai;
    QuorumAgent: DurableObjectNamespace<QuorumAgent>;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_WEBHOOK_SECRET: string;
    GITHUB_TOKEN?: string;
  }
}

export {};
