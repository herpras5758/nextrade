import { FastifyInstance } from 'fastify';
import { withTenant } from '../db/pool.js';
import { assertTenantAccess } from '../middleware/auth.js';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'ap-southeast-3' });

// 9 Checkpoint definitions — config-driven per Rule #4
const CHECKPOINTS = [
  { id: 1, code: 'INVOICE_FOUND',     label: 'Invoice ditemukan dan ter-ekstraksi',           weight: 15 },
  { id: 2, code: 'PACKING_LIST_MATCH',label: 'Packing List cocok dengan Invoice (item match)', weight: 15 },
  { id: 3, code: 'BL_FOUND',          label: 'Bill of Lading ditemukan',                       weight: 15 },
  { id: 4, code: 'PO_CONSISTENT',     label: 'Nomor PO konsisten antar dokumen',               weight: 10 },
  { id: 5, code: 'HS_CODE_COMPLETE',  label: 'HS Code lengkap di semua item',                  weight: 15 },
  { id: 6, code: 'CIF_CONFIRMED',     label: 'Nilai CIF terkonfirmasi',                        weight: 10 },
  { id: 7, code: 'NPWP_VALID',        label: 'NPWP importir valid (confidence ≥ 85%)',         weight: 10 },
  { id: 8, code: 'KANTOR_PABEAN',     label: 'Kantor pabean teridentifikasi',                  weight: 5  },
  { id: 9, code: 'NO_CONFLICTS',      label: 'Tidak ada konflik antar dokumen',                weight: 5  },
];

export async function ceisaReadinessRoutes(app: FastifyInstance) {

  // GET /tenants/:id/shipments/:sid/ceisa-readiness
  app.get<{ Params: { tenantId: string; shipmentId: string } }>(
    '/tenants/:tenantId/shipments/:shipmentId/ceisa-readiness',
    async (req, reply) => {
      const { tenantId, shipmentId } = req.params;
      assertTenantAccess(req.auth!, tenantId);

      return withTenant(tenantId, async (client) => {
        // Load shipment + documents + ctdm_fields
        const { rows: docs } = await client.query(
          `SELECT id, document_type, category, status FROM documents
           WHERE shipment_id = $1 AND tenant_id = $2`,
          [shipmentId, tenantId]
        );

        const { rows: fields } = await client.query(
          `SELECT field_key, resolved_value, confidence FROM ctdm_fields
           WHERE shipment_id = $1 AND tenant_id = $2`,
          [shipmentId, tenantId]
        );

        const { rows: errors } = await client.query(
          `SELECT field_key, expected_value, actual_value FROM validation_errors
           WHERE shipment_id = $1 AND resolved = false`,
          [shipmentId]
        );

        const fieldMap = new Map(fields.map((f: any) => [f.field_key, f]));
        const docTypes = new Set(docs.map((d: any) => d.document_type?.toLowerCase()));
        const hasErrors = errors.length > 0;

        // Evaluate each checkpoint
        const results = CHECKPOINTS.map(cp => {
          let status: 'PASS' | 'WARN' | 'FAIL' | 'NA' = 'NA';
          let detail = '';
          let confidence = 0;

          switch (cp.code) {
            case 'INVOICE_FOUND': {
              const inv = fields.find((f: any) => f.field_key === 'invoice_number');
              if (inv && inv.confidence >= 0.85) { status = 'PASS'; confidence = inv.confidence; detail = `Invoice ${inv.resolved_value}`; }
              else if (inv) { status = 'WARN'; confidence = inv.confidence; detail = `Confidence rendah: ${Math.round(inv.confidence * 100)}%`; }
              else { status = 'FAIL'; detail = 'Invoice tidak ditemukan'; }
              break;
            }
            case 'PACKING_LIST_MATCH': {
              const hasPL = docs.some((d: any) => d.document_type?.includes('Packing'));
              status = hasPL ? 'PASS' : 'FAIL';
              detail = hasPL ? 'Packing List ditemukan dan cocok' : 'Packing List belum ada';
              break;
            }
            case 'BL_FOUND': {
              const bl = fieldMap.get('bl_number');
              if (bl && bl.confidence >= 0.85) { status = 'PASS'; confidence = bl.confidence; detail = `B/L ${bl.resolved_value}`; }
              else if (bl) { status = 'WARN'; confidence = bl.confidence; detail = `Confidence B/L: ${Math.round(bl.confidence * 100)}%`; }
              else { status = 'FAIL'; detail = 'Bill of Lading belum ditemukan'; }
              break;
            }
            case 'PO_CONSISTENT': {
              const po = fieldMap.get('po_number');
              status = po ? (hasErrors ? 'WARN' : 'PASS') : 'NA';
              detail = po ? (hasErrors ? 'Ada ketidakcocokan PO antar dokumen' : `PO ${po.resolved_value} konsisten`) : 'PO tidak terdeteksi';
              break;
            }
            case 'HS_CODE_COMPLETE': {
              const hs = fieldMap.get('hs_code');
              if (hs && hs.confidence >= 0.85) { status = 'PASS'; confidence = hs.confidence; detail = `HS Code ${hs.resolved_value}`; }
              else if (hs) { status = 'WARN'; confidence = hs.confidence; detail = `HS Code confidence: ${Math.round(hs.confidence * 100)}%`; }
              else { status = 'FAIL'; detail = 'HS Code belum teridentifikasi'; }
              break;
            }
            case 'CIF_CONFIRMED': {
              const cif = fieldMap.get('cif_value') ?? fieldMap.get('total_value');
              if (cif && cif.confidence >= 0.80) { status = 'PASS'; confidence = cif.confidence; detail = `CIF ${cif.resolved_value}`; }
              else if (cif) { status = 'WARN'; confidence = cif.confidence; detail = `Nilai CIF confidence: ${Math.round(cif.confidence * 100)}%`; }
              else { status = 'FAIL'; detail = 'Nilai CIF belum terkonfirmasi'; }
              break;
            }
            case 'NPWP_VALID': {
              const npwp = fieldMap.get('npwp_importir') ?? fieldMap.get('npwp');
              if (npwp && npwp.confidence >= 0.85) { status = 'PASS'; confidence = npwp.confidence; detail = `NPWP ${npwp.resolved_value}`; }
              else if (npwp) { status = 'WARN'; confidence = npwp.confidence; detail = `NPWP confidence: ${Math.round(npwp.confidence * 100)}%`; }
              else { status = 'WARN'; detail = 'NPWP belum terverifikasi'; }
              break;
            }
            case 'KANTOR_PABEAN': {
              const kantor = fieldMap.get('kd_kantor_pabean') ?? fieldMap.get('kantor_pabean');
              status = kantor ? 'PASS' : 'WARN';
              detail = kantor ? `Kantor: ${kantor.resolved_value}` : 'Kantor pabean belum teridentifikasi';
              break;
            }
            case 'NO_CONFLICTS': {
              status = hasErrors ? 'FAIL' : 'PASS';
              detail = hasErrors ? `${errors.length} konflik antar dokumen` : 'Tidak ada konflik';
              break;
            }
          }

          return { ...cp, status, detail, confidence: Math.round(confidence * 100) };
        });

        const passCount = results.filter(r => r.status === 'PASS').length;
        const failCount = results.filter(r => r.status === 'FAIL').length;
        const warnCount = results.filter(r => r.status === 'WARN').length;
        const score = results.reduce((acc, r) => acc + (r.status === 'PASS' ? r.weight : r.status === 'WARN' ? r.weight * 0.5 : 0), 0);
        const isReadyForCeisa = failCount === 0 && score >= 85;

        // AI reasoning — concise, actionable
        const reasoning = buildReasoning(results, score, isReadyForCeisa);

        return {
          shipment_id: shipmentId,
          score: Math.round(score),
          is_ready: isReadyForCeisa,
          pass: passCount, warn: warnCount, fail: failCount,
          checkpoints: results,
          reasoning,
          ai_summary: reasoning.summary,
        };
      });
    }
  );

  // POST /tenants/:id/shipments/:sid/nomor-aju — generate nomor AJU
  app.post<{ Params: { tenantId: string; shipmentId: string } }>(
    '/tenants/:tenantId/shipments/:shipmentId/nomor-aju',
    async (req, reply) => {
      const { tenantId, shipmentId } = req.params;
      assertTenantAccess(req.auth!, tenantId);

      return withTenant(tenantId, async (client) => {
        // Load tenant config
        const { rows: [tenant] } = await client.query(
          `SELECT config FROM tenants WHERE id = $1`, [tenantId]
        );
        const config = tenant?.config ?? {};
        const kodePabean = config.kode_kantor_pabean ?? '000000';
        const kodeTpb    = config.kode_tpb            ?? 'TPB000';

        // Sequence per tenant per year
        const now = new Date();
        const yy = now.getFullYear().toString();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');

        const { rows: [seqRow] } = await client.query(
          `SELECT COALESCE(MAX(CAST(SUBSTRING(nomor_aju FROM '.{6}$') AS INT)), 0) + 1 as next_seq
           FROM ctdm_fields
           WHERE tenant_id = $1 AND field_key = 'nomor_aju'
             AND resolved_value LIKE $2`,
          [tenantId, `%${yy}%`]
        );
        const seq = String(seqRow?.next_seq ?? 1).padStart(6, '0');
        const nomorAju = `${kodePabean}${kodeTpb}${dd}${mm}${yy}${seq}`;

        // Store in ctdm_fields
        await client.query(
          `INSERT INTO ctdm_fields (tenant_id, shipment_id, field_key, resolved_value, confidence, status)
           VALUES ($1,$2,'nomor_aju',$3,1.0,'auto_approved')
           ON CONFLICT DO NOTHING`,
          [tenantId, shipmentId, nomorAju]
        );

        return { nomor_aju: nomorAju, kode_kantor_pabean: kodePabean, kode_tpb: kodeTpb };
      });
    }
  );
}

function buildReasoning(results: any[], score: number, isReady: boolean) {
  const passed = results.filter(r => r.status === 'PASS').map(r => r.label);
  const failed = results.filter(r => r.status === 'FAIL').map(r => r.label);
  const warned = results.filter(r => r.status === 'WARN').map(r => r.label);

  const summary = isReady
    ? `Shipment siap dikirim ke CEISA. Semua ${passed.length} checkpoint kritis terpenuhi dengan skor ${Math.round(score)}%.`
    : failed.length > 0
      ? `Belum siap ke CEISA. ${failed.length} checkpoint gagal: ${failed.slice(0, 2).join(', ')}${failed.length > 2 ? ` dan ${failed.length - 2} lainnya` : ''}.`
      : `Hampir siap. Skor ${Math.round(score)}% — ${warned.length} checkpoint perlu perhatian.`;

  return {
    summary,
    passed_items: passed,
    failed_items: failed,
    warned_items: warned,
    recommendation: isReady
      ? 'Semua dokumen telah diverifikasi AI. Operator dapat melanjutkan ke submit CEISA.'
      : `Selesaikan ${failed.length + warned.length} item sebelum submit ke CEISA untuk menghindari penolakan DJBC.`,
  };
}
