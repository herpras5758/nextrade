import { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getPool } from '../shared/dbPool.js';
import { EvidenceWriter } from '../shared/evidence/index.js';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;

interface PipelineEvent { documentId: string; tenantId: string; }

// ── Load config from DB ────────────────────────────────────────────────────────
async function loadConfig(client: any, tenantId: string) {
  const { rows: [aiCfg] } = await client.query(
    `SELECT * FROM tenant_ai_config WHERE tenant_id = $1`, [tenantId]
  );
  const { rows: docTypes } = await client.query(
    `SELECT * FROM tenant_doc_type_config WHERE tenant_id = $1 AND is_enabled = true`, [tenantId]
  );
  const { rows: fields } = await client.query(
    `SELECT * FROM tenant_doc_field_config WHERE tenant_id = $1 AND is_enabled = true ORDER BY sort_order`, [tenantId]
  );

  // Group fields by doc_type_code
  const fieldsByDocType: Record<string, any[]> = {};
  for (const f of fields) {
    if (!fieldsByDocType[f.doc_type_code]) fieldsByDocType[f.doc_type_code] = [];
    fieldsByDocType[f.doc_type_code].push(f);
  }

  return {
    aiCfg: aiCfg ?? {
      extraction_model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      extraction_max_tokens: 4096,
      extraction_approach: 'bedrock_vision',
      threshold_auto_approved: 0.85,
      threshold_recommended: 0.70,
    },
    docTypes,
    fieldsByDocType,
  };
}

// ── Build extraction prompt from field config ─────────────────────────────────
function buildExtractionPrompt(docTypeCode: string, fields: any[]): string {
  const fieldList = fields
    .filter(f => f.is_enabled)
    .map(f => `  "${f.field_key}": ""  // ${f.display_name}${f.is_mandatory_ceisa ? ' [WAJIB CEISA]' : ''}${f.ceisa_field_ref ? ` (BC ref: ${f.ceisa_field_ref})` : ''}`)
    .join(',\n');

  const mandatoryList = fields.filter(f => f.is_mandatory_ceisa).map(f => f.field_key).join(', ');

  return `Kamu adalah sistem ekstraksi data dokumen trade Indonesia.
Ekstrak field berikut dari dokumen ${docTypeCode}.
Field dengan [WAJIB CEISA] HARUS diisi — sangat penting untuk kepatuhan bea cukai.
Field mandatory CEISA: ${mandatoryList}

Untuk setiap field yang diekstrak, tambahkan confidence score (0.0-1.0) di objek "_confidence".
Jawab HANYA dengan format JSON valid, tanpa teks lain:

{
${fieldList},
  "_confidence": {
${fields.map(f => `    "${f.field_key}": 0.0`).join(',\n')}
  }
}

Jika field tidak ditemukan atau tidak jelas, isi dengan string kosong "" dan confidence 0.0.
Untuk array (items, hs_codes, container_numbers), kembalikan sebagai JSON array.`;
}

// ── Build classification prompt from doc type hints ───────────────────────────
function buildClassificationPrompt(docTypes: any[]): string {
  const hints = docTypes.map(dt =>
    `- ${dt.doc_type_code}: ${(dt.classification_hints ?? []).join(', ')}`
  ).join('\n');

  return `Kamu adalah sistem klasifikasi dokumen trade/customs Indonesia.
Klasifikasikan dokumen ini ke salah satu kategori berikut berdasarkan isi dokumen:

${hints}
- UNKNOWN: tidak termasuk kategori di atas

Jawab HANYA dengan format JSON:
{"type": "COMMERCIAL_INVOICE", "confidence": 0.97, "language": "id"}`;
}

// ── Get nested value ──────────────────────────────────────────────────────────
function getNestedValue(obj: any, path: string): string | null {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return null;
    const idx = parseInt(part);
    current = isNaN(idx) ? current[part] : current[idx];
  }
  return current != null ? String(current) : null;
}

function getDocCategory(docTypes: any[], docTypeCode: string): string {
  const found = docTypes.find(dt => dt.doc_type_code === docTypeCode);
  return found?.category ?? 'SUPPORTING';
}

// ── Main handler ───────────────────────────────────────────────────────────────
export const handler: Handler<PipelineEvent> = async ({ documentId, tenantId }) => {
  console.log('[Pipeline] START', { documentId, tenantId });
  const pool = await getPool();
  const client = await pool.connect();

  try {
    // 1. Load document
    const { rows: [doc] } = await client.query(
      `SELECT * FROM documents WHERE id = $1 AND tenant_id = $2`,
      [documentId, tenantId]
    );
    if (!doc) throw new Error(`Document ${documentId} not found`);

    // 2. Load all config from DB — Rule #4, no hardcode
    const { aiCfg, docTypes, fieldsByDocType } = await loadConfig(client, tenantId);
    const extractionModel = aiCfg.extraction_model_id ?? 'anthropic.claude-3-5-sonnet-20241022-v2:0';
    const maxTokens = aiCfg.extraction_max_tokens ?? 4096;
    const thresholdAuto = aiCfg.threshold_auto_approved ?? 0.85;
    const thresholdRecommended = aiCfg.threshold_recommended ?? 0.70;

    // 3. Update status → extracting
    await client.query(`UPDATE documents SET status = 'extracting' WHERE id = $1`, [documentId]);

    // 4. Download PDF from S3
    console.log('[Pipeline] Downloading:', doc.s3_key);
    const s3Obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: doc.s3_key }));
    const pdfBytes = await s3Obj.Body!.transformToByteArray();
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    // 5. Classify document — prompt built from DB config
    console.log('[Pipeline] Classifying...');
    const classifyPrompt = buildClassificationPrompt(docTypes);
    const classifyRes = await bedrock.send(new InvokeModelCommand({
      modelId: extractionModel,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: classifyPrompt },
          ],
        }],
      }),
    }));

    const classifyParsed = JSON.parse(new TextDecoder().decode(classifyRes.body));
    const classifyText = classifyParsed.content?.[0]?.text ?? '{}';
    let classification: { type: string; confidence: number; language: string };
    try {
      classification = JSON.parse(classifyText.replace(/```json|```/g, '').trim());
    } catch {
      classification = { type: 'UNKNOWN', confidence: 0.5, language: 'id' };
    }
    console.log('[Pipeline] Classification:', classification);

    const docTypeCode = classification.type ?? 'UNKNOWN';
    const docTypeFields = fieldsByDocType[docTypeCode] ?? [];

    // 6. Extract fields — prompt generated from DB field config
    let extracted: Record<string, any> = {};
    let confidenceMap: Record<string, number> = {};

    if (docTypeFields.length > 0 || docTypeCode === 'UNKNOWN') {
      const extractionPrompt = docTypes.find(dt => dt.doc_type_code === docTypeCode)?.extraction_prompt_override
        ?? buildExtractionPrompt(docTypeCode, docTypeFields);

      console.log('[Pipeline] Extracting', docTypeFields.length, 'fields for', docTypeCode);
      const extractRes = await bedrock.send(new InvokeModelCommand({
        modelId: extractionModel,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: maxTokens,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
              { type: 'text', text: extractionPrompt },
            ],
          }],
        }),
      }));

      const extractParsed = JSON.parse(new TextDecoder().decode(extractRes.body));
      const extractText = extractParsed.content?.[0]?.text ?? '{}';
      try {
        extracted = JSON.parse(extractText.replace(/```json|```/g, '').trim());
        confidenceMap = extracted._confidence ?? {};
        delete extracted._confidence;
      } catch {
        console.warn('[Pipeline] Failed to parse extraction JSON');
      }
    }

    console.log('[Pipeline] Extracted', Object.keys(extracted).length, 'fields');

    // 7. Write evidence event
    const writer = new EvidenceWriter(client);
    const evt = await writer.writeEvent({
      tenantId, eventTime: new Date(), eventType: 'DOCUMENT_EXTRACTED',
      producerType: 'EXTRACTION_ENGINE', producerRef: documentId,
      entityType: 'DOCUMENT', entityId: documentId,
      payload: {
        doc_type: docTypeCode,
        classification_confidence: classification.confidence,
        fields_extracted: Object.keys(extracted).length,
        model_used: extractionModel,
        fields_expected: docTypeFields.length,
      },
    });

    await client.query('BEGIN');

    // 8. Update document type
    await client.query(
      `UPDATE documents SET document_type = $1, category = $2, status = 'extracting', last_event_id = $3 WHERE id = $4`,
      [docTypeCode, getDocCategory(docTypes, docTypeCode), evt.id, documentId]
    );

    // 9. Write ctdm_fields
    for (const [key, value] of Object.entries(extracted)) {
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object' && !Array.isArray(value)) continue;

      const resolvedValue = Array.isArray(value) ? JSON.stringify(value) : String(value);

      // Use field-specific threshold if configured, else tenant default
      const fieldCfg = docTypeFields.find((f: any) => f.field_key === key);
      const fieldThreshold = fieldCfg?.confidence_threshold ?? null;
      const rawConfidence = confidenceMap[key] ?? (classification.confidence * 0.85);
      const confidence = Math.max(0, Math.min(1, rawConfidence));

      const effectiveThreshold = fieldThreshold ?? thresholdAuto;
      const status = confidence >= effectiveThreshold ? 'auto_approved'
        : confidence >= thresholdRecommended ? 'recommended' : 'review_required';

      await client.query(
        `INSERT INTO ctdm_fields
           (tenant_id, shipment_id, document_id, field_key, resolved_value, confidence, status, last_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, shipment_id, document_id, field_key) DO UPDATE SET
           resolved_value = EXCLUDED.resolved_value, confidence = EXCLUDED.confidence,
           status = EXCLUDED.status, updated_at = NOW()`,
        [tenantId, doc.shipment_id, documentId, key, resolvedValue, confidence, status, evt.id]
      );
    }

    // 10. Validate mandatory CEISA fields — flag missing ones
    for (const fieldCfg of docTypeFields.filter((f: any) => f.is_mandatory_ceisa)) {
      const value = extracted[fieldCfg.field_key];
      if (!value || value === '') {
        await client.query(
          `INSERT INTO validation_errors
             (tenant_id, shipment_id, document_id, field_key, rule_code,
              expected_value, actual_value, severity, resolved)
           VALUES ($1,$2,$3,$4,'MANDATORY_CEISA_MISSING','<required>','',
                  'ERROR', false)
           ON CONFLICT DO NOTHING`,
          [tenantId, doc.shipment_id, documentId, fieldCfg.field_key]
        );
      }
    }

    // 11. Write identity signals from key fields
    const SIGNAL_MAP: Record<string, string> = {
      invoice_number: 'INVOICE_NUMBER', bl_number: 'BL_NUMBER',
      po_number: 'PO_NUMBER', nomor_pendaftaran: 'BC_NUMBER',
      nomor_bc11: 'BC11_NUMBER', vessel_name: 'VESSEL_NAME',
    };
    for (const [fieldKey, signalType] of Object.entries(SIGNAL_MAP)) {
      const value = extracted[fieldKey];
      if (!value || value.trim() === '') continue;
      const conf = confidenceMap[fieldKey] ?? classification.confidence;
      await client.query(
        `INSERT INTO identity_signals
           (tenant_id, signal_type, raw_value, normalized_value, source_document_id, confidence, is_active)
         VALUES ($1,$2,$3,$3,$4,$5,true)
         ON CONFLICT (tenant_id, signal_type, normalized_value) DO UPDATE SET
           confidence = GREATEST(identity_signals.confidence, EXCLUDED.confidence), updated_at = NOW()`,
        [tenantId, signalType, String(value).trim(), documentId, conf]
      );
    }

    // 12. Update document → extracted
    await client.query(
      `UPDATE documents SET status = 'extracted', last_event_id = $1 WHERE id = $2`,
      [evt.id, documentId]
    );

    // 13. Update shipment health
    if (doc.shipment_id) {
      const { rows: allDocs } = await client.query(
        `SELECT status FROM documents WHERE shipment_id = $1`, [doc.shipment_id]
      );
      const { rows: fieldStats } = await client.query(
        `SELECT AVG(confidence) as avg_conf,
                SUM(CASE WHEN status = 'review_required' THEN 1 ELSE 0 END) as needs_review
         FROM ctdm_fields WHERE shipment_id = $1 AND tenant_id = $2`,
        [doc.shipment_id, tenantId]
      );
      const { rows: validationCount } = await client.query(
        `SELECT COUNT(*) as cnt FROM validation_errors WHERE shipment_id = $1 AND resolved = false`,
        [doc.shipment_id]
      );

      const avgConf = parseFloat(fieldStats[0]?.avg_conf ?? '0');
      const needsReview = parseInt(fieldStats[0]?.needs_review ?? '0');
      const validationErrors = parseInt(validationCount[0]?.cnt ?? '0');
      const allExtracted = allDocs.every((d: any) => d.status === 'extracted');

      const health = validationErrors > 5 || needsReview > 5 ? 'CRITICAL'
        : validationErrors > 0 || needsReview > 0 || avgConf < 0.75 ? 'NEEDS_ATTENTION'
        : 'HEALTHY';

      const readinessScore = Math.round(Math.min(avgConf * 100, 100));

      await client.query(
        `UPDATE shipments SET health = $1, ceisa_readiness_score = $2,
           status = CASE WHEN $3 AND status = 'DRAFT' THEN 'UNDER_REVIEW' ELSE status END,
           last_event_id = $4
         WHERE id = $5`,
        [health, readinessScore, allExtracted, evt.id, doc.shipment_id]
      );
    }

    await client.query('COMMIT');
    console.log('[Pipeline] DONE', { documentId, docTypeCode, fields: Object.keys(extracted).length });
    return { success: true, documentId, docTypeCode, fieldsExtracted: Object.keys(extracted).length };

  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    await client.query(`UPDATE documents SET status = 'needs_review' WHERE id = $1`, [documentId]).catch(() => {});
    console.error('[Pipeline] ERROR', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
};
