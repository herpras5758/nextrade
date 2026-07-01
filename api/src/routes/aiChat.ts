import { FastifyInstance } from 'fastify';
import { withTenant } from '../db/pool.js';
import { assertTenantAccess } from '../middleware/auth.js';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'ap-southeast-3' });

export async function aiChatRoutes(app: FastifyInstance) {

  app.post<{
    Params: { tenantId: string };
    Body: { message: string; context?: { shipmentId?: string; documentId?: string } };
  }>(
    '/tenants/:tenantId/ai-chat',
    async (req, reply) => {
      const { tenantId } = req.params;
      assertTenantAccess(req.auth!, tenantId);
      const { message, context } = req.body as any;

      return withTenant(tenantId, async (client) => {
        // Load accessible tenant IDs (multi-BU support)
        const tenantIds: string[] = [tenantId];
        const claimTenantIds = (req.auth!.tenantIds;
        for (const tid of claimTenantIds) {
          if (!tenantIds.includes(tid)) tenantIds.push(tid);
        }

        // Build context from DB — scoped to accessible tenants
        const placeholders = tenantIds.map((_: any, i: number) => `$${i + 1}`).join(',');

        const [shipmentsRes, docsRes, fieldsRes] = await Promise.all([
          client.query(
            `SELECT s.id, s.shipment_number, s.status, s.health, s.ceisa_readiness_score,
                    t.name as tenant_name
             FROM shipments s JOIN tenants t ON t.id = s.tenant_id
             WHERE s.tenant_id IN (${placeholders}) ORDER BY s.created_at DESC LIMIT 20`,
            tenantIds
          ),
          client.query(
            `SELECT document_type, status, COUNT(*) as cnt, AVG(
               (SELECT AVG(cf.confidence) FROM ctdm_fields cf WHERE cf.document_id = d.id)
             ) as avg_conf
             FROM documents d
             WHERE d.tenant_id IN (${placeholders})
             GROUP BY document_type, status`,
            tenantIds
          ),
          context?.shipmentId ? client.query(
            `SELECT field_key, resolved_value, confidence FROM ctdm_fields
             WHERE shipment_id = $1 AND tenant_id = $2 LIMIT 30`,
            [context.shipmentId, tenantId]
          ) : Promise.resolve({ rows: [] }),
        ]);

        const systemContext = `
Kamu adalah AI assistant NexTrade, platform trade intelligence untuk customs Indonesia (CEISA/DJBC).
Kamu memiliki akses ke data sistem berikut (per hak akses user):

SHIPMENTS (${shipmentsRes.rows.length} terbaru):
${shipmentsRes.rows.map((s: any) => `- ${s.shipment_number} [${s.status}] health=${s.health} readiness=${s.ceisa_readiness_score}% BU=${s.tenant_name}`).join('\n')}

DOKUMEN SUMMARY:
${docsRes.rows.map((d: any) => `- ${d.document_type}: ${d.cnt} dok, avg confidence ${Math.round((d.avg_conf ?? 0) * 100)}%, status=${d.status}`).join('\n')}

${fieldsRes.rows.length > 0 ? `CTDM FIELDS (shipment aktif):
${fieldsRes.rows.map((f: any) => `- ${f.field_key}: ${f.resolved_value} (${Math.round(f.confidence * 100)}%)`).join('\n')}` : ''}

Jawab dalam Bahasa Indonesia. Selalu sebutkan sumber data ("dari shipment SHP-001", "berdasarkan Invoice YW008945").
Jika ditanya rekomendasi bisnis, berikan analisis berdasarkan data aktual.
Jika data tidak tersedia, katakan tegas "Data tidak tersedia di sistem."
`.trim();

        // Call Bedrock
        const response = await bedrock.send(new InvokeModelCommand({
          modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1024,
            system: systemContext,
            messages: [{ role: 'user', content: message }],
          }),
        }));

        const parsed = JSON.parse(new TextDecoder().decode(response.body));
        const answer = parsed.content?.[0]?.text ?? 'Maaf, tidak dapat memproses pertanyaan ini.';

        return { answer, context_used: { shipments: shipmentsRes.rows.length, documents: docsRes.rows.length } };
      });
    }
  );
}
