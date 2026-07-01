import pg from "pg";
export declare function writeAuditLog(client: pg.PoolClient, params: {
    tenantId: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    changes?: Record<string, unknown>;
}): Promise<void>;
