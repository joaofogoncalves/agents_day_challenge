#!/usr/bin/env node
/**
 * Quorum dogfood / chat-history seeder.
 *
 * Sends a scripted sequence of Telegram-format webhook updates to a running
 * Quorum worker (local `wrangler dev` or deployed), then fetches the board and
 * reports scores + flags parse failures.
 *
 * Usage:
 *   npx tsx scripts/dogfood.ts [--url http://localhost:8787] [--secret <secret>] [--chat <id>]
 *
 * Prerequisites:
 *   1. `wrangler dev` must be running (workers-ai uses remote binding — needs CF auth).
 *   2. In quorum/.dev.vars, set:
 *        TELEGRAM_WEBHOOK_SECRET=dogfood-secret
 *        TELEGRAM_BOT_TOKEN=<any-token-or-dummy>
 *   3. npx tsx scripts/dogfood.ts  (or npm run dogfood)
 *
 * The script uses a fixed dogfood chat ID so it never touches the real group.
 */

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1]! : fallback;
};

const BASE_URL = getArg("--url", "http://localhost:8787");
const SECRET = getArg("--secret", process.env["TELEGRAM_WEBHOOK_SECRET"] ?? "dogfood-secret");
const CHAT_ID = parseInt(getArg("--chat", "-11111111"), 10);

// ── Helpers ───────────────────────────────────────────────────────────────────

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const ok = (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const fail = (msg: string) => console.log(`  ${RED}✗${RESET} ${msg}`);
const warn = (msg: string) => console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
const info = (msg: string) => console.log(`  ${CYAN}→${RESET} ${msg}`);
const section = (msg: string) => console.log(`\n${BOLD}${msg}${RESET}`);

let updateSeq = 1;

interface BoardIdea {
  uid: string;
  name: string;
  brief: string;
  score: number;
  stage: string;
}

async function sendCommand(
  userId: number,
  firstName: string,
  text: string,
): Promise<boolean> {
  const command = text.split(" ")[0] ?? text;
  const commandLen = command.length;

  const update = {
    update_id: updateSeq++,
    message: {
      message_id: updateSeq,
      date: Math.floor(Date.now() / 1000),
      from: { id: userId, is_bot: false, first_name: firstName, language_code: "en" },
      chat: { id: CHAT_ID, type: "group", title: "Quorum Dogfood" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: commandLen }],
    },
  };

  try {
    const res = await fetch(`${BASE_URL}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": SECRET,
      },
      body: JSON.stringify(update),
    });
    if (res.ok) {
      ok(`[${firstName}] ${text}`);
      return true;
    } else {
      fail(`[${firstName}] ${text}  →  HTTP ${res.status}`);
      return false;
    }
  } catch (e) {
    fail(`[${firstName}] ${text}  →  ${(e as Error).message}`);
    return false;
  }
}

async function fetchBoard(): Promise<BoardIdea[]> {
  const res = await fetch(`${BASE_URL}/api/board?chat=${CHAT_ID}`);
  if (!res.ok) throw new Error(`Board fetch failed: ${res.status}`);
  const data = (await res.json()) as { ideas: BoardIdea[] };
  return data.ideas;
}

// ── Seed data ─────────────────────────────────────────────────────────────────

// Three fake team members — different user IDs so QuorumAgent creates 3 rows
const JOAO = { id: 1001, name: "João" };
const RUI = { id: 1002, name: "Rui" };
const DAVID = { id: 1003, name: "David" };

const MEMBERS: Array<{ user: typeof JOAO; text: string }> = [
  {
    user: JOAO,
    text: "/me 8 years backend, typescript, cloudflare workers, durable objects, node.js, postgres",
  },
  {
    user: RUI,
    text: "/me frontend specialist, react, typescript, css, tailwind, ux design, figma",
  },
  {
    user: DAVID,
    text: "/me ai engineering, llm prompts, python, backend, machine learning",
  },
];

const IDEAS: Array<{ user: typeof JOAO; text: string }> = [
  {
    user: JOAO,
    text: "/idea Group chat agent that converges a team onto the best thing to build next using LLM scoring",
  },
  {
    user: RUI,
    text: "/idea Visual kanban board synced with agent state in real-time — no drag and drop, agent moves cards",
  },
  {
    user: DAVID,
    text: "/idea Backflow reanimation: resurface parked ideas automatically when team constraints change",
  },
  {
    user: JOAO,
    text: "/idea GitHub skill extraction to ground AI recommendations in real team expertise",
  },
  {
    user: RUI,
    text: "/idea Mobile-first native app for Quorum interactions with push notifications",
  },
  {
    user: DAVID,
    text: "/idea Serverless analytics dashboard for tracking idea velocity and team decision patterns",
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\n${BOLD}Quorum dogfood seeder${RESET}  →  ${BASE_URL}  chat=${CHAT_ID}\n`,
  );

  // ── 0. Healthcheck ──────────────────────────────────────────────────────────
  section("0. Healthcheck");
  try {
    const hc = await fetch(`${BASE_URL}/healthz`);
    if (hc.ok) {
      ok(`Worker is up (${BASE_URL})`);
    } else {
      fail(`/healthz returned ${hc.status} — is wrangler dev running?`);
      process.exit(1);
    }
  } catch (e) {
    fail(`Cannot reach ${BASE_URL} — ${(e as Error).message}`);
    info("Run: cd quorum && npm run dev");
    process.exit(1);
  }

  // ── 1. Team setup ───────────────────────────────────────────────────────────
  section("1. Team setup — /me");
  for (const { user, text } of MEMBERS) {
    await sendCommand(user.id, user.name, text);
    await sleep(300);
  }

  // ── 2. Seed ideas ───────────────────────────────────────────────────────────
  section("2. Seed ideas — /idea");
  for (const { user, text } of IDEAS) {
    await sendCommand(user.id, user.name, text);
    await sleep(300);
  }

  // ── 3. Vote ─────────────────────────────────────────────────────────────────
  section("3. Voting — /vote");
  // Vote for ideas 1, 2, 3 from different users
  await sendCommand(JOAO.id, JOAO.name, "/vote 1");
  await sendCommand(RUI.id, RUI.name, "/vote 1");
  await sendCommand(DAVID.id, DAVID.name, "/vote 2");
  await sendCommand(JOAO.id, JOAO.name, "/vote 3");

  // ── 4. Promote ideas into validating ────────────────────────────────────────
  section("4. Promote — /promote");
  await sendCommand(JOAO.id, JOAO.name, "/promote 1");
  await sendCommand(JOAO.id, JOAO.name, "/promote 2");
  await sendCommand(JOAO.id, JOAO.name, "/promote 3");

  // ── 5. Park / kill some ideas ───────────────────────────────────────────────
  section("5. Park / kill (sets up backflow candidates)");
  await sendCommand(JOAO.id, JOAO.name, "/park 5");   // mobile app — likely won't fit skills
  await sendCommand(JOAO.id, JOAO.name, "/kill 6");   // analytics dashboard — park to test reanimate
  await sleep(300);

  // ── 6. Constraint — the demo moment ─────────────────────────────────────────
  section("6. /constraint — the demo moment");
  info("Re-validating parked/killed ideas against updated context…");
  await sendCommand(
    JOAO.id,
    JOAO.name,
    "/constraint must use Cloudflare Workers platform, team of 3 with frontend and backend skills",
  );
  // Wait a little longer — this triggers LLM calls for every parked/killed idea
  await sleep(2000);

  // ── 7. Board report ──────────────────────────────────────────────────────────
  section("7. Board report — GET /api/board");
  let ideas: BoardIdea[];
  try {
    ideas = await fetchBoard();
  } catch (e) {
    fail(`Board fetch failed: ${(e as Error).message}`);
    return;
  }

  if (ideas.length === 0) {
    warn("Board is empty — ideas may still be in ideating status (board only shows ideating+).");
    return;
  }

  const FALLBACK_SCORE = 5; // composite(0.5, 0.5) × 10 = 5 → likely parse failure

  let parseFailures = 0;
  let unscored = 0;

  console.log("");
  for (const idea of ideas) {
    const scoreStr = `score=${idea.score}`;
    const stageStr = `[${idea.stage}]`;
    const isFallback = idea.score === FALLBACK_SCORE;
    const isUnscored = idea.score == null;

    if (isUnscored) {
      unscored++;
      warn(`${stageStr.padEnd(14)} ${scoreStr.padEnd(10)} ${idea.name.slice(0, 60)}`);
    } else if (isFallback) {
      parseFailures++;
      warn(`${stageStr.padEnd(14)} ${scoreStr.padEnd(10)} ${idea.name.slice(0, 60)}  ← possible parse failure`);
    } else {
      ok(`${stageStr.padEnd(14)} ${scoreStr.padEnd(10)} ${idea.name.slice(0, 60)}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  section("Summary");
  ok(`${ideas.length} idea(s) on board`);

  if (parseFailures > 0) {
    warn(`${parseFailures} idea(s) have score=5 (default fallback) — check prompt parse failures`);
    warn("Run: cd quorum && npm run tail  to see LLM error logs");
  } else {
    ok("No parse failure scores detected");
  }

  if (unscored > 0) {
    warn(`${unscored} idea(s) have no score yet — validateIdea not triggered for ideating/validating ideas`);
    info("validateIdea is triggered by /constraint backflow. Promote + park an idea then /constraint again.");
  }

  const scores = ideas.map((i) => i.score).filter((s) => s != null && s !== FALLBACK_SCORE);
  if (scores.length >= 2) {
    const sorted = [...scores].sort((a, b) => b - a);
    const spread = (sorted[0]! - sorted[sorted.length - 1]!);
    if (spread < 2) {
      warn(`Score spread is only ${spread}/10 — board may look flat. Check if context + team skills are varied enough.`);
    } else {
      ok(`Score spread: ${sorted[sorted.length - 1]}–${sorted[0]} out of 10 (good differentiation)`);
    }
  }

  console.log("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((e) => {
  console.error(`\n${RED}Fatal:${RESET}`, e);
  process.exit(1);
});
