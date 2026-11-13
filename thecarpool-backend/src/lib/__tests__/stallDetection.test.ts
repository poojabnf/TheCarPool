import { nextStallState, STALL_AFTER_MS } from '../stallDetection';

const flat = (a: number, b: number, c: number, d: number) => Math.hypot(a - c, b - d) * 111_000;

describe('nextStallState', () => {
  it('alerts once after sitting still long enough', () => {
    let s = nextStallState(undefined, 28.5, 77.1, 0, flat).state;
    const mid = nextStallState(s, 28.5, 77.1, STALL_AFTER_MS - 1, flat);
    expect(mid.shouldAlert).toBe(false);
    const hit = nextStallState(mid.state, 28.5, 77.1, STALL_AFTER_MS, flat);
    expect(hit.shouldAlert).toBe(true);
    expect(nextStallState(hit.state, 28.5, 77.1, STALL_AFTER_MS * 2, flat).shouldAlert).toBe(false);
  });
  it('re-arms when the car moves', () => {
    const s = nextStallState({ lat: 28.5, lng: 77.1, since: 0, alerted: true }, 28.51, 77.1, 5, flat);
    expect(s.state.alerted).toBe(false);
    expect(s.state.since).toBe(5);
  });
});
