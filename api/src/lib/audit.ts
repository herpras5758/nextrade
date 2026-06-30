import pg from "pg";

// "Audit First" enterprise quality standard (no exceptions, per the
// vision doc) — one helper, called from every route that mutates data,
// instead of routes remembering to log individually.

export async function writeAuditLog(
  client: pg.PoolClient,
  params: {
    tenantId: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    changes?: Record<string, unknown>;
  }
) {
  await client.query(
    `INSERT INTO audit_log (tenant_id, actor_id, action, entity_type, entity_id, changes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.tenantId,
      params.actorId,
      params.action,
      params.entityType,
      params.entityId,
      params.changes ? JSON.stringify(params.changes) : null,
    ]
  );
}
