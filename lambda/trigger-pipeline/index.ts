import { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getPool } from '../shared/dbPool.js';
import { EvidenceWriter } from '../shared/evidence/index.js';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;

interface PipelineEvent {
  documentId: string;
  tenantId: string;
}

// ── Document type detection prompts ───────────────────────────────────────────
const CLASSIFICATION_PROMPT = `Kamu adalah sistem klasifikasi dokumen trade/customs Indonesia.
Klasifikasikan dokumen ini ke salah satu kategori berikut:
COMMERCIAL_INVOICE, PACKING_LIST, BILL_OF_LADING, PURCHASE_ORDER, BC_2_3, BC_1_1, 
INWARD_MANIFEST, LETTER_OF_GUARANTEE, COO, UNKNOWN

Jawab HANYA dengan format JSON:
{"type": "COMMERCIAL_INVOICE", "confidence": 0.97, "language": "en"}`;

const EXTRACTION_PROMPTS: Record<string, string> = {
  COMMERCIAL_INVOICE: `Ekstrak field berikut dari Commercial Invoice ini. Jawab HANYA JSON:
{
  "invoice_number": "",
  "invoice_date": "",
  "supplier_name": "",
  "supplier_address": "",
  "supplier_country": "",
  "consignee_name": "",
  "consignee_address": "",
  "consignee_npwp": "",
  "po_number": "",
  "payment_terms": "",
  "incoterm": "",
  "currency": "",
  "total_fob": "",
  "items": [{"description":"","hs_code":"","qty":"","unit":"","unit_price":"","amount":""}],
  "_confidence": {"invoice_number": 0.0, "total_fob": 0.0, "supplier_name": 0.0}
}`,

  PACKING_LIST: `Ekstrak field dari Packing List ini. Jawab HANYA JSON:
{
  "packing_list_number": "",
  "invoice_reference": "",
  "date": "",
  "supplier_name": "",
  "consignee_name": "",
  "total_packages": "",
  "total_gross_weight_kg": "",
  "total_net_weight_kg": "",
  "total_cbm": "",
  "items": [{"description":"","hs_code":"","qty":"","packages":"","gross_weight":"","net_weight":"","dimensions":""}],
  "_confidence": {"total_gross_weight_kg": 0.0, "total_net_weight_kg": 0.0}
}`,

  BILL_OF_LADING: `Ekstrak field dari Bill of Lading ini. Jawab HANYA JSON:
{
  "bl_number": "",
  "bl_date": "",
  "shipper_name": "",
  "consignee_name": "",
  "notify_party": "",
  "vessel_name": "",
  "voyage_number": "",
  "port_of_loading": "",
  "port_of_discharge": "",
  "place_of_delivery": "",
  "total_packages": "",
  "gross_weight_kg": "",
  "measurement_cbm": "",
  "freight_terms": "",
  "container_numbers": [],
  "seal_numbers": [],
  "_confidence": {"bl_number": 0.0, "vessel_name": 0.0, "gross_weight_kg": 0.0}
}`,

  PURCHASE_ORDER: `Ekstrak field dari Purchase Order ini. Jawab HANYA JSON:
{
  "po_number": "",
  "po_date": "",
  "buyer_name": "",
  "buyer_address": "",
  "supplier_name": "",
  "supplier_code": "",
  "currency": "",
  "payment_terms": "",
  "delivery_terms": "",
  "incoterm": "",
  "items": [{"item_code":"","description":"","qty":"","unit":"","unit_price":"","total":""}],
  "grand_total": "",
  "_confidence": {"po_number": 0.0, "grand_total": 0.0}
}`,

  BC_2_3: `Ekstrak field dari BC 2.3 (Pemberitahuan Impor Barang TPB) ini. Jawab HANYA JSON:
{
  "nomor_pengajuan": "",
  "nomor_pendaftaran": "",
  "tanggal_pendaftaran": "",
  "kantor_pabean": "",
  "kode_kantor_pabean": "",
  "npwp_importir": "",
  "nama_importir": "",
  "alamat_importir": "",
  "npwp_pemilik": "",
  "nama_pemilik": "",
  "invoice_number": "",
  "bl_number": "",
  "bc11_number": "",
  "vessel_name": "",
  "voyage_number": "",
  "port_loading": "",
  "port_discharge": "",
  "currency": "",
  "nilai_fob": "",
  "freight": "",
  "asuransi": "",
  "nilai_cif_usd": "",
  "nilai_cif_idr": "",
  "kurs": "",
  "total_packages": "",
  "gross_weight_kg": "",
  "net_weight_kg": "",
  "hs_codes": [{"pos_tarif":"","uraian":"","kategori":"","negara_asal":"","bm_pct":"","ppn_pct":"","net_weight":"","nilai_cif":""}],
  "bm_total": "",
  "ppn_total": "",
  "total_pungutan": "",
  "_confidence": {"nomor_pendaftaran": 0.0, "nilai_cif_idr": 0.0, "npwp_importir": 0.0}
}`,

  BC_1_1: `Ekstrak field dari Inward Manifest BC 1.1 ini. Jawab HANYA JSON:
{
  "nomor_bc11": "",
  "tanggal_bc11": "",
  "kantor_pabean": "",
  "vessel_name": "",
  "voyage_number": "",
  "bl_number": "",
  "shipper_name": "",
  "consignee_name": "",
  "total_packages": "",
  "gross_weight_kg": "",
  "container_numbers": [],
  "hs_codes": [],
  "_confidence": {"nomor_bc11": 0.0, "bl_number": 0.0}
}`,

  INWARD_MANIFEST: `Ekstrak field dari Inward Manifest ini. Jawab HANYA JSON:
{
  "nomor_bc11": "",
  "tanggal": "",
  "kantor_pabean": "",
  "vessel_name": "",
  "voyage": "",
  "bl_number": "",
  "shipper": "",
  "consignee": "",
  "total_packages": "",
  "gross_weight_kg": "",
  "hs_codes": [],
  "container_numbers": [],
  "_confidence": {"nomor_bc11": 0.0, "bl_number": 0.0}
}`,

  LETTER_OF_GUARANTEE: `Ekstrak field dari Letter of Guarantee ini. Jawab HANYA JSON:
{
  "lg_date": "",
  "issuer_name": "",
  "beneficiary": "",
  "bl_reference": "",
  "vessel_name": "",
  "amount": "",
  "currency": "",
  "_confidence": {"bl_reference": 0.0, "amount": 0.0}
}`,

  UNKNOWN: `Ekstrak informasi yang tersedia dari dokumen ini. Jawab HANYA JSON:
{
  "document_title": "",
  "date": "",
  "issuer": "",
  "reference_numbers": [],
  "key_values": {},
  "_confidence": {}
}`,
};

// ── Identity signal mapping ────────────────────────────────────────────────────
const IDENTITY_SIGNAL_MAPPING: Record<string, { field: string; signalType: string; weight: number }[]> = {
  COMMERCIAL_INVOICE: [
    { field: 'invoice_number', signalType: 'INVOICE_NUMBER', weight: 0.20 },
    { field: 'po_number',      signalType: 'PO_NUMBER',      weight: 0.35 },
  ],
  BILL_OF_LADING: [
    { field: 'bl_number',          signalType: 'BL_NUMBER',         weight: 0.30 },
    { field: 'container_numbers.0',signalType: 'CONTAINER_NUMBER',  weight: 0.25 },
  ],
  PURCHASE_ORDER: [
    { field: 'po_number', signalType: 'PO_NUMBER', weight: 0.35 },
  ],
  BC_2_3: [
    { field: 'invoice_number',     signalType: 'INVOICE_NUMBER', weight: 0.20 },
    { field: 'bl_number',          signalType: 'BL_NUMBER',      weight: 0.30 },
    { field: 'nomor_pendaftaran',  signalType: 'BC_NUMBER',      weight: 0.25 },
  ],
  BC_1_1: [
    { field: 'bl_number',   signalType: 'BL_NUMBER',   weight: 0.30 },
    { field: 'nomor_bc11',  signalType: 'BC11_NUMBER',  weight: 0.20 },
  ],
  INWARD_MANIFEST: [
    { field: 'bl_number',   signalType: 'BL_NUMBER',   weight: 0.30 },
    { field: 'nomor_bc11',  signalType: 'BC11_NUMBER',  weight: 0.20 },
  ],
};

// ── Get nested value from object ───────────────────────────────────────────────
function getNestedValue(obj: any, path: string): string | null {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return null;
    const idx = parseInt(part);
    current = isNaN(idx) ? current[part] : current[idx];
  }
  return current ? String(current) : null;
}

// ── Main handler ───────────────────────────────────────────────────────────────
export const handler: Handler<PipelineEvent> = async ({ documentId, tenantId }) => {
  console.log('[Pipeline] START', { documentId, tenantId });
  const pool = await getPool();
  const client = await pool.connect();

  try {
    // 1. Load document + tenant config
    const { rows: [doc] } = await client.query(
      `SELECT d.*, t.config as tenant_config
       FROM documents d JOIN tenants t ON t.id = d.tenant_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [documentId, tenantId]
    );
    if (!doc) throw new Error(`Document ${documentId} not found`);

    const tenantConfig = doc.tenant_config ?? {};
    const extractionModel = tenantConfig.extraction_model_id
      ?? 'anthropic.claude-3-5-sonnet-20241022-v2:0';
    const maxTokens = tenantConfig.extraction_max_tokens ?? 4096;

    // 2. Update status → extracting
    await client.query(
      `UPDATE documents SET status = 'extracting' WHERE id = $1`,
      [documentId]
    );

    // 3. Download PDF from S3
    console.log('[Pipeline] Downloading from S3:', doc.s3_key);
    const s3Obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: doc.s3_key }));
    const pdfBytes = await s3Obj.Body!.transformToByteArray();
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

    // 4. Classify document type
    console.log('[Pipeline] Classifying document...');
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
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            { type: 'text', text: CLASSIFICATION_PROMPT },
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

    const docType = classification.type ?? 'UNKNOWN';
    const extractionPrompt = EXTRACTION_PROMPTS[docType] ?? EXTRACTION_PROMPTS.UNKNOWN;

    // 5. Extract fields
    console.log('[Pipeline] Extracting fields for type:', docType);
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
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            { type: 'text', text: extractionPrompt },
          ],
        }],
      }),
    }));

    const extractParsed = JSON.parse(new TextDecoder().decode(extractRes.body));
    const extractText = extractParsed.content?.[0]?.text ?? '{}';
    let extracted: Record<string, any>;
    try {
      extracted = JSON.parse(extractText.replace(/```json|```/g, '').trim());
    } catch {
      extracted = {};
    }
    console.log('[Pipeline] Extracted fields:', Object.keys(extracted).length);

    const confidenceMap: Record<string, number> = extracted._confidence ?? {};
    delete extracted._confidence;

    // 6. Write evidence event
    const writer = new EvidenceWriter(client);
    const evt = await writer.writeEvent({
      tenantId, eventTime: new Date(), eventType: 'DOCUMENT_EXTRACTED',
      producerType: 'EXTRACTION_ENGINE', producerRef: documentId,
      entityType: 'DOCUMENT', entityId: documentId,
      payload: {
        doc_type: docType,
        classification_confidence: classification.confidence,
        fields_extracted: Object.keys(extracted).length,
        model_used: extractionModel,
      },
    });

    // 7. Write ctdm_fields to DB
    await client.query('BEGIN');

    // Update document with detected type
    await client.query(
      `UPDATE documents SET
         document_type = $1,
         category = $2,
         status = 'extracting',
         last_event_id = $3
       WHERE id = $4`,
      [
        docType,
        getDocCategory(docType),
        evt.id,
        documentId,
      ]
    );

    // Insert ctdm_fields
    for (const [key, value] of Object.entries(extracted)) {
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object' && !Array.isArray(value)) continue; // skip nested objects

      const resolvedValue = Array.isArray(value) ? JSON.stringify(value) : String(value);
      const confidence = confidenceMap[key] ?? classification.confidence * 0.85;

      const status = confidence >= 0.85 ? 'auto_approved'
        : confidence >= 0.70 ? 'recommended' : 'review_required';

      await client.query(
        `INSERT INTO ctdm_fields
           (tenant_id, shipment_id, document_id, field_key, resolved_value,
            confidence, status, last_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, shipment_id, document_id, field_key) DO UPDATE SET
           resolved_value = EXCLUDED.resolved_value,
           confidence = EXCLUDED.confidence,
           status = EXCLUDED.status,
           updated_at = NOW()`,
        [
          tenantId,
          doc.shipment_id,
          documentId,
          key,
          resolvedValue,
          confidence,
          status,
          evt.id,
        ]
      );
    }

    // 8. Write identity signals
    const signalMappings = IDENTITY_SIGNAL_MAPPING[docType] ?? [];
    for (const mapping of signalMappings) {
      const value = getNestedValue(extracted, mapping.field);
      if (!value || value.trim() === '' || value === 'null') continue;

      await client.query(
        `INSERT INTO identity_signals
           (tenant_id, signal_type, raw_value, normalized_value,
            source_document_id, confidence, is_active)
         VALUES ($1,$2,$3,$3,$4,$5,true)
         ON CONFLICT (tenant_id, signal_type, normalized_value) DO UPDATE SET
           confidence = GREATEST(identity_signals.confidence, EXCLUDED.confidence),
           updated_at = NOW()`,
        [tenantId, mapping.signalType, value.trim(), documentId, mapping.weight * classification.confidence]
      );
    }

    // 9. Update document status → extracted
    await client.query(
      `UPDATE documents SET status = 'extracted', last_event_id = $1 WHERE id = $2`,
      [evt.id, documentId]
    );

    // 10. Update shipment health
    if (doc.shipment_id) {
      await updateShipmentHealth(client, doc.shipment_id, tenantId, evt.id);
    }

    await client.query('COMMIT');
    console.log('[Pipeline] DONE', { documentId, docType, fields: Object.keys(extracted).length });

    return { success: true, documentId, docType, fieldsExtracted: Object.keys(extracted).length };

  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    // Mark document as needs_review on error
    await client.query(
      `UPDATE documents SET status = 'needs_review' WHERE id = $1`,
      [documentId]
    ).catch(() => {});
    console.error('[Pipeline] ERROR', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
};

function getDocCategory(docType: string): string {
  const map: Record<string, string> = {
    COMMERCIAL_INVOICE: 'COMMERCIAL',
    PACKING_LIST:       'COMMERCIAL',
    PURCHASE_ORDER:     'COMMERCIAL',
    BILL_OF_LADING:     'TRANSPORT',
    BC_2_3:             'CUSTOMS',
    BC_1_1:             'CUSTOMS',
    INWARD_MANIFEST:    'CUSTOMS',
    LETTER_OF_GUARANTEE:'SUPPORTING',
  };
  return map[docType] ?? 'SUPPORTING';
}

async function updateShipmentHealth(client: any, shipmentId: string, tenantId: string, eventId: string) {
  const { rows: docs } = await client.query(
    `SELECT status, document_type FROM documents
     WHERE shipment_id = $1 AND tenant_id = $2`,
    [shipmentId, tenantId]
  );

  const { rows: fields } = await client.query(
    `SELECT AVG(confidence) as avg_conf,
            SUM(CASE WHEN status = 'review_required' THEN 1 ELSE 0 END) as needs_review
     FROM ctdm_fields WHERE shipment_id = $1 AND tenant_id = $2`,
    [shipmentId, tenantId]
  );

  const avgConf = parseFloat(fields[0]?.avg_conf ?? '0');
  const needsReview = parseInt(fields[0]?.needs_review ?? '0');
  const hasAllExtracted = docs.every((d: any) => d.status === 'extracted');

  const health = needsReview > 3 ? 'CRITICAL'
    : needsReview > 0 || avgConf < 0.75 ? 'NEEDS_ATTENTION'
    : 'HEALTHY';

  const readinessScore = Math.round(Math.min(avgConf * 100, 100));

  await client.query(
    `UPDATE shipments SET
       health = $1, ceisa_readiness_score = $2,
       status = CASE WHEN $3 THEN 'UNDER_REVIEW' ELSE status END,
       last_event_id = $4
     WHERE id = $5`,
    [health, readinessScore, hasAllExtracted, eventId, shipmentId]
  );
}
