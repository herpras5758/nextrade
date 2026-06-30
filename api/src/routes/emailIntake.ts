import { FastifyInstance } from "fastify";
import { withTenant } from "../db/pool.js";
import { assertTenantAccess, requireRole } from "../middleware/auth.js";
import { INTAKE_SOURCES } from "../lib/intakeSources.js";

export async function emailIntakeRoutes(app: FastifyInstance) {
  // GET /intake-sources — the full registry (Rule #4 config-driven list)
  // an admin's Settings → Integrations page renders from. No tenant
  // scoping needed here; this describes what the PLATFORM supports, not
  // tenant-specific data.
  app.get("/intake-sources", async () => INTAKE_SOURCES);

  // GET /tenants/:tenantId/documents/source-summary — counts documents
  // by intake_source for this tenant, answering "where is our document
  // volume actually coming from" at a glance.
  app.get<{ Params: { tenantId: string } }>(
    "/tenants/:tenantId/documents/source-summary",
    async (request, reply) => {
      const { tenantId } = request.params;
      assertTenantAccess(request.auth!, tenantId);
      return withTenant(tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT intake_source, COUNT(*) AS document_count
           FROM documents WHERE tenant_id = $1 GROUP BY intake_source`,
          [tenantId]
        );
        return rows;
      });
    }
  );

  // GET /tenants/:tenantId/email-intake-config
  app.get<{ Params: { tenantId: string } }>("/tenants/:tenantId/email-intake-config", async (request, reply) => {
    const { tenantId } = request.params;
    assertTenantAccess(request.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, intake_address, allowed_senders, is_active FROM email_intake_config WHERE tenant_id = $1`,
        [tenantId]
      );
      return rows[0] ?? null;
    });
  });

  // PUT /tenants/:tenantId/email-intake-config — admin-only (this
  // controls the allowlist that IS the security boundary for the entire
  // email intake path; only admin role can touch it).
  app.put<{
    Params: { tenantId: string };
    Body: { intakeAddress: string; allowedSenders: string[]; isActive: boolean };
  }>(
    "/tenants/:tenantId/email-intake-config",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const { tenantId } = request.params;
      assertTenantAccess(request.auth!, tenantId);
      const { intakeAddress, allowedSenders, isActive } = request.body;

      return withTenant(tenantId, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO email_intake_config (tenant_id, intake_address, allowed_senders, is_active)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id) DO UPDATE SET
             intake_address = EXCLUDED.intake_address,
             allowed_senders = EXCLUDED.allowed_senders,
             is_active = EXCLUDED.is_active
           RETURNING id, intake_address, allowed_senders, is_active`,
          [tenantId, intakeAddress.toLowerCase(), allowedSenders.map((s) => s.toLowerCase()), isActive]
        );
        return rows[0];
      });
    }
  );

  // GET /tenants/:tenantId/email-intake-log — audit trail, including
  // rejected attempts (important for spotting probing/spoofing attempts
  // against the intake address).
  app.get<{ Params: { tenantId: string } }>("/tenants/:tenantId/email-intake-log", async (request, reply) => {
    const { tenantId } = request.params;
    assertTenantAccess(request.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, sender_address, subject, status, attachment_count, received_at
         FROM email_intake_log WHERE tenant_id = $1 ORDER BY received_at DESC LIMIT 100`,
        [tenantId]
      );
      return rows;
    });
  });
}
