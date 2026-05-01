/**
 * Composite scoring math. Formula in SPEC.md.
 *
 * composite = 0.5 * team_fit + 0.4 * resource_fit + 0.1 * market_placeholder
 *
 * Weights sum to 1.0. market_placeholder is a constant 0.5 until we
 * wire a market signal. NEVER tune weights without updating SPEC and
 * pinging the team in chat.
 */

export const MARKET_PLACEHOLDER = 0.5;

export function composite(input: {
  team: number | null;
  resource: number | null;
  market?: number | null;
}): number {
  const team = clamp(input.team ?? 0);
  const resource = clamp(input.resource ?? 0);
  const market = clamp(input.market ?? MARKET_PLACEHOLDER);
  return 0.5 * team + 0.4 * resource + 0.1 * market;
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
