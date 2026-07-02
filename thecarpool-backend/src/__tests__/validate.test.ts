import { z } from 'zod';
import { parseOrReply } from '../lib/validate';

// Minimal FastifyReply stub capturing what was sent.
function replyStub() {
  const calls: { code?: number; body?: any } = {};
  const reply: any = {
    code(c: number) { calls.code = c; return reply; },
    send(b: any) { calls.body = b; return reply; },
  };
  return { reply, calls };
}

const Schema = z.object({
  ride_id: z.string().min(1),
  seats_booked: z.number().int().positive(),
});

describe('parseOrReply', () => {
  test('returns typed data for a valid body', () => {
    const { reply } = replyStub();
    const out = parseOrReply(Schema, { ride_id: 'r1', seats_booked: 2 }, reply);
    expect(out).toEqual({ ride_id: 'r1', seats_booked: 2 });
  });

  test('sends 400 with field details for an invalid body', () => {
    const { reply, calls } = replyStub();
    const out = parseOrReply(Schema, { ride_id: '', seats_booked: -1 }, reply);
    expect(out).toBeNull();
    expect(calls.code).toBe(400);
    expect(calls.body.error).toBe('Validation failed');
    const paths = calls.body.details.map((d: any) => d.path);
    expect(paths).toContain('ride_id');
    expect(paths).toContain('seats_booked');
  });

  test('rejects wrong types (string where number expected)', () => {
    const { reply, calls } = replyStub();
    const out = parseOrReply(Schema, { ride_id: 'r1', seats_booked: '2' }, reply);
    expect(out).toBeNull();
    expect(calls.code).toBe(400);
  });

  test('rejects null/undefined bodies', () => {
    const { reply, calls } = replyStub();
    expect(parseOrReply(Schema, undefined, reply)).toBeNull();
    expect(calls.code).toBe(400);
  });
});
