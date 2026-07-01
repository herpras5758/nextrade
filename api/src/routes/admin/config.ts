import { FastifyInstance } from 'fastify';
import { withTenant } from '../../db/pool.js';
import { assertTenantAccess, requireRole } from '../../middleware/auth.js';
import { EvidenceWriter } from '../../../../lambda/shared/evidence/index.js';

// Admin Configuration Routes
// All endpoints require 'admin' role (Rule #7: tenant isolation + RBAC).
// Every config change writes a CONFIG_CHANGED evidence event before updating the projection.

export async function adminConfigRoutes(app: FastifyInstance) {

  // ── AI Engine Config ────────────────────────────────────────────────────────
  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/admin/ai-config',
    async (req, reply) => {
      assertTenantAccess(req.auth!, req.params.tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(req.params.tenantId, async (client) => {
        const { rows: [cfg] } = await client.query(
          `SELECT * FROM tenant_ai_config WHERE tenant_id = $1`,
          [req.params.tenantId]
        );
        // Return defaults if not configured yet
        return cfg ?? {
          bedrock_model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          max_tokens: 4096, temperature: 0.1,
          threshold_auto_approved: 0.850, threshold_recommended: 0.700,
          ceisa_mode: 'mock', ceisa_endpoint: null, ceisa_api_key: null,
        };
      });
    }
  );

  app.put<{ Params: { tenantId: string }; Body: any }>(
    '/tenants/:tenantId/admin/ai-config',
    async (req, reply) => {
      const { tenantId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(tenantId, async (client) => {
        const writer = new EvidenceWriter(client);
        const evt = await writer.writeEvent({
          tenantId, eventTime: new Date(), eventType: 'CONFIG_CHANGED',
          producerType: 'USER', producerRef: req.auth!.sub,
          entityType: 'CONFIG',
          payload: { config_section: 'ai_engine', changes: req.body },
        });
        const { rows: [cfg] } = await client.query(
          `INSERT INTO tenant_ai_config
             (tenant_id, bedrock_model_id, max_tokens, temperature,
              threshold_auto_approved, threshold_recommended,
              ceisa_mode, ceisa_endpoint, ceisa_api_key, last_event_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (tenant_id) DO UPDATE SET
             bedrock_model_id = EXCLUDED.bedrock_model_id,
             max_tokens = EXCLUDED.max_tokens,
             temperature = EXCLUDED.temperature,
             threshold_auto_approved = EXCLUDED.threshold_auto_approved,
             threshold_recommended = EXCLUDED.threshold_recommended,
             ceisa_mode = EXCLUDED.ceisa_mode,
             ceisa_endpoint = EXCLUDED.ceisa_endpoint,
             ceisa_api_key = EXCLUDED.ceisa_api_key,
             updated_at = NOW(), last_event_id = EXCLUDED.last_event_id
           RETURNING *`,
          [
            tenantId,
            req.body.bedrock_model_id, req.body.max_tokens, req.body.temperature,
            req.body.threshold_auto_approved, req.body.threshold_recommended,
            req.body.ceisa_mode, req.body.ceisa_endpoint ?? null,
            req.body.ceisa_api_key ?? null, evt.id,
          ]
        );
        return cfg;
      });
    }
  );

  // ── Signal Weights ──────────────────────────────────────────────────────────
  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/admin/signal-weights',
    async (req, reply) => {
      assertTenantAccess(req.auth!, req.params.tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(req.params.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM tenant_signal_weights
           WHERE tenant_id = $1 AND is_active = true
           ORDER BY weight DESC`,
          [req.params.tenantId]
        );
        return rows;
      });
    }
  );

  app.put<{ Params: { tenantId: string }; Body: { weights: any[] } }>(
    '/tenants/:tenantId/admin/signal-weights',
    async (req, reply) => {
      const { tenantId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(tenantId, async (client) => {
        const writer = new EvidenceWriter(client);
        await writer.writeEvent({
          tenantId, eventTime: new Date(), eventType: 'CONFIG_CHANGED',
          producerType: 'USER', producerRef: req.auth!.sub,
          entityType: 'CONFIG',
          payload: { config_section: 'signal_weights', signal_count: req.body.weights.length },
        });
        // Upsert each weight
        for (const w of req.body.weights) {
          await client.query(
            `INSERT INTO tenant_signal_weights
               (tenant_id, signal_type, weight, normalizer, match_strategy,
                fuzzy_threshold, tolerance_pct, tolerance_days, min_confidence_to_include)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (tenant_id, signal_type) DO UPDATE SET
               weight = EXCLUDED.weight,
               normalizer = EXCLUDED.normalizer,
               match_strategy = EXCLUDED.match_strategy,
               fuzzy_threshold = EXCLUDED.fuzzy_threshold,
               tolerance_pct = EXCLUDED.tolerance_pct,
               tolerance_days = EXCLUDED.tolerance_days,
               min_confidence_to_include = EXCLUDED.min_confidence_to_include,
               updated_at = NOW()`,
            [tenantId, w.signal_type, w.weight, w.normalizer, w.match_strategy,
             w.fuzzy_threshold ?? null, w.tolerance_pct ?? null,
             w.tolerance_days ?? null, w.min_confidence_to_include]
          );
        }
        return { updated: req.body.weights.length };
      });
    }
  );

  // ── Validation Rules ────────────────────────────────────────────────────────
  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/admin/validation-rules',
    async (req, reply) => {
      assertTenantAccess(req.auth!, req.params.tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(req.params.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM tenant_validation_rules
           WHERE tenant_id = $1 ORDER BY rule_type, field_key`,
          [req.params.tenantId]
        );
        return rows;
      });
    }
  );

  app.post<{ Params: { tenantId: string }; Body: any }>(
    '/tenants/:tenantId/admin/validation-rules',
    async (req, reply) => {
      const { tenantId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(tenantId, async (client) => {
        const writer = new EvidenceWriter(client);
        const evt = await writer.writeEvent({
          tenantId, eventTime: new Date(), eventType: 'CONFIG_CHANGED',
          producerType: 'USER', producerRef: req.auth!.sub,
          entityType: 'CONFIG',
          payload: { config_section: 'validation_rules', rule_code: req.body.rule_code },
        });
        const { rows: [rule] } = await client.query(
          `INSERT INTO tenant_validation_rules
             (tenant_id, rule_code, rule_type, field_key, description, config, severity, last_event_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (tenant_id, rule_code) DO UPDATE SET
             rule_type = EXCLUDED.rule_type, field_key = EXCLUDED.field_key,
             description = EXCLUDED.description, config = EXCLUDED.config,
             severity = EXCLUDED.severity, updated_at = NOW(), last_event_id = EXCLUDED.last_event_id
           RETURNING *`,
          [tenantId, req.body.rule_code, req.body.rule_type, req.body.field_key ?? null,
           req.body.description, JSON.stringify(req.body.config), req.body.severity ?? 'ERROR', evt.id]
        );
        return rule;
      });
    }
  );

  app.delete<{ Params: { tenantId: string; ruleId: string } }>(
    '/tenants/:tenantId/admin/validation-rules/:ruleId',
    async (req, reply) => {
      const { tenantId, ruleId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(tenantId, async (client) => {
        await client.query(
          `UPDATE tenant_validation_rules SET is_active = false WHERE id = $1 AND tenant_id = $2`,
          [ruleId, tenantId]
        );
        return { deleted: true };
      });
    }
  );

  // ── ERP Config ──────────────────────────────────────────────────────────────
  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/admin/erp-config',
    async (req, reply) => {
      assertTenantAccess(req.auth!, req.params.tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(req.params.tenantId, async (client) => {
        const { rows: [cfg] } = await client.query(
          `SELECT id, erp_type, endpoint_url, auth_type, field_mappings, is_active, last_sync_at
           FROM tenant_erp_config WHERE tenant_id = $1`,
          [req.params.tenantId]
        );
        return cfg ?? null;
      });
    }
  );

  app.put<{ Params: { tenantId: string }; Body: any }>(
    '/tenants/:tenantId/admin/erp-config',
    async (req, reply) => {
      const { tenantId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(tenantId, async (client) => {
        const writer = new EvidenceWriter(client);
        const evt = await writer.writeEvent({
          tenantId, eventTime: new Date(), eventType: 'CONFIG_CHANGED',
          producerType: 'USER', producerRef: req.auth!.sub,
          entityType: 'CONFIG',
          payload: { config_section: 'erp_config', erp_type: req.body.erp_type },
        });
        const { rows: [cfg] } = await client.query(
          `INSERT INTO tenant_erp_config
             (tenant_id, erp_type, endpoint_url, auth_type, credentials, field_mappings, is_active, last_event_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (tenant_id) DO UPDATE SET
             erp_type = EXCLUDED.erp_type, endpoint_url = EXCLUDED.endpoint_url,
             auth_type = EXCLUDED.auth_type, credentials = EXCLUDED.credentials,
             field_mappings = EXCLUDED.field_mappings, is_active = EXCLUDED.is_active,
             updated_at = NOW(), last_event_id = EXCLUDED.last_event_id
           RETURNING id, erp_type, endpoint_url, auth_type, field_mappings, is_active`,
          [tenantId, req.body.erp_type, req.body.endpoint_url, req.body.auth_type,
           JSON.stringify(req.body.credentials ?? {}),
           JSON.stringify(req.body.field_mappings ?? {}),
           req.body.is_active ?? false, evt.id]
        );
        return cfg;
      });
    }
  );

  // ── BC Type Access ──────────────────────────────────────────────────────────
  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/admin/bc-access',
    async (req, reply) => {
      assertTenantAccess(req.auth!, req.params.tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(req.params.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM tenant_bc_access WHERE tenant_id = $1 ORDER BY bc_type`,
          [req.params.tenantId]
        );
        // Return all BC types with enabled status
        const allTypes = ['BC_2_0','BC_2_3','BC_2_5','BC_2_6_1','BC_2_6_2','BC_3_0','BC_4_0','BC_4_1'];
        const enabledMap = new Map(rows.map((r: any) => [r.bc_type, r]));
        return allTypes.map(t => enabledMap.get(t) ?? { bc_type: t, is_enabled: false, config: {} });
      });
    }
  );

  app.put<{ Params: { tenantId: string }; Body: { bc_type: string; is_enabled: boolean; config?: any } }>(
    '/tenants/:tenantId/admin/bc-access',
    async (req, reply) => {
      const { tenantId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(tenantId, async (client) => {
        const { rows: [row] } = await client.query(
          `INSERT INTO tenant_bc_access (tenant_id, bc_type, is_enabled, config)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id, bc_type) DO UPDATE SET
             is_enabled = EXCLUDED.is_enabled, config = EXCLUDED.config
           RETURNING *`,
          [tenantId, req.body.bc_type, req.body.is_enabled, JSON.stringify(req.body.config ?? {})]
        );
        return row;
      });
    }
  );

  // ── Learning Corrections Review ─────────────────────────────────────────────
  app.get<{ Params: { tenantId: string } }>(
    '/tenants/:tenantId/admin/learning-corrections',
    async (req, reply) => {
      assertTenantAccess(req.auth!, req.params.tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(req.params.tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT lc.*, lcr.status as review_status, lcr.reviewed_by, lcr.reviewed_at
           FROM learning_corrections lc
           LEFT JOIN learning_correction_reviews lcr ON lcr.correction_id = lc.id
           WHERE lc.tenant_id = $1
           ORDER BY lc.created_at DESC LIMIT 100`,
          [req.params.tenantId]
        );
        return rows;
      });
    }
  );

  app.post<{ Params: { tenantId: string; correctionId: string }; Body: { action: 'APPROVE' | 'REJECT'; notes?: string } }>(
    '/tenants/:tenantId/admin/learning-corrections/:correctionId/review',
    async (req, reply) => {
      const { tenantId, correctionId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      requireRole(req.auth!, 'admin');
      return withTenant(tenantId, async (client) => {
        const { rows: [review] } = await client.query(
          `INSERT INTO learning_correction_reviews
             (tenant_id, correction_id, status, reviewed_by, reviewed_at, notes)
           VALUES ($1,$2,$3,$4,NOW(),$5)
           ON CONFLICT (correction_id) DO UPDATE SET
             status = EXCLUDED.status, reviewed_by = EXCLUDED.reviewed_by,
             reviewed_at = NOW(), notes = EXCLUDED.notes
           RETURNING *`,
          [tenantId, correctionId, req.body.action, req.auth!.sub, req.body.notes ?? null]
        );
        return review;
      });
    }
  );

  // ── Evidence Timeline ───────────────────────────────────────────────────────
  app.get<{ Params: { tenantId: string }; Querystring: { entity_id?: string; from?: string; to?: string; limit?: string } }>(
    '/tenants/:tenantId/admin/evidence-timeline',
    async (req, reply) => {
      assertTenantAccess(req.auth!, req.params.tenantId);
      const { entity_id, from, to, limit = '50' } = req.query;
      return withTenant(req.params.tenantId, async (client) => {
        let q = `SELECT id, event_time, created_at, event_type, producer_type,
                        producer_ref, entity_type, entity_id, payload, sequence_num
                 FROM evidence_events
                 WHERE tenant_id = $1`;
        const params: any[] = [req.params.tenantId];
        if (entity_id) { params.push(entity_id); q += ` AND entity_id = $${params.length}`; }
        if (from) { params.push(from); q += ` AND event_time >= $${params.length}`; }
        if (to)   { params.push(to);   q += ` AND event_time <= $${params.length}`; }
        params.push(Math.min(parseInt(limit), 200));
        q += ` ORDER BY event_time DESC, sequence_num DESC LIMIT $${params.length}`;
        const { rows } = await client.query(q, params);
        return rows;
      });
    }
  );

  // ── Document Categories (read-only for now — seeded from YAML) ──────────────
  app.get('/admin/document-categories', async () => {
    return withTenant('system', async (client) => {
      const { rows } = await client.query(`SELECT * FROM document_categories ORDER BY sort_order`);
      return rows;
    }).catch(() => []);
  });
}
