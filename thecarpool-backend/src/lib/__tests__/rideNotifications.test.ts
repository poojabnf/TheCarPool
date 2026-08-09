// Jest is the project test runner; describe/it/expect are globals.
import {
  needsDepartureReminder,
  minutesUntil,
  isArrivingAtPickup,
  metresBetween,
  DEPARTURE_REMINDER_MS,
} from '../rideNotifications';

const NOW = new Date('2026-08-10T09:00:00Z');
const at = (msFromNow: number) => new Date(NOW.getTime() + msFromNow).toISOString();

describe('needsDepartureReminder', () => {
  it('fires when departure is within the hour', () => {
    expect(needsDepartureReminder({ departure_time: at(55 * 60000), status: 'SCHEDULED' }, NOW)).toBe(true);
    expect(needsDepartureReminder({ departure_time: at(DEPARTURE_REMINDER_MS), status: 'SCHEDULED' }, NOW)).toBe(true);
  });

  it('does not fire more than an hour out', () => {
    expect(needsDepartureReminder({ departure_time: at(90 * 60000), status: 'SCHEDULED' }, NOW)).toBe(false);
  });

  it('does not fire twice', () => {
    const ride = { departure_time: at(50 * 60000), status: 'SCHEDULED', departure_reminder_sent: true };
    expect(needsDepartureReminder(ride, NOW)).toBe(false);
  });

  it('skips a reminder that has become useless', () => {
    // A sweep that drifted should not tell someone their ride leaves in 5
    // minutes — that is worse than saying nothing.
    expect(needsDepartureReminder({ departure_time: at(5 * 60000), status: 'SCHEDULED' }, NOW)).toBe(false);
  });

  it('ignores rides that are not scheduled', () => {
    for (const status of ['STARTED', 'COMPLETED', 'CANCELLED']) {
      expect(needsDepartureReminder({ departure_time: at(50 * 60000), status }, NOW)).toBe(false);
    }
  });

  it('ignores a missing or unparseable departure time', () => {
    expect(needsDepartureReminder({ departure_time: null, status: 'SCHEDULED' }, NOW)).toBe(false);
    expect(needsDepartureReminder({ departure_time: 'soon', status: 'SCHEDULED' }, NOW)).toBe(false);
    expect(needsDepartureReminder({}, NOW)).toBe(false);
  });

  it('ignores a departure already in the past', () => {
    expect(needsDepartureReminder({ departure_time: at(-10 * 60000), status: 'SCHEDULED' }, NOW)).toBe(false);
  });
});

describe('minutesUntil', () => {
  it('rounds to whole minutes', () => {
    expect(minutesUntil(at(50 * 60000), NOW)).toBe(50);
    expect(minutesUntil(at(59 * 60000 + 40000), NOW)).toBe(60);
  });

  it('never goes negative', () => {
    expect(minutesUntil(at(-30 * 60000), NOW)).toBe(0);
    expect(minutesUntil('rubbish', NOW)).toBe(0);
  });
});

describe('metresBetween', () => {
  it('measures a known short distance', () => {
    // ~111m per 0.001 degree of latitude.
    expect(Math.round(metresBetween(28.4200, 77.0800, 28.4210, 77.0800))).toBeGreaterThan(100);
    expect(Math.round(metresBetween(28.4200, 77.0800, 28.4210, 77.0800))).toBeLessThan(120);
  });

  it('is zero for the same point', () => {
    expect(metresBetween(28.42, 77.08, 28.42, 77.08)).toBe(0);
  });
});

describe('isArrivingAtPickup', () => {
  const driver = { lat: 28.4200, lng: 77.0800 };

  it('is true when the driver is within the radius', () => {
    expect(isArrivingAtPickup(driver, { lat: 28.4210, lng: 77.0800 })).toBe(true);
  });

  it('is false when still far away', () => {
    expect(isArrivingAtPickup(driver, { lat: 28.4600, lng: 77.0800 })).toBe(false);
  });

  it('treats (0,0) as missing, not as a real place', () => {
    // A malformed pickup point must not make every driver "arriving".
    expect(isArrivingAtPickup(driver, { lat: 0, lng: 0 })).toBe(false);
  });

  it('is false on missing or unusable coordinates', () => {
    expect(isArrivingAtPickup(driver, null)).toBe(false);
    expect(isArrivingAtPickup(driver, {})).toBe(false);
    expect(isArrivingAtPickup(driver, { lat: 28.42, lng: null })).toBe(false);
    expect(isArrivingAtPickup({ lat: NaN, lng: 77 } as any, { lat: 28.42, lng: 77.08 })).toBe(false);
  });

  it('respects a custom radius', () => {
    expect(isArrivingAtPickup(driver, { lat: 28.4210, lng: 77.0800 }, 50)).toBe(false);
  });
});
