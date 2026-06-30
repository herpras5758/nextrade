import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { FastifyRequest, FastifyReply } from "fastify";

// Verifies Cognito-issued JWTs and attaches { userId, tenantIds, roles,
// preferredLang } to the request. This is the single authorization
// checkpoint every route passes through — RBAC (which Cognito Group the
// user belongs to) and tenant scope (Rule #7) both come from claims in
// the verified token, never from a client-supplied header or body field
// that could be forged.

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const REGION = process.env.AWS_REGION_CORE ?? "ap-southeast-3";
const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;

const client = jwksClient({
  jwksUri: `${issuer}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 12 * 60 * 60 * 1000,
});

function getSigningKey(kid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.getSigningKey(kid, (err, key) => {
      if (err || !key) return reject(err ?? new Error("No signing key found"));
      resolve(key.getPublicKey());
    });
  });
}

export interface AuthContext {
  userId: string;
  email: string;
  tenantIds: string[];
  roles: string[]; // Cognito Groups: operator | compliance_officer | finance | executive | admin
  preferredLang: "id" | "en";
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function verifyAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing bearer token" });
  }

  const token = authHeader.slice("Bearer ".length);
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string") {
    return reply.code(401).send({ error: "Invalid token" });
  }

  try {
    const signingKey = await getSigningKey(decoded.header.kid!);
    const payload = jwt.verify(token, signingKey, { issuer }) as Record<string, any>;

    // Rule #7: tenant_ids is a custom attribute set by an admin at
    // provisioning time, never editable by the user themselves — see
    // AuthStack's customAttributes definition.
    const tenantIdsRaw: string = payload["custom:tenant_ids"] ?? "";

    request.auth = {
      userId: payload.sub,
      email: payload.email,
      tenantIds: tenantIdsRaw.split(",").filter(Boolean),
      roles: payload["cognito:groups"] ?? [],
      preferredLang: (payload["custom:preferred_lang"] as "id" | "en") ?? "id",
    };
  } catch (err) {
    return reply.code(401).send({ error: "Token verification failed" });
  }
}

/** Route guard factory — e.g. requireRole("admin", "compliance_officer") */
export function requireRole(...allowed: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
    const hasRole = request.auth.roles.some((r) => allowed.includes(r));
    if (!hasRole) {
      return reply.code(403).send({ error: `Requires one of: ${allowed.join(", ")}` });
    }
  };
}

/** Asserts the requested tenantId is one the authenticated user can access. */
export function assertTenantAccess(auth: AuthContext, tenantId: string) {
  if (!auth.tenantIds.includes(tenantId)) {
    throw Object.assign(new Error("Tenant access denied"), { statusCode: 403 });
  }
}
