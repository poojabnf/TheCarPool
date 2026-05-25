import { FastifyRequest, FastifyReply } from 'fastify';
import * as jwt from 'jsonwebtoken';

// Extend FastifyRequest to include user object
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: number;
      role: string;
    };
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized: Missing or invalid authorization token.' });
    }

    const token = authHeader.split(' ')[1];
    
    // For production, this should verify against Firebase Admin SDK or Clerk JWKS.
    // As a generic implementation, we use a secret.
    const secret = process.env.JWT_SECRET || 'thecarpool_jwt_secret_dev_only';
    
    // Attempt verification (if it's a signed JWT)
    // Note: In development or if using mock tokens, we can fallback to extracting payload
    const decoded = jwt.verify(token, secret) as any;
    
    // Attach the user to the request
    request.user = {
      id: parseInt(decoded.sub || decoded.uid || decoded.user_id, 10),
      role: decoded.role || 'USER'
    };

  } catch (err: any) {
    request.log.error('Authentication failed:', err.message);
    return reply.code(401).send({ error: 'Unauthorized: Invalid token.' });
  }
}
