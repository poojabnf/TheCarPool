// Jest is the project test runner; describe/it/expect are globals.
import {
  resolveStopEtas, minutesUntil, needsBoardingReminder,
  BOARDING_REMINDER_MINUTES,
} from '../eta';

const DEP = '2026-08-28T09:00:00.000Z';
const stop = (label: string, driver_eta?: string) => ({ label, lat: 25.4, lng: 78.5, driver_eta });

describe('resolveStopEtas', () => {
  it('computes forward from departure using leg durations', () => {
    const out = resolveStopEtas(DEP, [stop('A'), stop('B')], [600, 900]); // 10m, 15m
    expect(out[0].eta).toBe('2026-08-28T09:10:00.000Z');
    expect(out[1].eta).toBe('2026-08-28T09:25:00.000Z');
    expect(out.every((s) => s.driver_specified === false)).toBe(true);
  });

  it('prefers a driver-entered time over the computed one', () => {
    const out = resolveStopEtas(DEP, [stop('A', '2026-08-28T09:20:00.000Z')], [600]);
    expect(out[0].eta).toBe('2026-08-28T09:20:00.000Z');
    expect(out[0].driver_specified).toBe(true);
  });

  it('re-anchors later stops on a driver-entered time', () => {
    // Driver says they will be at A at 09:30, not the computed 09:10. B is then
    // 15 minutes after 09:30 — not 15 minutes after the original estimate.
    const out = resolveStopEtas(
      DEP,
      [stop('A', '2026-08-28T09:30:00.000Z'), stop('B')],
      [600, 900]
    );
    expect(out[0].eta).toBe('2026-08-28T09:30:00.000Z');
    expect(out[1].eta).toBe('2026-08-28T09:45:00.000Z');
    expect(out[1].driver_specified).toBe(false);
  });

  it('returns null etas rather than guessing when Google is unavailable', () => {
    const out = resolveStopEtas(DEP, [stop('A'), stop('B')], null);
    expect(out.map((s) => s.eta)).toEqual([null, null]);
  });

  it('still honours driver times when Google is unavailable', () => {
    const out = resolveStopEtas(DEP, [stop('A', '2026-08-28T09:20:00.000Z'), stop('B')], null);
    expect(out[0].eta).toBe('2026-08-28T09:20:00.000Z');
    expect(out[1].eta).toBeNull(); // no legs to project forward with
  });

  it('does not crash on an unparseable departure', () => {
    const out = resolveStopEtas('not-a-date', [stop('A')], [600]);
    expect(out[0].eta).toBeNull();
  });

  it('ignores leg data that is shorter than the stop list', () => {
    const out = resolveStopEtas(DEP, [stop('A'), stop('B')], [600]);
    expect(out.map((s) => s.eta)).toEqual([null, null]);
  });
});

describe('minutesUntil', () => {
  it('counts forward and backward', () => {
    const now = new Date('2026-08-28T09:00:00.000Z');
    expect(minutesUntil('2026-08-28T09:30:00.000Z', now)).toBe(30);
    expect(minutesUntil('2026-08-28T08:45:00.000Z', now)).toBe(-15);
  });

  it('returns null for an unusable time', () => {
    expect(minutesUntil(null)).toBeNull();
    expect(minutesUntil('nope')).toBeNull();
  });
});

describe('needsBoardingReminder', () => {
  const now = new Date('2026-08-28T09:00:00.000Z');
  const inMinutes = (m: number) => new Date(now.getTime() + m * 60000).toISOString();

  it('fires around the 30-minute mark', () => {
    expect(needsBoardingReminder(inMinutes(BOARDING_REMINDER_MINUTES), false, now)).toBe(true);
    expect(needsBoardingReminder(inMinutes(25), false, now)).toBe(true);
    expect(needsBoardingReminder(inMinutes(35), false, now)).toBe(true);
  });

  it('does not fire outside the window', () => {
    expect(needsBoardingReminder(inMinutes(60), false, now)).toBe(false);
    expect(needsBoardingReminder(inMinutes(5), false, now)).toBe(false);
    expect(needsBoardingReminder(inMinutes(-10), false, now)).toBe(false);
  });

  it('never repeats once sent', () => {
    expect(needsBoardingReminder(inMinutes(30), true, now)).toBe(false);
  });

  it('is a no for a stop with no eta', () => {
    expect(needsBoardingReminder(null, false, now)).toBe(false);
  });
});
