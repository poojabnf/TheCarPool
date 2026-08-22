/**
 * Departure time formatting.
 * ─────────────────────────────────────────────────────
 * Three screens each hand-rolled their own `toLocaleDateString('en-IN', …)`,
 * which both duplicated the logic and pinned it to India while the rest of
 * the app was being made market-agnostic.
 *
 * For a commute app the useful question is almost always "how soon?", not
 * "what date?" — so today/tomorrow are named rather than printed as a date,
 * and anything within the hour reads as minutes away. That is the difference
 * between a rider scanning results and a rider doing arithmetic.
 */

/** Undated/invalid input renders as an em dash rather than "Invalid Date". */
function parse(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function timeOnly(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * "In 25 min" · "Today, 9:15 AM" · "Tomorrow, 8:00 AM" · "Fri 22 Aug, 8:00 AM"
 *
 * `now` is injectable so this stays testable without freezing the clock.
 */
export function formatDeparture(value?: string | null, now: Date = new Date()): string {
  const d = parse(value);
  if (!d) return '—';

  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);

  // Already gone — say so plainly instead of showing a stale future-looking time.
  if (diffMs < -60000) return `Departed ${timeOnly(d)}`;
  if (diffMin <= 0) return 'Departing now';
  if (diffMin < 60) return `In ${diffMin} min`;

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (sameDay(d, now)) return `Today, ${timeOnly(d)}`;
  if (sameDay(d, tomorrow)) return `Tomorrow, ${timeOnly(d)}`;

  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${timeOnly(d)}`;
}

/** True when departure is within the next hour — drives the "leaving soon" accent. */
export function isDepartingSoon(value?: string | null, now: Date = new Date()): boolean {
  const d = parse(value);
  if (!d) return false;
  const diffMin = (d.getTime() - now.getTime()) / 60000;
  return diffMin > 0 && diffMin < 60;
}
