import { FastifyInstance } from 'fastify';
import { withTenant } from '../db/pool.js';
import { assertTenantAccess } from '../middleware/auth.js';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'ap-southeast-3' });

export async function reportRoutes(app: FastifyInstance) {

  // GET /tenants/:id/reports/summary — data untuk report standar
  app.get<{
    Params: { tenantId: string };
    Querystring: { from?: string; to?: string; all_bu?: string };
  }>(
    '/tenants/:tenantId/reports/summary',
    async (req, reply) => {
      const { tenantId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      const { from, to, all_bu } = req.query as any;

      return withTenant(tenantId, async (client) => {
        const tenantIds: string[] = [tenantId];
        if (all_bu === 'true') {
          const claimIds = req.auth!.tenantIds ?? [];
          for (const tid of claimIds) if (!tenantIds.includes(tid)) tenantIds.push(tid);
        }

        const placeholders = tenantIds.map((_: any, i: number) => `$${i + 1}`).join(',');
        const dateFilter = from ? ` AND s.created_at >= '${from}'` : '';
        const dateFilter2 = to ? ` AND s.created_at <= '${to}'` : '';

        const [shipments, docs, fields] = await Promise.all([
          client.query(
            `SELECT s.*, t.name as tenant_name FROM shipments s
             JOIN tenants t ON t.id = s.tenant_id
             WHERE s.tenant_id IN (${placeholders})${dateFilter}${dateFilter2}
             ORDER BY s.created_at DESC`,
            tenantIds
          ),
          client.query(
            `SELECT document_type, status, COUNT(*) as cnt
             FROM documents WHERE tenant_id IN (${placeholders})${dateFilter}${dateFilter2}
             GROUP BY document_type, status`,
            tenantIds
          ),
          client.query(
            `SELECT field_key, AVG(confidence) as avg_conf, COUNT(*) as cnt
             FROM ctdm_fields WHERE tenant_id IN (${placeholders})
             GROUP BY field_key ORDER BY cnt DESC LIMIT 20`,
            tenantIds
          ),
        ]);

        const totalShipments = shipments.rows.length;
        const submitted = shipments.rows.filter((s: any) => ['SUBMITTED','SPPB','CLOSED'].includes(s.status)).length;
        const readyForCeisa = shipments.rows.filter((s: any) => s.status === 'READY_FOR_CEISA').length;
        const pendingReview = shipments.rows.filter((s: any) => s.status === 'UNDER_REVIEW').length;
        const critical = shipments.rows.filter((s: any) => s.health === 'CRITICAL').length;
        const avgReadiness = totalShipments > 0
          ? Math.round(shipments.rows.reduce((a: number, s: any) => a + (s.ceisa_readiness_score ?? 0), 0) / totalShipments)
          : 0;

        // Recent activity from evidence_events
        const { rows: recentActivity } = await client.query(
          `SELECT ee.event_type, ee.event_time, ee.entity_type, ee.entity_id,
                  ee.payload, s.shipment_number
           FROM evidence_events ee
           LEFT JOIN shipments s ON s.id = ee.entity_id
           WHERE ee.tenant_id = ANY($1::uuid[])
           ORDER BY ee.event_time DESC LIMIT 10`,
          [tenantIds]
        ).catch(() => ({ rows: [] }));

        return {
          period: { from: from ?? null, to: to ?? null },
          tenants: tenantIds.length,
          shipments: {
            total: totalShipments,
            submitted,
            ready_for_ceisa: readyForCeisa,
            pending_review: pendingReview,
            critical,
            avg_readiness: avgReadiness,
            by_status: shipments.rows.reduce((acc: any, s: any) => {
              acc[s.status] = (acc[s.status] ?? 0) + 1; return acc;
            }, {}),
            by_health: shipments.rows.reduce((acc: any, s: any) => {
              acc[s.health ?? 'UNKNOWN'] = (acc[s.health ?? 'UNKNOWN'] ?? 0) + 1; return acc;
            }, {}),
            by_tenant: shipments.rows.reduce((acc: any, s: any) => {
              acc[s.tenant_name] = (acc[s.tenant_name] ?? 0) + 1; return acc;
            }, {}),
          },
          recent_activity: recentActivity,
          documents: {
            total: docs.rows.reduce((a: number, d: any) => a + parseInt(d.cnt), 0),
            by_type: docs.rows.reduce((acc: any, d: any) => {
              acc[d.document_type] = (acc[d.document_type] ?? 0) + parseInt(d.cnt); return acc;
            }, {}),
          },
          extraction_quality: {
            fields_analyzed: fields.rows.length,
            avg_confidence: fields.rows.length > 0
              ? Math.round(fields.rows.reduce((a: number, f: any) => a + parseFloat(f.avg_conf), 0) / fields.rows.length * 100)
              : 0,
          },
          raw_shipments: shipments.rows,
        };
      });
    }
  );

  // POST /tenants/:id/reports/ai-narrative — AI generate laporan
  app.post<{
    Params: { tenantId: string };
    Body: { prompt: string; from?: string; to?: string; all_bu?: boolean };
  }>(
    '/tenants/:tenantId/reports/ai-narrative',
    async (req, reply) => {
      const { tenantId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      const body = req.body as any;

      return withTenant(tenantId, async (client) => {
        // Reuse summary data
        const tenantIds: string[] = [tenantId];
        if (body.all_bu) {
          const claimIds = req.auth!.tenantIds ?? [];
          for (const tid of claimIds) if (!tenantIds.includes(tid)) tenantIds.push(tid);
        }

        const placeholders = tenantIds.map((_: any, i: number) => `$${i + 1}`).join(',');
        const { rows: shipments } = await client.query(
          `SELECT s.shipment_number, s.status, s.ceisa_readiness_score, s.health,
                  t.name as tenant_name, s.created_at
           FROM shipments s JOIN tenants t ON t.id = s.tenant_id
           WHERE s.tenant_id IN (${placeholders}) ORDER BY s.created_at DESC LIMIT 50`,
          tenantIds
        );

        const dataContext = `
Data sistem NexTrade:
- Total shipment: ${shipments.length}
- Submitted ke CEISA: ${shipments.filter((s: any) => ['SUBMITTED','SPPB','CLOSED'].includes(s.status)).length}
- Siap CEISA: ${shipments.filter((s: any) => s.status === 'READY_FOR_CEISA').length}
- Avg readiness: ${shipments.length > 0 ? Math.round(shipments.reduce((a: number, s: any) => a + (s.ceisa_readiness_score ?? 0), 0) / shipments.length) : 0}%
- Critical: ${shipments.filter((s: any) => s.health === 'CRITICAL').length}
- Periode: ${body.from ?? 'semua'} s/d ${body.to ?? 'sekarang'}

Detail shipment:
${shipments.slice(0, 20).map((s: any) => `${s.shipment_number} | ${s.status} | ${s.ceisa_readiness_score}% | ${s.health} | ${s.tenant_name}`).join('\n')}
`;

        // Load AI config
        const { rows: [aiCfg] } = await client.query(
          `SELECT extraction_model_id, openai_api_key, ai_provider FROM tenant_ai_config WHERE tenant_id = $1`,
          [tenantId]
        );

        let narrative = 'Tidak dapat generate laporan.';
        const systemPrompt = 'Kamu adalah analis trade compliance NexTrade. Buat laporan profesional dalam Bahasa Indonesia berdasarkan data aktual. Sertakan: ringkasan eksekutif, temuan utama, risiko, dan rekomendasi. Format dengan heading yang jelas.';
        const userMessage = `${body.prompt}\n\n${dataContext}`;

        if (aiCfg?.ai_provider === 'anthropic' && aiCfg?.anthropic_api_key) {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': aiCfg.anthropic_api_key, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: aiCfg.extraction_model_id ?? 'claude-sonnet-4-6', max_tokens: 1024,
              messages: [{ role: 'user', content: (typeof systemContext !== 'undefined' ? systemContext + '\n\n' : '') + (typeof message !== 'undefined' ? message : (body?.prompt ?? '')) + (typeof dataContext !== 'undefined' ? '\n\n' + dataContext : '') }] }),
          });
          const data = await res.json() as any;
          const _ans = data.content?.[0]?.text ?? '';
          if (_ans) { narrative = _ans; }
        } else if (aiCfg?.ai_provider === 'openai' && aiCfg?.openai_api_key) {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiCfg.openai_api_key}` },
            body: JSON.stringify({ model: aiCfg.extraction_model_id ?? 'gpt-4o', max_tokens: 2048,
              messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }] }),
          });
          const data = await res.json() as any;
          narrative = data.choices?.[0]?.message?.content ?? narrative;
        } else {
          const response = await bedrock.send(new InvokeModelCommand({
            modelId: aiCfg?.extraction_model_id ?? 'global.anthropic.claude-sonnet-4-6',
            contentType: 'application/json', accept: 'application/json',
            body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 2048,
              system: systemPrompt, messages: [{ role: 'user', content: userMessage }] }),
          }));
          const parsed = JSON.parse(new TextDecoder().decode(response.body));
          narrative = parsed.content?.[0]?.text ?? narrative;
        }

        return { narrative, generated_at: new Date().toISOString(), shipments_analyzed: shipments.length };
      });
    }
  );
}
