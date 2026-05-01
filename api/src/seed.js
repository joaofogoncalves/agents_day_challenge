// One-time demo seed for the prototype. Used only when the ideas table is empty.
// Same content as web/public/mock.json — kept in sync by hand for the prototype.

export const seed = [
  {
    name: "Slack adapter parity",
    brief: "Mirror the Telegram command surface inside Slack with a single shared handler.",
    score: 8,
    hours: 6,
    stage: "selected",
    long: "Wrap the existing grammY-style command parser behind a thin transport interface so the QuorumAgent doesn't care whether the inbound payload came from Telegram or Slack. Slack adds the wrinkle of threaded replies — we treat each thread root as the chat-id surrogate. Out of scope for v1: Slack's slash command picker UI."
  },
  {
    name: "Reanimation digest",
    brief: "Weekly cron that reruns /constraint and DMs the digest to the chat owner.",
    score: 7,
    hours: 4,
    stage: "selected",
    long: "Schedule a Sunday-evening cron per chat that walks the parked + killed shelves, reruns the validation pass against the current team profile, and produces a top-3 list of reanimation candidates. Output goes to the chat as a single message — collapsible, with the why-rope visible inline. Skipped if the chat has had zero activity for 14 days."
  },
  {
    name: "GitHub-grounded skill graph",
    brief: "Pull contributor language stats and surface them on /me.",
    score: 9,
    hours: 5,
    stage: "selected",
    long: "When a user links their GitHub via /me github:handle, fetch the public language histogram across their last 50 pushed repos, weight by recency, and store a compact skill vector on the agent's SQL row for that user. The validation phase consults this vector to flag ideas that the team can't realistically execute. No private repo scopes — public-only, no token storage."
  },
  {
    name: "Voice-note ingestion",
    brief: "Transcribe Telegram voice messages into raw idea text via Workers AI Whisper.",
    score: 6,
    hours: 3,
    stage: "candidates",
    long: "Audio messages flow through @cf/openai/whisper, the resulting transcript is treated identically to typed /idea text. Watch the Neuron budget — Whisper is heavy. Gate behind a per-chat opt-in flag stored in agent state."
  },
  {
    name: "Idea de-duplication",
    brief: "Embedding-based similarity check before /idea hits the bucket.",
    score: 7,
    hours: 4,
    stage: "candidates",
    long: "Compute an embedding for every new /idea, compare against all live ideas in the same chat with cosine > 0.86, and respond with a soft prompt: 'this looks like idea #7 — merge or keep separate?'. Reduces bucket noise massively in chats where the same proposal gets re-pitched in different words. Vectors live in this.sql with sqlite-vss."
  },
  {
    name: "Ambient nudges",
    brief: "Scheduled prods when an idea has been parked for >7 days with no movement.",
    score: 5,
    hours: 2,
    stage: "candidates",
    long: "Every parked idea schedules a one-shot via this.schedule() seven days out. On fire, the agent posts a single sentence into the chat: 'idea #N has been parked for a week — kill, revive, or leave?'. Cancellable; dedupes if the idea moves in the meantime."
  },
  {
    name: "Why-rope visualizer",
    brief: "Render the audit chain for /why as a compact ASCII tree.",
    score: 6,
    hours: 2,
    stage: "candidates",
    long: "Today /why returns prose. The ASCII variant draws the event chain as a vertical rope with branches for each stage transition — looks great in monospace clients, parses cleanly for screen readers. Toggle via /why --tree."
  },
  {
    name: "Per-chat persona pack",
    brief: "Let chats pick a tone preset: dry, hype, deadpan, professorial.",
    score: 4,
    hours: 3,
    stage: "bucket",
    long: "Stylistic prompt-prefix swap, persisted on the agent's state. Doesn't change behavior, only the surface voice of every reply. Risk: tone presets bleed into judgement framing in subtle ways — needs eval before shipping wider than two presets."
  },
  {
    name: "Constraint-driven scoring",
    brief: "Re-weight scores when the chat declares a hard constraint (deadline, headcount, budget).",
    score: 8,
    hours: 5,
    stage: "bucket",
    long: "/constraint deadline:2026-06-01 headcount:2 — these become first-class facts the validation phase reads. Ideas whose effort estimate exceeds the runway get score-decayed, not killed, so they remain reanimation candidates if the constraint relaxes. The decay function is a soft sigmoid, not a cliff."
  },
  {
    name: "Public read-only board",
    brief: "Static page that mirrors the agent's current state for the chat.",
    score: 6,
    hours: 4,
    stage: "bucket",
    long: "Each chat gets a /board command that returns a tokenized URL — the page reads from the agent over a signed GET endpoint and renders these three columns. Read-only; mutations always go through the chat. Exists so non-members can be shown the state without joining."
  },
  {
    name: "Idea templates",
    brief: "/idea --template=experiment scaffolds the brief with hypothesis/metric/timebox prompts.",
    score: 3,
    hours: 2,
    stage: "bucket",
    long: "Three templates to start: experiment, infra, polish. The template fills the long-description with a structured skeleton the user edits in-place. Reduces empty-brief ideas, which today end up parked because nobody can validate them."
  },
  {
    name: "Cross-chat idea citation",
    brief: "Reference an idea from another chat the user is in via @chat#id syntax.",
    score: 2,
    hours: 6,
    stage: "bucket",
    long: "Ambitious. Requires a global user→chats index and a permissioning model that respects per-chat privacy. Most likely cut. Kept in the bucket as a marker for after-hackathon thinking."
  }
];
