import { FastifyReply } from 'fastify';
import { ZodSchema } from 'zod';

/**
 * Validate `data` against a Zod schema. On success returns the parsed,
 * typed value. On failure, sends a 400 with field-level details and returns
 * null — callers should `return` immediately when null is returned.
 *
 *   const body = parseOrReply(MySchema, request.body, reply);
 *   if (!body) return;
 */
export function parseOrReply<T>(schema: ZodSchema<T>, data: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.code(400).send({
      error: 'Validation failed',
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return null;
  }
  return result.data;
}
