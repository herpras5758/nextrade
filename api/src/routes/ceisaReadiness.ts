import { FastifyInstance } from 'fastify';
import { withTenant } from '../db/pool.js';
import { assertTenantAccess } from '../middleware/auth.js';

export async function ceisaReadinessRoutes(app: FastifyInstance) {

  app.get('/tenants/:tenantId/shipments/:shipmentId/ceisa-readiness', async (req, reply) => {
    const { tenantId, shipmentId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows: fields } = await client.query(
        `SELECT cf.field_key, cf.resolved_value, cf.confidence, cf.status, cf.document_id,
                d.document_type
         FROM ctdm_fields cf
         JOIN documents d ON d.id = cf.document_id
         WHERE cf.shipment_id = $1 AND cf.tenant_id = $2`,
        [shipmentId, tenantId]
      );

      const { rows: docs } = await client.query(
        `SELECT document_type, status, COUNT(*) as cnt
         FROM documents WHERE shipment_id = $1 AND tenant_id = $2
         GROUP BY document_type, status`,
        [shipmentId, tenantId]
      );

      const { rows: mandatoryFields } = await client.query(
        `SELECT dfc.doc_type_code, dfc.field_key, dfc.display_name, dfc.ceisa_field_ref
         FROM tenant_doc_field_config dfc
         WHERE dfc.tenant_id = $1 AND dfc.is_mandatory_ceisa = true AND dfc.is_enabled = true`,
        [tenantId]
      );

      const { rows: errors } = await client.query(
        `SELECT field_key, COUNT(*) as cnt FROM validation_errors
         WHERE shipment_id = $1 AND tenant_id = $2 AND resolved = false
         GROUP BY field_key`,
        [shipmentId, tenantId]
      );

      const fieldMap: Record<string, any> = {};
      for (const f of fields) {
        const key = `${f.document_type}:${f.field_key}`;
        if (!fieldMap[key] || f.confidence > fieldMap[key].confidence) fieldMap[key] = f;
        if (!fieldMap[f.field_key] || f.confidence > (fieldMap[f.field_key]?.confidence ?? 0)) fieldMap[f.field_key] = f;
      }

      const docTypes = new Set(docs.map((d: any) => d.document_type));
      const extractedDocs = docs.filter((d: any) => d.status === 'extracted');
      const errorKeys = new Set(errors.map((e: any) => e.field_key));

      function hasField(key: string, minConf = 0.70): boolean {
        const f = fieldMap[key];
        return f?.resolved_value && parseFloat(f.confidence) >= minConf;
      }

      const checkpoints = [
        {
          id: 1, name: 'Invoice Found & Extracted',
          description: 'Commercial Invoice available with key fields extracted',
          status: docTypes.has('COMMERCIAL_INVOICE') && hasField('invoice_number') && hasField('total_fob') ? 'PASS'
            : docTypes.has('COMMERCIAL_INVOICE') ? 'WARN' : 'FAIL',
          detail: hasField('invoice_number')
            ? `Invoice ${fieldMap['invoice_number']?.resolved_value} · FOB ${fieldMap['total_fob']?.resolved_value ?? 'missing'}`
            : 'Invoice not found or key fields not extracted',
        },
        {
          id: 2, name: 'Packing List Matches Invoice',
          description: 'Packing List available with weight and package data',
          status: docTypes.has('PACKING_LIST') && hasField('total_gross_weight_kg') && hasField('total_packages') ? 'PASS'
            : docTypes.has('PACKING_LIST') ? 'WARN' : 'FAIL',
          detail: hasField('total_gross_weight_kg')
            ? `${fieldMap['total_packages']?.resolved_value} packages · ${fieldMap['total_gross_weight_kg']?.resolved_value} KG`
            : 'Packing List not found or weight data missing',
        },
        {
          id: 3, name: 'Bill of Lading Valid',
          description: 'B/L available with number, vessel, and port data',
          status: docTypes.has('BILL_OF_LADING') && hasField('bl_number') && hasField('vessel_name') ? 'PASS'
            : docTypes.has('BILL_OF_LADING') ? 'WARN' : 'FAIL',
          detail: hasField('bl_number')
            ? `B/L ${fieldMap['bl_number']?.resolved_value} · Vessel: ${fieldMap['vessel_name']?.resolved_value ?? '-'}`
            : 'Bill of Lading not found or B/L number missing',
        },
        {
          id: 4, name: 'HS Code Available',
          description: 'HS Code for tariff classification available for all items',
          status: hasField('hs_codes', 0.60) || hasField('items', 0.60) ? 'PASS'
            : errorKeys.has('hs_codes') ? 'FAIL' : 'WARN',
          detail: hasField('hs_codes')
            ? `HS Codes extracted (confidence ${Math.round(parseFloat(fieldMap['hs_codes']?.confidence ?? 0) * 100)}%)`
            : 'HS Code not found — required for tariff classification',
        },
        {
          id: 5, name: 'CIF Value Available',
          description: 'CIF value in USD and IDR available',
          status: (hasField('nilai_cif_usd') || hasField('total_fob')) && hasField('kurs', 0.60) ? 'PASS'
            : hasField('total_fob') ? 'WARN' : 'FAIL',
          detail: hasField('nilai_cif_usd')
            ? `CIF USD: ${fieldMap['nilai_cif_usd']?.resolved_value} · Rate: ${fieldMap['kurs']?.resolved_value ?? '-'}`
            : hasField('total_fob') ? `FOB available (${fieldMap['total_fob']?.resolved_value}) — freight/insurance missing`
            : 'CIF value not available',
        },
        {
          id: 6, name: 'Shipper & Consignee Complete',
          description: 'Supplier and consignee names available in Invoice or B/L',
          status: hasField('supplier_name') && (hasField('consignee_name') || hasField('nama_importir')) ? 'PASS'
            : hasField('supplier_name') || hasField('consignee_name') ? 'WARN' : 'FAIL',
          detail: hasField('supplier_name')
            ? `Supplier: ${fieldMap['supplier_name']?.resolved_value?.slice(0, 40)} · Consignee: ${(fieldMap['consignee_name'] ?? fieldMap['nama_importir'])?.resolved_value?.slice(0, 30) ?? 'missing'}`
            : 'Shipper/consignee data not found',
        },
        {
          id: 7, name: 'Importer NPWP Verified',
          description: 'Importer NPWP available with high confidence (≥85%)',
          status: hasField('consignee_npwp', 0.85) || hasField('npwp_importir', 0.85) ? 'PASS'
            : hasField('consignee_npwp', 0.60) || hasField('npwp_importir', 0.60) ? 'WARN' : 'FAIL',
          detail: (() => {
            const npwp = fieldMap['consignee_npwp'] ?? fieldMap['npwp_importir'];
            if (!npwp) return 'NPWP not found — required for CEISA';
            const conf = Math.round(parseFloat(npwp.confidence) * 100);
            return `NPWP: ${npwp.resolved_value} · Confidence: ${conf}%${conf < 85 ? ' (manual verification required)' : ''}`;
          })(),
        },
        {
          id: 8, name: 'No Document Conflicts',
          description: 'No unresolved conflicts between documents',
          status: errors.length === 0 ? 'PASS' : errors.length <= 2 ? 'WARN' : 'FAIL',
          detail: errors.length === 0 ? 'All fields consistent across documents'
            : `${errors.length} field conflicts unresolved: ${errors.map((e: any) => e.field_key).join(', ')}`,
        },
        {
          id: 9, name: 'All Required Documents Present',
          description: 'Invoice, Packing List, and B/L all extracted',
          status: extractedDocs.some((d: any) => d.document_type === 'COMMERCIAL_INVOICE')
            && extractedDocs.some((d: any) => d.document_type === 'PACKING_LIST')
            && extractedDocs.some((d: any) => d.document_type === 'BILL_OF_LADING') ? 'PASS'
            : extractedDocs.length > 0 ? 'WARN' : 'FAIL',
          detail: `Extracted documents: ${extractedDocs.map((d: any) => d.document_type).join(', ') || 'none'}`,
        },
      ];

      const passed = checkpoints.filter(c => c.status === 'PASS').length;
      const warned = checkpoints.filter(c => c.status === 'WARN').length;
      const failed = checkpoints.filter(c => c.status === 'FAIL').length;
      const score = Math.round((passed / checkpoints.length) * 100);
      const overallStatus = failed === 0 && warned === 0 ? 'READY'
        : failed === 0 ? 'NEARLY_READY' : failed <= 2 ? 'NEEDS_ATTENTION' : 'NOT_READY';

      let reasoning = {
        summary: overallStatus === 'READY' ? 'All checkpoints passed — ready to submit to CEISA'
          : overallStatus === 'NEARLY_READY' ? `Almost ready — ${warned} checkpoints need attention`
          : `Not ready — ${failed} checkpoints failed`,
        recommendation: overallStatus === 'READY' ? 'Proceed to Draft BC 2.3 and submit to CEISA'
          : `Complete ${failed} failed checkpoints: ${checkpoints.filter(c => c.status === 'FAIL').map(c => c.name).join(', ')}`,
        failed_items: checkpoints.filter(c => c.status === 'FAIL').map(c => c.name),
        warned_items: checkpoints.filter(c => c.status === 'WARN').map(c => c.name),
      };

      // AI reasoning via OpenAI or Anthropic
      try {
        const { rows: [aiCfg] } = await client.query(
          `SELECT extraction_model_id, openai_api_key, anthropic_api_key, ai_provider FROM tenant_ai_config WHERE tenant_id = $1`,
          [tenantId]
        );

        const prompt = `Analyze CEISA readiness and provide concise recommendations (max 2 sentences each):
Score: ${score}% | Status: ${overallStatus}
PASS: ${checkpoints.filter(c=>c.status==='PASS').map(c=>c.name).join(', ')}
WARN: ${checkpoints.filter(c=>c.status==='WARN').map(c=>c.name).join(', ')}
FAIL: ${checkpoints.filter(c=>c.status==='FAIL').map(c=>c.name).join(', ')}

Respond in JSON: {"summary":"...","recommendation":"..."}`;

        if (aiCfg?.ai_provider === 'anthropic' && aiCfg?.anthropic_api_key) {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': aiCfg.anthropic_api_key, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: aiCfg.extraction_model_id ?? 'claude-sonnet-4-6', max_tokens: 256,
              messages: [{ role: 'user', content: prompt }] }),
          });
          const data = await res.json() as any;
          const text = data.content?.[0]?.text ?? '{}';
          const parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
          if (parsed.summary) reasoning = { ...reasoning, ...parsed };
        } else if (aiCfg?.ai_provider === 'openai' && aiCfg?.openai_api_key) {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiCfg.openai_api_key}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 256,
              messages: [{ role: 'user', content: prompt }] }),
          });
          const data = await res.json() as any;
          const text = data.choices?.[0]?.message?.content ?? '{}';
          const parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
          if (parsed.summary) reasoning = { ...reasoning, ...parsed };
        }
      } catch {}

      return {
        shipmentId, score, overallStatus, checkpoints, reasoning,
        summary: {
          pass: passed, warn: warned, fail: failed,
          totalFields: fields.length,
          mandatoryFieldsMissing: mandatoryFields.filter(mf => !hasField(mf.field_key, 0.60))
            .map(mf => ({ ...mf, docType: mf.doc_type_code })),
        },
      };
    });
  });
}
