import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const COGNITO_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const REGION = process.env.AWS_REGION ?? 'ap-southeast-3';
const JWKS_URI = `https://cognito-idp.${REGION}.amazonaws.com/${COGNITO_POOL_ID}/.well-known/jwks.json`;

const client = jwksClient({ jwksUri: JWKS_URI, cache: true, cacheMaxAge: 3600000 });

declare module 'fastify' {
  interface FastifyRequest {
    auth: {
      userId: string;
      email: string;
      roles: string[];
      tenantIds: string[];
      givenName: string;
    };
  }
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return reply.code(401).send({ error: 'Missing token' });
  try {
    const decoded = jwt.decode(token, { complete: true }) as any;
    if (!decoded) return reply.code(401).send({ error: 'Invalid token' });
    const key = await client.getSigningKey(decoded.header.kid);
    const verified = jwt.verify(token, key.getPublicKey()) as any;
    const tenantIdsRaw = verified['custom:tenant_ids'] ?? '';
    const tenantIds = tenantIdsRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
    const groups: string[] = verified['cognito:groups'] ?? [];
    req.auth = {
      userId: verified.sub,
      email: verified.email ?? '',
      roles: groups,
      tenantIds,
      givenName: verified.given_name ?? '',
    };
  } catch {
    return reply.code(401).send({ error: 'Invalid token' });
  }
}

export function assertTenantAccess(auth: FastifyRequest['auth'], tenantId: string) {
  if (auth.roles.includes('admin') || auth.tenantIds.includes(tenantId)) return;
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}
