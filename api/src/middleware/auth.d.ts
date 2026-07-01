import { FastifyRequest, FastifyReply } from "fastify";
export interface AuthContext {
    userId: string;
    email: string;
    tenantIds: string[];
    roles: string[];
    preferredLang: "id" | "en";
}
declare module "fastify" {
    interface FastifyRequest {
        auth?: AuthContext;
    }
}
export declare function verifyAuth(request: FastifyRequest, reply: FastifyReply): Promise<any>;
/** Route guard factory — e.g. requireRole("admin", "compliance_officer") */
export declare function requireRole(...allowed: string[]): (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
/** Asserts the requested tenantId is one the authenticated user can access. */
export declare function assertTenantAccess(auth: AuthContext, tenantId: string): void;
