import { FastifyInstance } from 'fastify';
import { withTenant } from '../lib/db.js';
import { assertTenantAccess } from '../middleware/auth.js';

export async function adminRoutes(app: FastifyInstance) {

  // ── AI Config ─────────────────────────────────────────────────────────────

  app.get('/tenants/:tenantId/admin/ai-config', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows: [cfg] } = await client.query(
        `SELECT ai_provider, extraction_model_id, extraction_max_tokens,
                classification_model_id, threshold_auto_approved, threshold_review_required,
                ceisa_mode, ceisa_endpoint,
                CASE WHEN anthropic_api_key IS NOT NULL THEN true ELSE false END as has_anthropic_key,
                CASE WHEN openai_api_key IS NOT NULL THEN true ELSE false END as has_openai_key
         FROM tenant_ai_config WHERE tenant_id=$1`,
        [tenantId]
      );
      return cfg ?? {};
    });
  });

  app.put('/tenants/:tenantId/admin/ai-config', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as any;

    return withTenant(tenantId, async (client) => {
      const { rows: [cfg] } = await client.query(
        `INSERT INTO tenant_ai_config
           (tenant_id, ai_provider, anthropic_api_key, openai_api_key,
            extraction_model_id, extraction_max_tokens, classification_model_id,
            threshold_auto_approved, threshold_review_required,
            ceisa_mode, ceisa_endpoint, ceisa_api_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id) DO UPDATE SET
           ai_provider=EXCLUDED.ai_provider,
           anthropic_api_key=COALESCE(EXCLUDED.anthropic_api_key, tenant_ai_config.anthropic_api_key),
           openai_api_key=COALESCE(EXCLUDED.openai_api_key, tenant_ai_config.openai_api_key),
           extraction_model_id=EXCLUDED.extraction_model_id,
           extraction_max_tokens=EXCLUDED.extraction_max_tokens,
           classification_model_id=EXCLUDED.classification_model_id,
           threshold_auto_approved=EXCLUDED.threshold_auto_approved,
           threshold_review_required=EXCLUDED.threshold_review_required,
           ceisa_mode=EXCLUDED.ceisa_mode,
           ceisa_endpoint=COALESCE(EXCLUDED.ceisa_endpoint, tenant_ai_config.ceisa_endpoint),
           ceisa_api_key=COALESCE(EXCLUDED.ceisa_api_key, tenant_ai_config.ceisa_api_key),
           updated_at=NOW()
         RETURNING ai_provider, extraction_model_id, ceisa_mode`,
        [tenantId, body.ai_provider ?? 'anthropic',
         body.anthropic_api_key ?? null, body.openai_api_key ?? null,
         body.extraction_model_id ?? 'claude-sonnet-4-6',
         body.extraction_max_tokens ?? 4096,
         body.classification_model_id ?? 'claude-sonnet-4-6',
         body.threshold_auto_approved ?? 0.85,
         body.threshold_review_required ?? 0.70,
         body.ceisa_mode ?? 'mock',
         body.ceisa_endpoint ?? null,
         body.ceisa_api_key ?? null]
      );

      await client.query(
        `INSERT INTO evidence_events (tenant_id, event_type, actor_type, actor_id, entity_type, payload)
         VALUES ($1,'CONFIG_CHANGED','user',$2,'TENANT',$3)`,
        [tenantId, req.auth!.userId, JSON.stringify({ section: 'ai_config' })]
      );

      return { success: true, config: cfg };
    });
  });

  // ── Doc Type Config ───────────────────────────────────────────────────────

  app.get('/tenants/:tenantId/admin/doc-types', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT dtc.*,
                COUNT(tfc.id) as field_count,
                SUM(CASE WHEN tfc.is_graph_signal THEN 1 ELSE 0 END) as graph_signal_count
         FROM tenant_doc_type_config dtc
         LEFT JOIN tenant_field_config tfc ON tfc.tenant_id=dtc.tenant_id AND tfc.doc_type_code=dtc.doc_type_code
         WHERE dtc.tenant_id=$1
         GROUP BY dtc.id
         ORDER BY dtc.sort_order`,
        [tenantId]
      );
      return { docTypes: rows };
    });
  });

  app.get('/tenants/:tenantId/admin/doc-types/:docTypeCode/fields', async (req, reply) => {
    const { tenantId, docTypeCode } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM tenant_field_config WHERE tenant_id=$1 AND doc_type_code=$2 ORDER BY sort_order`,
        [tenantId, docTypeCode]
      );
      return { fields: rows };
    });
  });

  app.put('/tenants/:tenantId/admin/doc-types/:docTypeCode/fields/:fieldKey', async (req, reply) => {
    const { tenantId, docTypeCode, fieldKey } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as any;

    return withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE tenant_field_config SET
           display_name=COALESCE($1, display_name),
           is_mandatory=COALESCE($2, is_mandatory),
           is_mandatory_ceisa=COALESCE($3, is_mandatory_ceisa),
           confidence_threshold=COALESCE($4, confidence_threshold),
           is_graph_signal=COALESCE($5, is_graph_signal),
           graph_entity_type=COALESCE($6, graph_entity_type),
           is_enabled=COALESCE($7, is_enabled)
         WHERE tenant_id=$8 AND doc_type_code=$9 AND field_key=$10`,
        [body.display_name, body.is_mandatory, body.is_mandatory_ceisa,
         body.confidence_threshold, body.is_graph_signal, body.graph_entity_type,
         body.is_enabled, tenantId, docTypeCode, fieldKey]
      );
      return { success: true };
    });
  });

  // ── Matching Rules ────────────────────────────────────────────────────────

  app.get('/tenants/:tenantId/admin/matching-rules', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM tenant_matching_rules WHERE tenant_id=$1 ORDER BY weight DESC`,
        [tenantId]
      );
      return { rules: rows };
    });
  });

  app.put('/tenants/:tenantId/admin/matching-rules/:entityType', async (req, reply) => {
    const { tenantId, entityType } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const { weight, is_required, is_enabled } = req.body as any;

    return withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE tenant_matching_rules SET
           weight=COALESCE($1, weight),
           is_required=COALESCE($2, is_required),
           is_enabled=COALESCE($3, is_enabled)
         WHERE tenant_id=$4 AND entity_type=$5`,
        [weight, is_required, is_enabled, tenantId, entityType]
      );
      return { success: true };
    });
  });

  // ── Dashboard Summary ─────────────────────────────────────────────────────

  app.get('/tenants/:tenantId/admin/summary', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const [docs, resolutions, shipments, recentDocs] = await Promise.all([
        client.query(
          `SELECT status, COUNT(*) as count FROM documents
           WHERE tenant_id=$1 AND is_split_child=false
           GROUP BY status`, [tenantId]
        ),
        client.query(
          `SELECT status, COUNT(*) as count FROM resolutions WHERE tenant_id=$1 GROUP BY status`, [tenantId]
        ),
        client.query(
          `SELECT status, COUNT(*) as count FROM shipments WHERE tenant_id=$1 GROUP BY status`, [tenantId]
        ),
        client.query(
          `SELECT id, file_name, doc_type, status, uploaded_at
           FROM documents WHERE tenant_id=$1 AND is_split_child=false
           ORDER BY uploaded_at DESC LIMIT 10`, [tenantId]
        ),
      ]);

      const docsByStatus = Object.fromEntries(docs.rows.map(r => [r.status, parseInt(r.count)]));
      const resByStatus = Object.fromEntries(resolutions.rows.map(r => [r.status, parseInt(r.count)]));
      const shipsByStatus = Object.fromEntries(shipments.rows.map(r => [r.status, parseInt(r.count)]));

      return {
        documents: {
          total: Object.values(docsByStatus).reduce((a: any, b: any) => a + b, 0),
          byStatus: docsByStatus,
          processing: (docsByStatus.classifying ?? 0) + (docsByStatus.extracting ?? 0) + (docsByStatus.normalizing ?? 0),
        },
        resolutions: {
          total: Object.values(resByStatus).reduce((a: any, b: any) => a + b, 0),
          byStatus: resByStatus,
        },
        shipments: {
          total: Object.values(shipsByStatus).reduce((a: any, b: any) => a + b, 0),
          byStatus: shipsByStatus,
        },
        recentDocuments: recentDocs.rows,
      };
    });
  });

  // ── Tenant Info ───────────────────────────────────────────────────────────

  app.get('/tenants/:tenantId', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows: [tenant] } = await client.query(
        `SELECT id, code, name, config FROM tenants WHERE id=$1`, [tenantId]
      );
      return tenant ?? reply.code(404).send({ error: 'Tenant not found' });
    });
  });

  // ── User Management ──────────────────────────────────────────────────────

  app.get('/tenants/:tenantId/admin/users', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    try {
      const { CognitoIdentityProviderClient, ListUsersCommand } = await import('@aws-sdk/client-cognito-identity-provider');
      const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION_CORE });
      const { Users } = await cognito.send(new ListUsersCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID!,
        Limit: 60,
      }));
      const users = (Users ?? []).map((u: any) => {
        const attrs: Record<string, string> = {};
        for (const a of (u.Attributes ?? [])) attrs[a.Name!] = a.Value!;
        const tenantIds = (attrs['custom:tenant_ids'] ?? '').split(',').filter(Boolean);
        if (!tenantIds.includes(tenantId)) return null;
        return {
          id: u.Username, email: attrs.email, given_name: attrs.given_name,
          role: attrs['custom:role'] ?? 'operator', enabled: u.Enabled,
        };
      }).filter(Boolean);
      return { users };
    } catch (e: any) { return { users: [], error: e.message }; }
  });

  app.post('/tenants/:tenantId/admin/users', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const { email, given_name, role } = req.body as any;
    if (!email) return reply.code(400).send({ error: 'Email required' });
    try {
      const { CognitoIdentityProviderClient, AdminCreateUserCommand } = await import('@aws-sdk/client-cognito-identity-provider');
      const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION_CORE });
      await cognito.send(new AdminCreateUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID!,
        Username: email, MessageAction: 'SUPPRESS',
        TemporaryPassword: `ShipX${Math.random().toString(36).slice(2,10)}!`,
        UserAttributes: [
          { Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' },
          { Name: 'given_name', Value: given_name ?? email.split('@')[0] },
          { Name: 'custom:tenant_ids', Value: tenantId },
          { Name: 'custom:role', Value: role ?? 'operator' },
        ],
      }));
      return { success: true, message: `User ${email} dibuat` };
    } catch (e: any) { return reply.code(400).send({ error: e.message }); }
  });

  app.put('/tenants/:tenantId', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    const body = req.body as any;
    return withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE tenants SET name=COALESCE($1,name), config=COALESCE($2::jsonb,config) WHERE id=$3`,
        [body.name ?? null, body.config ? JSON.stringify(body.config) : null, tenantId]
      );
      return { success: true };
    });
  });

  app.put('/tenants/:tenantId/admin/doc-types/:docTypeCode', async (req, reply) => {
    const { tenantId, docTypeCode } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    const { is_enabled } = req.body as any;
    return withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE tenant_doc_type_config SET is_enabled=$1 WHERE tenant_id=$2 AND doc_type_code=$3`,
        [is_enabled, tenantId, docTypeCode]
      );
      return { success: true };
    });
  });

}