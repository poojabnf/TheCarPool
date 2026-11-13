/**
 * Stalled-vehicle detection for an in-progress ride.
 *
 * A car that sits within STALL_RADIUS_M of one spot for STALL_AFTER_MS while
 * a trip is running is either in a jam or something is wrong. Riders get one
 * check-in push per stall; moving away re-arms it. Pure, so it is testable.
 */
export const STALL_RADIUS_M = 60;
export const STALL_AFTER_MS = 10 * 60 * 1000;

export interface StallState { lat: number; lng: number; since: number; alerted: boolean }

export function nextStallState(
  prev: StallState | undefined,
  lat: number,
  lng: number,
  now: number,
  distanceM: (lat1: number, lng1: number, lat2: number, lng2: number) => number
): { state: StallState; shouldAlert: boolean } {
  if (!prev || distanceM(prev.lat, prev.lng, lat, lng) > STALL_RADIUS_M) {
    return { state: { lat, lng, since: now, alerted: false }, shouldAlert: false };
  }
  if (!prev.alerted && now - prev.since >= STALL_AFTER_MS) {
    return { state: { ...prev, alerted: true }, shouldAlert: true };
  }
  return { state: prev, shouldAlert: false };
}
