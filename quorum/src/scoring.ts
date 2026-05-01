/**
 * Composite scoring math. Formula in SPEC.md.
 *
 * composite = 0.5 * team_fit + 0.4 * resource_fit + 0.1 * voteFit(votes)
 *
 * Weights sum to 1.0. The third term used to be a constant 0.5 placeholder
 * (market). With per-user voting now wired (idea_votes table, /vote slash,
 * +1 #N regex, board vote button), votes are a real signal — so the third
 * slot now carries that. NEVER tune weights without updating SPEC and
 * pinging the team in chat.
 */

/** Number of votes at which voteFit saturates to 1.0. Headroom past the
 *  3-person core team for cross-platform votes (web GH-auth + telegram). */
export const VOTE_SATURATION = 5;

/** Vestigial constant — score_market column is still written by the legacy
 *  scoring path until that path is cleaned up. No longer in composite. */
export const MARKET_PLACEHOLDER = 0.5;

/** Saturating-linear mapping from raw vote count → [0, 1]. */
export function voteFit(votes: number | null | undefined): number {
  const v = Math.max(0, votes ?? 0);
  return Math.min(v / VOTE_SATURATION, 1);
}

export function composite(input: {
  team: number | null;
  resource: number | null;
  votes?: number | null;
}): number {
  const team = clamp(input.team ?? 0);
  const resource = clamp(input.resource ?? 0);
  const votes = voteFit(input.votes);
  return 0.5 * team + 0.4 * resource + 0.1 * votes;
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Threshold for auto-promotion ideating → validating. */
export const PROMOTE_THRESHOLD = 0.7;

/** Threshold for backflow reanimation parked|killed → ideating. */
export const REANIMATE_THRESHOLD = 0.65;
