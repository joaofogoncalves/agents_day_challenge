/** Parse a free-form deadline string into a Date.
 *  Handles relative phrases the native Date.parse can't ("in 2 hours",
 *  "tomorrow at 5pm", "next Friday") and falls back to Date.parse for
 *  absolute forms ("May 1 2026", ISO 8601). Returns null when unparseable.
 *
 *  All wall-clock interpretations are in UTC — Workers run in UTC and the
 *  output of formatDeadline below labels itself as such, so users see a
 *  consistent absolute value rather than a server-locale-dependent one. */
export function parseDeadline(input: string, now: number = Date.now()): Date | null {
  const lower = input.trim().toLowerCase();
  if (!lower) return null;

  // "in N <unit>" — minutes / hours / days / weeks. "m" is intentionally
  // omitted as a unit (ambiguous between minute and month).
  const rel = lower.match(
    /^in\s+(\d+(?:\.\d+)?)\s+(minutes?|mins?|hours?|hrs?|h|days?|d|weeks?|w)$/,
  );
  if (rel) {
    const n = parseFloat(rel[1]!);
    const ms = unitMs(rel[2]!) * n;
    return new Date(now + ms);
  }

  // "today" / "tonight" / "tomorrow", optionally with " at HH(:MM)?(am|pm)?"
  const dayWord = lower.match(
    /^(today|tonight|tomorrow)(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/,
  );
  if (dayWord) {
    const which = dayWord[1]!;
    const d = new Date(now);
    if (which === "tomorrow") d.setUTCDate(d.getUTCDate() + 1);
    let hour =
      dayWord[2] != null ? parseInt(dayWord[2], 10) : which === "tonight" ? 20 : 17;
    const min = dayWord[3] != null ? parseInt(dayWord[3], 10) : 0;
    const ampm = dayWord[4];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    d.setUTCHours(hour, min, 0, 0);
    return d;
  }

  // "next <weekday>" — defaults to 17:00 UTC, always strictly in the future.
  const next = lower.match(/^next\s+([a-z]+)$/);
  if (next) {
    const target = WEEKDAYS[next[1]!];
    if (target != null) {
      const d = new Date(now);
      const delta = ((target - d.getUTCDay() + 7) % 7) || 7;
      d.setUTCDate(d.getUTCDate() + delta);
      d.setUTCHours(17, 0, 0, 0);
      return d;
    }
  }

  // Fallback: native Date.parse — handles ISO 8601, "May 1 2026", etc.
  // Use the original (untrimmed-case) input so e.g. "May" stays "May".
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Friendly absolute form for storage and display. UTC-anchored so the
 *  stored value is stable regardless of who reads it. Example:
 *  "May 1, 2026, 17:22 UTC" */
export function formatDeadline(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${fmt.format(d)} UTC`;
}

function unitMs(unit: string): number {
  if (unit.startsWith("min")) return 60_000;
  if (unit.startsWith("hour") || unit === "hr" || unit === "hrs" || unit === "h") {
    return 3_600_000;
  }
  if (unit.startsWith("day") || unit === "d") return 86_400_000;
  if (unit.startsWith("week") || unit === "w") return 7 * 86_400_000;
  return 0;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};
