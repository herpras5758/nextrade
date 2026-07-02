import { FastifyInstance } from 'fastify';
import { withTenant } from '../../db/pool.js';
import { assertTenantAccess } from '../../middleware/auth.js';
import { EvidenceWriter } from '../../../../lambda/shared/evidence/index.js';

export async function adminConfigRoutes(app: FastifyInstance) {

  // ── AI Engine Config ──────────────────────────────────────────────────────
  app.get('/tenants/:tenantId/admin/ai-config', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    return withTenant(tenantId, async (client) => {
      const { rows: [cfg] } = await client.query(
        `SELECT * FROM tenant_ai_config WHERE tenant_id = $1`, [tenantId]
      );
      return cfg ?? {
        bedrock_model_id: 'anthropic.claude-sonnet-4-6',
        max_tokens: 4096, temperature: 0.1,
        threshold_auto_approved: 0.850, threshold_recommended: 0.700,
        ceisa_mode: 'mock', ceisa_endpoint: null, ceisa_api_key: null,
      };
    });
  });

  app.put('/tenants/:tenantId/admin/ai-config', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as any;
    return withTenant(tenantId, async (client) => {
      const writer = new EvidenceWriter(client);
      const evt = await writer.writeEvent({
        tenantId, eventTime: new Date(), eventType: 'CONFIG_CHANGED',
        producerType: 'USER', producerRef: req.auth!.userId,
        entityType: 'CONFIG', payload: { config_section: 'ai_engine', changes: body },
      });
      const { rows: [cfg] } = await client.query(
        `INSERT INTO tenant_ai_config
           (tenant_id, bedrock_model_id, max_tokens, temperature,
            threshold_auto_approved, threshold_recommended,
            ceisa_mode, ceisa_endpoint, ceisa_api_key,
            ai_provider, openai_api_key, anthropic_api_key,
            extraction_model_id, extraction_max_tokens,
            last_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (tenant_id) DO UPDATE SET
           bedrock_model_id = EXCLUDED.bedrock_model_id,
           max_tokens = EXCLUDED.max_tokens,
           temperature = EXCLUDED.temperature,
           threshold_auto_approved = EXCLUDED.threshold_auto_approved,
           threshold_recommended = EXCLUDED.threshold_recommended,
           ceisa_mode = EXCLUDED.ceisa_mode,
           ceisa_endpoint = EXCLUDED.ceisa_endpoint,
           ceisa_api_key = EXCLUDED.ceisa_api_key,
           ai_provider = EXCLUDED.ai_provider,
           openai_api_key = EXCLUDED.openai_api_key,
           anthropic_api_key = EXCLUDED.anthropic_api_key,
           extraction_model_id = EXCLUDED.extraction_model_id,
           extraction_max_tokens = EXCLUDED.extraction_max_tokens,
           updated_at = NOW(), last_event_id = EXCLUDED.last_event_id
         RETURNING *`,
        [tenantId, body.bedrock_model_id, body.max_tokens, body.temperature,
         body.threshold_auto_approved, body.threshold_recommended,
         body.ceisa_mode, body.ceisa_endpoint ?? null,
         body.ceisa_api_key ?? null,
         body.ai_provider ?? 'openai',
         body.openai_api_key ?? null,
         body.anthropic_api_key ?? null,
         body.extraction_model_id ?? 'gpt-4o',
         body.extraction_max_tokens ?? 4096,
         evt.id]
      );
      return cfg;
    });
  });

  // ── Signal Weights ────────────────────────────────────────────────────────
  app.get('/tenants/:tenantId/admin/signal-weights', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM tenant_signal_weights WHERE tenant_id = $1 AND is_active = true ORDER BY weight DESC`,
        [tenantId]
      );
      return rows;
    });
  });

  app.put('/tenants/:tenantId/admin/signal-weights', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as { weights: any[] };
    return withTenant(tenantId, async (client) => {
      const writer = new EvidenceWriter(client);
      await writer.writeEvent({
        tenantId, eventTime: new Date(), eventType: 'CONFIG_CHANGED',
        producerType: 'USER', producerRef: req.auth!.userId,
        entityType: 'CONFIG', payload: { config_section: 'signal_weights', count: body.weights.length },
      });
      for (const w of body.weights) {
        await client.query(
          `INSERT INTO tenant_signal_weights
             (tenant_id, signal_type, weight, normalizer, match_strategy,
              fuzzy_threshold, tolerance_pct, tolerance_days, min_confidence_to_include)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id, signal_type) DO UPDATE SET
             weight = EXCLUDED.weight, normalizer = EXCLUDED.normalizer,
             match_strategy = EXCLUDED.match_strategy, fuzzy_threshold = EXCLUDED.fuzzy_threshold,
             tolerance_pct = EXCLUDED.tolerance_pct, tolerance_days = EXCLUDED.tolerance_days,
             min_confidence_to_include = EXCLUDED.min_confidence_to_include, updated_at = NOW()`,
          [tenantId, w.signal_type, w.weight, w.normalizer, w.match_strategy,
           w.fuzzy_threshold ?? null, w.tolerance_pct ?? null, w.tolerance_days ?? null,
           w.min_confidence_to_include]
        );
      }
      return { updated: body.weights.length };
    });
  });

  // ── Validation Rules ──────────────────────────────────────────────────────
  app.get('/tenants/:tenantId/admin/validation-rules', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM tenant_validation_rules WHERE tenant_id = $1 ORDER BY rule_type, field_key`, [tenantId]
      );
      return rows;
    });
  });

  app.post('/tenants/:tenantId/admin/validation-rules', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as any;
    return withTenant(tenantId, async (client) => {
      const writer = new EvidenceWriter(client);
      const evt = await writer.writeEvent({
        tenantId, eventTime: new Date(), eventType: 'CONFIG_CHANGED',
        producerType: 'USER', producerRef: req.auth!.userId,
        entityType: 'CONFIG', payload: { config_section: 'validation_rules', rule_code: body.rule_code },
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
        [tenantId, body.rule_code, body.rule_type, body.field_key ?? null,
         body.description, JSON.stringify(body.config ?? {}), body.severity ?? 'ERROR', evt.id]
      );
      return rule;
    });
  });

  app.delete('/tenants/:tenantId/admin/validation-rules/:ruleId', async (req, reply) => {
    const { tenantId, ruleId } = req.params as { tenantId: string; ruleId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    return withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE tenant_validation_rules SET is_active = false WHERE id = $1 AND tenant_id = $2`,
        [ruleId, tenantId]
      );
      return { deleted: true };
    });
  });

  // ── ERP Config ────────────────────────────────────────────────────────────
  app.get('/tenants/:tenantId/admin/erp-config', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    return withTenant(tenantId, async (client) => {
      const { rows: [cfg] } = await client.query(
        `SELECT id, erp_type, endpoint_url, auth_type, field_mappings, is_active, last_sync_at
         FROM tenant_erp_config WHERE tenant_id = $1`, [tenantId]
      );
      return cfg ?? null;
    });
  });

  app.put('/tenants/:tenantId/admin/erp-config', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as any;
    return withTenant(tenantId, async (client) => {
      const writer = new EvidenceWriter(client);
      const evt = await writer.writeEvent({
        tenantId, eventTime: new Date(), eventType: 'CONFIG_CHANGED',
        producerType: 'USER', producerRef: req.auth!.userId,
        entityType: 'CONFIG', payload: { config_section: 'erp_config', erp_type: body.erp_type },
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
        [tenantId, body.erp_type, body.endpoint_url, body.auth_type,
         JSON.stringify(body.credentials ?? {}), JSON.stringify(body.field_mappings ?? {}),
         body.is_active ?? false, evt.id]
      );
      return cfg;
    });
  });

  // ── BC Type Access ────────────────────────────────────────────────────────
  app.get('/tenants/:tenantId/admin/bc-access', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM tenant_bc_access WHERE tenant_id = $1 ORDER BY bc_type`, [tenantId]
      );
      const ALL = ['BC_2_0','BC_2_3','BC_2_5','BC_2_6_1','BC_2_6_2','BC_3_0','BC_4_0','BC_4_1'];
      const map = new Map(rows.map((r: any) => [r.bc_type, r]));
      return ALL.map(t => map.get(t) ?? { bc_type: t, is_enabled: false, config: {} });
    });
  });

  app.put('/tenants/:tenantId/admin/bc-access', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as { bc_type: string; is_enabled: boolean; config?: any };
    return withTenant(tenantId, async (client) => {
      const { rows: [row] } = await client.query(
        `INSERT INTO tenant_bc_access (tenant_id, bc_type, is_enabled, config)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, bc_type) DO UPDATE SET
           is_enabled = EXCLUDED.is_enabled, config = EXCLUDED.config
         RETURNING *`,
        [tenantId, body.bc_type, body.is_enabled, JSON.stringify(body.config ?? {})]
      );
      return row;
    });
  });

  // ── Learning Corrections ──────────────────────────────────────────────────
  app.get('/tenants/:tenantId/admin/learning-corrections', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT lc.*, lcr.status as review_status, lcr.reviewed_by, lcr.reviewed_at
         FROM learning_corrections lc
         LEFT JOIN learning_correction_reviews lcr ON lcr.correction_id = lc.id
         WHERE lc.tenant_id = $1 ORDER BY lc.created_at DESC LIMIT 100`,
        [tenantId]
      );
      return rows;
    });
  });

  app.post('/tenants/:tenantId/admin/learning-corrections/:correctionId/review', async (req, reply) => {
    const { tenantId, correctionId } = req.params as { tenantId: string; correctionId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as { action: 'APPROVE' | 'REJECT'; notes?: string };
    return withTenant(tenantId, async (client) => {
      const { rows: [review] } = await client.query(
        `INSERT INTO learning_correction_reviews
           (tenant_id, correction_id, status, reviewed_by, reviewed_at, notes)
         VALUES ($1,$2,$3,$4,NOW(),$5)
         ON CONFLICT (correction_id) DO UPDATE SET
           status = EXCLUDED.status, reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = NOW(), notes = EXCLUDED.notes
         RETURNING *`,
        [tenantId, correctionId, body.action, req.auth!.userId, body.notes ?? null]
      );
      return review;
    });
  });

  // ── Evidence Timeline ─────────────────────────────────────────────────────
  app.get('/tenants/:tenantId/admin/evidence-timeline', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    const query = req.query as { entity_id?: string; from?: string; to?: string; limit?: string };
    const { entity_id, from, to, limit = '50' } = query;
    return withTenant(tenantId, async (client) => {
      let q = `SELECT id, event_time, created_at, event_type, producer_type,
                      producer_ref, entity_type, entity_id, payload, sequence_num
               FROM evidence_events WHERE tenant_id = $1`;
      const params: any[] = [tenantId];
      if (entity_id) { params.push(entity_id); q += ` AND entity_id = $${params.length}`; }
      if (from)      { params.push(from);      q += ` AND event_time >= $${params.length}`; }
      if (to)        { params.push(to);        q += ` AND event_time <= $${params.length}`; }
      params.push(Math.min(parseInt(limit), 200));
      q += ` ORDER BY event_time DESC, sequence_num DESC LIMIT $${params.length}`;
      const { rows } = await client.query(q, params);
      return rows;
    });
  });

  // GET tenant config
  app.get('/tenants/:tenantId/config', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    return withTenant(tenantId, async (client) => {
      const { rows: [tenant] } = await client.query(
        `SELECT config FROM tenants WHERE id = $1`, [tenantId]
      );
      return { config: tenant?.config ?? {} };
    });
  });

  // PUT tenant config
  app.put('/tenants/:tenantId/config', async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    assertTenantAccess(req.auth!, tenantId);
    if (!req.auth!.roles.includes('admin')) return reply.code(403).send({ error: 'Admin only' });
    const body = req.body as any;
    return withTenant(tenantId, async (client) => {
      const { rows: [tenant] } = await client.query(
        `UPDATE tenants SET config = config || $1::jsonb WHERE id = $2 RETURNING config`,
        [JSON.stringify(body.config ?? {}), tenantId]
      );
      return { config: tenant?.config ?? {} };
    });
  });
}
