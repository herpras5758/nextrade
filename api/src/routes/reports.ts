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
          const claimIds = req.auth!.tenantIds;
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
        const avgReadiness = totalShipments > 0
          ? Math.round(shipments.rows.reduce((a: number, s: any) => a + (s.ceisa_readiness_score ?? 0), 0) / totalShipments)
          : 0;

        return {
          period: { from: from ?? null, to: to ?? null },
          tenants: tenantIds.length,
          shipments: {
            total: totalShipments,
            submitted,
            ready_for_ceisa: readyForCeisa,
            avg_readiness: avgReadiness,
            by_status: shipments.rows.reduce((acc: any, s: any) => {
              acc[s.status] = (acc[s.status] ?? 0) + 1; return acc;
            }, {}),
            by_tenant: shipments.rows.reduce((acc: any, s: any) => {
              acc[s.tenant_name] = (acc[s.tenant_name] ?? 0) + 1; return acc;
            }, {}),
          },
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
          const claimIds = req.auth!.tenantIds;
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

        const response = await bedrock.send(new InvokeModelCommand({
          modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 2048,
            system: `Kamu adalah analis trade compliance NexTrade. Buat laporan profesional dalam Bahasa Indonesia berdasarkan data aktual. Sertakan: ringkasan eksekutif, temuan utama, risiko, dan rekomendasi. Format dengan heading yang jelas.`,
            messages: [{ role: 'user', content: `${body.prompt}\n\n${dataContext}` }],
          }),
        }));

        const parsed = JSON.parse(new TextDecoder().decode(response.body));
        const narrative = parsed.content?.[0]?.text ?? 'Tidak dapat generate laporan.';

        return { narrative, generated_at: new Date().toISOString(), shipments_analyzed: shipments.length };
      });
    }
  );
}
