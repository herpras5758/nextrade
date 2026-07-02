import { FastifyInstance } from 'fastify';
import { withTenant } from '../db/pool.js';
import { assertTenantAccess } from '../middleware/auth.js';

export async function ceisaReadinessRoutes(app: FastifyInstance) {

  app.get('/tenants/:tenantId/shipments/:shipmentId/ceisa-readiness', async (req, reply) => {
    const { tenantId, shipmentId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      // Load all extracted fields
      const { rows: fields } = await client.query(
        `SELECT cf.field_key, cf.resolved_value, cf.confidence, cf.status, cf.document_id,
                d.document_type
         FROM ctdm_fields cf
         JOIN documents d ON d.id = cf.document_id
         WHERE cf.shipment_id = $1 AND cf.tenant_id = $2`,
        [shipmentId, tenantId]
      );

      // Load documents
      const { rows: docs } = await client.query(
        `SELECT document_type, status, COUNT(*) as cnt
         FROM documents
         WHERE shipment_id = $1 AND tenant_id = $2
         GROUP BY document_type, status`,
        [shipmentId, tenantId]
      );

      // Load mandatory CEISA fields config
      const { rows: mandatoryFields } = await client.query(
        `SELECT dfc.doc_type_code, dfc.field_key, dfc.display_name, dfc.ceisa_field_ref
         FROM tenant_doc_field_config dfc
         WHERE dfc.tenant_id = $1 AND dfc.is_mandatory_ceisa = true AND dfc.is_enabled = true`,
        [tenantId]
      );

      // Load validation errors
      const { rows: errors } = await client.query(
        `SELECT field_key, COUNT(*) as cnt FROM validation_errors
         WHERE shipment_id = $1 AND tenant_id = $2 AND resolved = false
         GROUP BY field_key`,
        [shipmentId, tenantId]
      );

      // Build field lookup
      const fieldMap: Record<string, any> = {};
      for (const f of fields) {
        const key = `${f.document_type}:${f.field_key}`;
        if (!fieldMap[key] || f.confidence > fieldMap[key].confidence) {
          fieldMap[key] = f;
        }
        // Also store by field_key only (for cross-doc lookup)
        if (!fieldMap[f.field_key] || f.confidence > (fieldMap[f.field_key]?.confidence ?? 0)) {
          fieldMap[f.field_key] = f;
        }
      }

      const docTypes = new Set(docs.map((d: any) => d.document_type));
      const extractedDocs = docs.filter((d: any) => d.status === 'extracted');
      const errorKeys = new Set(errors.map((e: any) => e.field_key));

      // Helper: check if field exists with sufficient confidence
      function hasField(key: string, minConf = 0.70): boolean {
        const f = fieldMap[key];
        return f?.resolved_value && parseFloat(f.confidence) >= minConf;
      }

      // ── 9 CEISA Checkpoints ─────────────────────────────────────────────
      const checkpoints = [
        {
          id: 1,
          name: 'Invoice Ditemukan & Terekstrak',
          description: 'Commercial Invoice tersedia dan field utama terekstrak',
          status: docTypes.has('COMMERCIAL_INVOICE') && hasField('invoice_number') && hasField('total_fob')
            ? 'PASS' : docTypes.has('COMMERCIAL_INVOICE') ? 'WARN' : 'FAIL',
          detail: hasField('invoice_number')
            ? `Invoice ${fieldMap['invoice_number']?.resolved_value} · FOB ${fieldMap['total_fob']?.resolved_value ?? 'belum ada'}`
            : 'Invoice tidak ditemukan atau field utama belum terekstrak',
        },
        {
          id: 2,
          name: 'Packing List Cocok dengan Invoice',
          description: 'Packing List tersedia dan berat/kemasan konsisten dengan Invoice',
          status: docTypes.has('PACKING_LIST') && hasField('total_gross_weight_kg') && hasField('total_packages')
            ? 'PASS' : docTypes.has('PACKING_LIST') ? 'WARN' : 'FAIL',
          detail: hasField('total_gross_weight_kg')
            ? `${fieldMap['total_packages']?.resolved_value} kemasan · ${fieldMap['total_gross_weight_kg']?.resolved_value} KG`
            : 'Packing List tidak ditemukan atau field berat/kemasan belum ada',
        },
        {
          id: 3,
          name: 'Bill of Lading Valid',
          description: 'B/L tersedia dengan nomor, vessel, dan pelabuhan',
          status: docTypes.has('BILL_OF_LADING') && hasField('bl_number') && hasField('vessel_name')
            ? 'PASS' : docTypes.has('BILL_OF_LADING') ? 'WARN' : 'FAIL',
          detail: hasField('bl_number')
            ? `B/L ${fieldMap['bl_number']?.resolved_value} · Kapal: ${fieldMap['vessel_name']?.resolved_value ?? '-'}`
            : 'Bill of Lading tidak ditemukan atau nomor B/L belum ada',
        },
        {
          id: 4,
          name: 'HS Code Tersedia',
          description: 'HS Code pos tarif sudah ada untuk semua item',
          status: hasField('hs_codes', 0.60) || hasField('items', 0.60)
            ? 'PASS' : errorKeys.has('hs_codes') ? 'FAIL' : 'WARN',
          detail: hasField('hs_codes')
            ? `HS Codes terekstrak (confidence ${Math.round(parseFloat(fieldMap['hs_codes']?.confidence ?? 0) * 100)}%)`
            : 'HS Code belum ada — diperlukan untuk klasifikasi tarif',
        },
        {
          id: 5,
          name: 'Nilai CIF Tersedia',
          description: 'Nilai CIF dalam USD dan IDR sudah ada',
          status: (hasField('nilai_cif_usd') || hasField('total_fob')) && hasField('kurs', 0.60)
            ? 'PASS' : hasField('total_fob') ? 'WARN' : 'FAIL',
          detail: hasField('nilai_cif_usd')
            ? `CIF USD: ${fieldMap['nilai_cif_usd']?.resolved_value} · Kurs: ${fieldMap['kurs']?.resolved_value ?? '-'}`
            : hasField('total_fob')
            ? `FOB tersedia (${fieldMap['total_fob']?.resolved_value}) — freight/asuransi belum ada`
            : 'Nilai CIF belum ada',
        },
        {
          id: 6,
          name: 'Data Pengirim & Penerima Lengkap',
          description: 'Nama supplier dan consignee tersedia di Invoice atau B/L',
          status: hasField('supplier_name') && (hasField('consignee_name') || hasField('nama_importir'))
            ? 'PASS' : hasField('supplier_name') || hasField('consignee_name') ? 'WARN' : 'FAIL',
          detail: hasField('supplier_name')
            ? `Supplier: ${fieldMap['supplier_name']?.resolved_value?.slice(0, 40)} · Consignee: ${(fieldMap['consignee_name'] ?? fieldMap['nama_importir'])?.resolved_value?.slice(0, 30) ?? 'belum ada'}`
            : 'Data pengirim/penerima belum ada',
        },
        {
          id: 7,
          name: 'NPWP Importir Terverifikasi',
          description: 'NPWP importir tersedia dengan confidence tinggi (≥85%)',
          status: hasField('consignee_npwp', 0.85) || hasField('npwp_importir', 0.85)
            ? 'PASS' : hasField('consignee_npwp', 0.60) || hasField('npwp_importir', 0.60) ? 'WARN' : 'FAIL',
          detail: (() => {
            const npwp = fieldMap['consignee_npwp'] ?? fieldMap['npwp_importir'];
            if (!npwp) return 'NPWP tidak ditemukan — wajib untuk CEISA';
            const conf = Math.round(parseFloat(npwp.confidence) * 100);
            return `NPWP: ${npwp.resolved_value} · Confidence: ${conf}%${conf < 85 ? ' (perlu verifikasi manual)' : ''}`;
          })(),
        },
        {
          id: 8,
          name: 'Dokumen Tidak Ada Konflik',
          description: 'Tidak ada konflik nilai antar dokumen yang belum diresolusi',
          status: errors.length === 0 ? 'PASS' : errors.length <= 2 ? 'WARN' : 'FAIL',
          detail: errors.length === 0
            ? 'Semua field konsisten antar dokumen'
            : `${errors.length} konflik field belum diresolusi: ${errors.map((e: any) => e.field_key).join(', ')}`,
        },
        {
          id: 9,
          name: 'Semua Dokumen Wajib Tersedia',
          description: 'Invoice, Packing List, dan B/L semua telah diekstrak',
          status: extractedDocs.some((d: any) => d.document_type === 'COMMERCIAL_INVOICE')
            && extractedDocs.some((d: any) => d.document_type === 'PACKING_LIST')
            && extractedDocs.some((d: any) => d.document_type === 'BILL_OF_LADING')
            ? 'PASS'
            : extractedDocs.length > 0 ? 'WARN' : 'FAIL',
          detail: `Dokumen terekstrak: ${extractedDocs.map((d: any) => d.document_type).join(', ') || 'belum ada'}`,
        },
      ];

      const passed = checkpoints.filter(c => c.status === 'PASS').length;
      const warned = checkpoints.filter(c => c.status === 'WARN').length;
      const failed = checkpoints.filter(c => c.status === 'FAIL').length;
      const score = Math.round((passed / checkpoints.length) * 100);

      const overallStatus = failed === 0 && warned === 0 ? 'READY'
        : failed === 0 ? 'NEARLY_READY'
        : failed <= 2 ? 'NEEDS_ATTENTION'
        : 'NOT_READY';

      // Generate AI reasoning if OpenAI configured
      let reasoning = {
        summary: overallStatus === 'READY' ? 'Semua checkpoint terpenuhi — siap untuk submit ke CEISA'
          : overallStatus === 'NEARLY_READY' ? `Hampir siap — ${warned} checkpoint perlu perhatian`
          : `Belum siap — ${failed} checkpoint gagal`,
        recommendation: overallStatus === 'READY'
          ? 'Dapat dilanjutkan ke Draft BC 2.3 dan submit ke CEISA'
          : `Selesaikan ${failed} checkpoint yang gagal: ${checkpoints.filter(c => c.status === 'FAIL').map(c => c.name).join(', ')}`,
      };

      try {
        const { rows: [aiCfg] } = await client.query(
          `SELECT extraction_model_id, openai_api_key, ai_provider FROM tenant_ai_config WHERE tenant_id = $1`,
          [tenantId]
        );
        if (aiCfg?.ai_provider === 'openai' && aiCfg?.openai_api_key) {
          const prompt = `Analisis CEISA readiness berikut dan buat rekomendasi singkat (max 2 kalimat per bagian):
Score: ${score}% | Status: ${overallStatus}
PASS: ${checkpoints.filter(c=>c.status==='PASS').map(c=>c.name).join(', ')}
WARN: ${checkpoints.filter(c=>c.status==='WARN').map(c=>c.name).join(', ')}
FAIL: ${checkpoints.filter(c=>c.status==='FAIL').map(c=>c.name).join(', ')}
Missing: ${mandatoryFields.filter(mf => !hasField(mf.field_key, 0.60)).map(mf=>mf.display_name).join(', ')}

Jawab JSON: {"summary":"...","recommendation":"..."}`;
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiCfg.openai_api_key}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 256,
              messages: [{ role: 'user', content: prompt }] }),
          });
          const data = await res.json() as any;
          const text = data.choices?.[0]?.message?.content ?? '{}';
          const parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
          if (parsed.summary) reasoning = parsed;
        }
      } catch {}

      return {
        shipmentId,
        score,
        overallStatus,
        checkpoints,
        reasoning,
        summary: {
          pass: passed, warn: warned, fail: failed,
          totalFields: fields.length,
          mandatoryFieldsMissing: mandatoryFields.filter(mf =>
            !hasField(mf.field_key, 0.60)
          ).map(mf => ({ ...mf, docType: mf.doc_type_code })),
        },
      };
    });
  });
}
