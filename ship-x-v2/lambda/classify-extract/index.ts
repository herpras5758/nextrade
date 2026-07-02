/**
 * classify-extract Lambda
 *
 * Triggered by S3 → SQS after upload.
 * Handles all three scenarios:
 *   A. Single file = 1 doc type  → classify → extract → graph → resolution queue
 *   B. Single file = multi doc   → split pages → create child docs → each extracted
 *   C. Mass upload               → each file processed independently via SQS
 *
 * ADR-009: Graph written by this Lambda, not by user
 * ADR-010: Triggers resolution engine only for affected component
 * ADR-011: All doc relationships via shared entities, not direct edges
 */

import { Handler, SQSEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { PDFDocument } from 'pdf-lib';
import { getPool } from '../shared/dbPool.js';
import { callAI, parseJsonResponse, AiConfig, ContentBlock } from '../shared/aiProvider.js';
import { writeDocumentToGraph, GraphSignal, normalizeEntityValue } from '../shared/graph/graphWriter.js';

const s3 = new S3Client({});
const sqs = new SQSClient({});
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;
const RESOLUTION_QUEUE = process.env.RESOLUTION_QUEUE_URL!;

interface ClassifyExtractMessage {
  documentId: string;
  tenantId: string;
  s3Key: string;
  skipClassify?: boolean;   // true for split children (already classified)
  docTypeOverride?: string; // for split children
}

export const handler: Handler<SQSEvent> = async (event) => {
  const pool = await getPool();

  for (const record of event.Records) {
    const msg: ClassifyExtractMessage = JSON.parse(record.body);
    const { documentId, tenantId, s3Key } = msg;

    const client = await pool.connect();
    try {
      console.log('[ClassifyExtract] START', { documentId, tenantId });

      // Load document
      const { rows: [doc] } = await client.query(
        `SELECT * FROM documents WHERE id=$1 AND tenant_id=$2`, [documentId, tenantId]
      );
      if (!doc) { console.error('[ClassifyExtract] Document not found:', documentId); continue; }

      // Load AI config
      const { rows: [aiCfg] } = await client.query(
        `SELECT * FROM tenant_ai_config WHERE tenant_id=$1`, [tenantId]
      );
      if (!aiCfg?.anthropic_api_key && !aiCfg?.openai_api_key) {
        await setDocError(client, documentId, 'No AI provider configured');
        continue;
      }

      // Load doc type configs
      const { rows: docTypes } = await client.query(
        `SELECT * FROM tenant_doc_type_config WHERE tenant_id=$1 AND is_enabled=true`, [tenantId]
      );

      // Download file
      await setDocStatus(client, documentId, 'classifying');
      console.log('[ClassifyExtract] Downloading:', s3Key);
      const s3Obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
      const fileBytes = await s3Obj.Body!.transformToByteArray();
      const fileName = doc.file_name.toLowerCase();
      const isPDF = !fileName.endsWith('.png') && !fileName.endsWith('.jpg') && !fileName.endsWith('.jpeg');
      const mediaType = fileName.endsWith('.png') ? 'image/png'
        : fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ? 'image/jpeg'
        : 'application/pdf';

      let docTypeResult: { type: string; confidence: number; isMultiDoc: boolean };

      if (msg.skipClassify && msg.docTypeOverride) {
        // Split child — already classified
        docTypeResult = { type: msg.docTypeOverride, confidence: 1.0, isMultiDoc: false };
      } else {
        // Classify
        docTypeResult = await classifyDocument(fileBytes, mediaType, isPDF, docTypes, aiCfg);
        console.log('[ClassifyExtract] Classified:', docTypeResult);
      }

      await client.query(
        `UPDATE documents SET status='classified', doc_type=$1, doc_type_confidence=$2,
           classified_at=NOW(), updated_at=NOW() WHERE id=$3`,
        [docTypeResult.type, docTypeResult.confidence, documentId]
      );

      // Handle multi-doc PDF (Scenario B)
      if (docTypeResult.isMultiDoc && isPDF) {
        console.log('[ClassifyExtract] Multi-doc detected, splitting...');
        await handleMultiDocPDF(client, fileBytes, documentId, tenantId, aiCfg, docTypes);
        // Parent doc marked as split — children will each trigger their own resolution
        continue;
      }

      // Single doc type — extract fields
      await setDocStatus(client, documentId, 'extracting');
      const { rows: fieldConfigs } = await client.query(
        `SELECT * FROM tenant_field_config WHERE tenant_id=$1 AND doc_type_code=$2 AND is_enabled=true ORDER BY sort_order`,
        [tenantId, docTypeResult.type]
      );

      const b64 = Buffer.from(fileBytes).toString('base64');
      const contentBlock: ContentBlock = isPDF
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } };

      let extracted: Record<string, any> = {};
      if (fieldConfigs.length > 0) {
        extracted = await extractFields(contentBlock, docTypeResult.type, fieldConfigs, aiCfg);
        console.log('[ClassifyExtract] Extracted', Object.keys(extracted).length, 'fields');
      }

      // Write event
      const { rows: [evt] } = await client.query(
        `INSERT INTO evidence_events (tenant_id, event_type, actor_type, entity_type, entity_id, payload)
         VALUES ($1,'DOCUMENT_EXTRACTED','ai','DOCUMENT',$2,$3) RETURNING id`,
        [tenantId, documentId, JSON.stringify({ doc_type: docTypeResult.type, field_count: Object.keys(extracted).length })]
      );

      // Write field_extractions
      const confidenceMap: Record<string, number> = extracted._confidence ?? {};
      delete extracted._confidence;

      await setDocStatus(client, documentId, 'extracted');
      await client.query(`BEGIN`);

      for (const [key, value] of Object.entries(extracted)) {
        if (!value || typeof value === 'object' && !Array.isArray(value)) continue;
        const rawValue = Array.isArray(value) ? JSON.stringify(value) : String(value);
        const conf = Math.min(1, Math.max(0, confidenceMap[key] ?? (docTypeResult.confidence * 0.85)));
        const status = conf >= (aiCfg.threshold_auto_approved ?? 0.85) ? 'auto_approved' : 'review_required';
        const normalized = normalizeForDisplay(key, rawValue);

        await client.query(
          `INSERT INTO field_extractions
             (tenant_id, document_id, field_key, raw_value, normalized_value, display_value,
              confidence, status, extraction_model, last_event_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (document_id, field_key) DO UPDATE SET
             raw_value=EXCLUDED.raw_value, normalized_value=EXCLUDED.normalized_value,
             confidence=EXCLUDED.confidence, status=EXCLUDED.status, updated_at=NOW()`,
          [tenantId, documentId, key, rawValue, normalized, rawValue,
           conf, status, aiCfg.extraction_model_id ?? 'claude-sonnet-4-6', evt.id]
        );
      }

      await client.query(`COMMIT`);
      await setDocStatus(client, documentId, 'normalizing');

      // Build graph signals from extracted fields
      const signals: GraphSignal[] = [];
      for (const fc of fieldConfigs) {
        if (!fc.is_graph_signal || !fc.graph_entity_type) continue;
        const value = extracted[fc.field_key];
        if (!value || typeof value !== 'string') continue;
        const conf = confidenceMap[fc.field_key] ?? docTypeResult.confidence;
        signals.push({
          fieldKey: fc.field_key,
          entityType: fc.graph_entity_type,
          rawValue: String(value),
          normalizedValue: normalizeEntityValue(String(value), fc.graph_entity_type),
          confidence: conf,
        });
      }

      // Write to knowledge graph
      await client.query(`BEGIN`);
      const graphResult = await writeDocumentToGraph(client, tenantId, documentId, signals, evt.id);
      await client.query(`COMMIT`);

      console.log('[ClassifyExtract] Graph written:', {
        entities: graphResult.entityNodeIds.length,
        edges: graphResult.edgeIds.length,
      });

      await client.query(
        `UPDATE documents SET status='normalized', normalized_at=NOW(), linked_at=NOW(),
           updated_at=NOW(), last_event_id=$1 WHERE id=$2`,
        [evt.id, documentId]
      );

      // Trigger resolution engine with entity node IDs
      await sqs.send(new SendMessageCommand({
        QueueUrl: RESOLUTION_QUEUE,
        MessageBody: JSON.stringify({
          documentId,
          tenantId,
          entityNodeIds: graphResult.entityNodeIds,
        }),
      }));

      console.log('[ClassifyExtract] DONE', { documentId, signals: signals.length });

    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      await setDocError(client, documentId, err.message).catch(() => {});
      console.error('[ClassifyExtract] ERROR', documentId, err.message);
    } finally {
      client.release();
    }
  }
};

// ── Classify document ─────────────────────────────────────────────────────────
async function classifyDocument(
  fileBytes: Uint8Array,
  mediaType: string,
  isPDF: boolean,
  docTypes: any[],
  aiCfg: AiConfig
): Promise<{ type: string; confidence: number; isMultiDoc: boolean }> {

  const b64 = Buffer.from(fileBytes).toString('base64');
  const contentBlock: ContentBlock = isPDF
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } };

  const hints = docTypes.map(dt =>
    `- ${dt.doc_type_code}: ${(dt.classification_hints ?? []).join(', ')}`
  ).join('\n');

  const prompt = `Classify this trade document. Choose ONE from:
${hints}
- MULTI_DOCUMENT (if this file contains multiple different document types, e.g. Invoice + Packing List + BL in one PDF)

Respond ONLY with JSON: {"type":"COMMERCIAL_INVOICE","confidence":0.97,"is_multi_doc":false}
If is_multi_doc is true, do not guess the type.`;

  const text = await callAI(aiCfg, [contentBlock], prompt, 150);
  const parsed = parseJsonResponse(text);

  return {
    type: parsed.type ?? 'UNKNOWN',
    confidence: parseFloat(parsed.confidence) || 0.5,
    isMultiDoc: !!parsed.is_multi_doc,
  };
}

// ── Extract fields ────────────────────────────────────────────────────────────
async function extractFields(
  contentBlock: ContentBlock,
  docType: string,
  fieldConfigs: any[],
  aiCfg: AiConfig
): Promise<Record<string, any>> {
  const fields = fieldConfigs
    .filter(f => f.field_key !== 'items' || true)  // include items
    .map(f => `  "${f.field_key}": ""  // ${f.display_name}${f.is_mandatory_ceisa ? ' [CEISA MANDATORY]' : ''}`)
    .join(',\n');

  const itemInstruction = fieldConfigs.some(f => f.field_key === 'items')
    ? '\nFor "items": extract as JSON array: [{"description":"...","qty":"...","unit":"...","unit_price":"...","amount":"...","hs_code":"..."}]'
    : '';

  const prompt = `Extract ALL fields from this ${docType} document.
Return ONLY valid JSON:
{
${fields},
  "_confidence": {${fieldConfigs.map(f => `"${f.field_key}":0.0`).join(',')}}
}
${itemInstruction}
Extract exactly as shown in document. Empty string if not found.`;

  const text = await callAI(aiCfg, [contentBlock], prompt, aiCfg.extraction_max_tokens ?? 4096);
  return parseJsonResponse(text);
}

// ── Handle multi-doc PDF (Scenario B) ────────────────────────────────────────
async function handleMultiDocPDF(
  client: any,
  fileBytes: Uint8Array,
  parentDocId: string,
  tenantId: string,
  aiCfg: AiConfig,
  docTypes: any[]
): Promise<void> {
  const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  console.log('[ClassifyExtract] PDF pages:', totalPages);

  // Classify each page
  const pageTypes: { type: string; confidence: number }[] = [];
  const maxPages = Math.min(totalPages, 25); // cost control

  for (let i = 0; i < maxPages; i++) {
    const singlePdf = await PDFDocument.create();
    const [page] = await singlePdf.copyPages(pdfDoc, [i]);
    singlePdf.addPage(page);
    const pageBytes = await singlePdf.save();
    const b64 = Buffer.from(pageBytes).toString('base64');

    const hints = docTypes.map(dt => `- ${dt.doc_type_code}`).join('\n');
    const prompt = `Classify this single page. Choose ONE:\n${hints}\n- UNKNOWN\nJSON only: {"type":"COMMERCIAL_INVOICE","confidence":0.97}`;

    try {
      const text = await callAI(aiCfg, [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      ], prompt, 80);
      const parsed = parseJsonResponse(text);
      pageTypes.push({ type: parsed.type ?? 'UNKNOWN', confidence: parseFloat(parsed.confidence) || 0.5 });
    } catch {
      pageTypes.push({ type: 'UNKNOWN', confidence: 0.3 });
    }
    console.log(`[ClassifyExtract] Page ${i + 1}/${maxPages}: ${pageTypes[i].type}`);
  }

  // Group consecutive same-type pages into segments
  const segments: { start: number; end: number; type: string; confidence: number }[] = [];
  let segStart = 0;
  let currentType = pageTypes[0].type;
  let maxConf = pageTypes[0].confidence;

  for (let i = 1; i < pageTypes.length; i++) {
    if (pageTypes[i].type !== currentType) {
      segments.push({ start: segStart, end: i - 1, type: currentType, confidence: maxConf });
      segStart = i; currentType = pageTypes[i].type; maxConf = pageTypes[i].confidence;
    } else {
      maxConf = Math.max(maxConf, pageTypes[i].confidence);
    }
  }
  segments.push({ start: segStart, end: maxPages - 1, type: currentType, confidence: maxConf });

  // Extend last segment to cover remaining pages
  if (totalPages > maxPages) segments[segments.length - 1].end = totalPages - 1;

  console.log('[ClassifyExtract] Segments:', segments.map(s => `${s.type}[${s.start}-${s.end}]`));

  // Get parent doc info
  const { rows: [parentDoc] } = await client.query(
    `SELECT * FROM documents WHERE id=$1`, [parentDocId]
  );

  // Mark parent as split
  await client.query(
    `UPDATE documents SET status='split', doc_type='MULTI_DOCUMENT', updated_at=NOW() WHERE id=$1`,
    [parentDocId]
  );

  // Create child document for each segment + queue for extraction
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'UNKNOWN') continue;

    // Extract segment pages to new PDF
    const segPdf = await PDFDocument.create();
    const srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
    const pageIndices = Array.from({ length: seg.end - seg.start + 1 }, (_, j) => seg.start + j);
    const pages = await segPdf.copyPages(srcDoc, pageIndices);
    pages.forEach(p => segPdf.addPage(p));
    const segBytes = await segPdf.save();

    // Upload segment to S3
    const segS3Key = `${parentDoc.s3_key}_segment_${i}_${seg.type.toLowerCase()}`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: segS3Key,
      Body: segBytes, ContentType: 'application/pdf',
    }));

    // Create child document record
    const segFileName = `${parentDoc.file_name} [${seg.type} p.${seg.start + 1}-${seg.end + 1}]`;
    const { rows: [childDoc] } = await client.query(
      `INSERT INTO documents
         (tenant_id, file_name, s3_key, mime_type, parent_document_id,
          page_range_start, page_range_end, is_split_child,
          status, uploaded_by, intake_source)
       VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,true,'uploaded',$7,'split')
       RETURNING id`,
      [tenantId, segFileName, segS3Key, parentDocId, seg.start, seg.end, parentDoc.uploaded_by]
    );

    // Queue for extraction (skip re-classification)
    await sqs.send(new SendMessageCommand({
      QueueUrl: process.env.CLASSIFY_EXTRACT_QUEUE_URL ?? RESOLUTION_QUEUE,
      MessageBody: JSON.stringify({
        documentId: childDoc.id,
        tenantId,
        s3Key: segS3Key,
        skipClassify: true,
        docTypeOverride: seg.type,
      }),
    }));

    console.log('[ClassifyExtract] Child document created:', childDoc.id, seg.type);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeForDisplay(fieldKey: string, value: string): string {
  // Numbers: strip extra whitespace
  if (['total_fob','gross_weight_kg','total_packages'].includes(fieldKey)) {
    return value.trim();
  }
  // Names: title case
  if (['supplier_name','consignee_name'].includes(fieldKey)) {
    return value.trim();
  }
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

async function setDocStatus(client: any, documentId: string, status: string): Promise<void> {
  await client.query(
    `UPDATE documents SET status=$1, updated_at=NOW() WHERE id=$2`,
    [status, documentId]
  );
}

async function setDocError(client: any, documentId: string, message: string): Promise<void> {
  await client.query(
    `UPDATE documents SET status='error', error_message=$1, updated_at=NOW() WHERE id=$2`,
    [message.slice(0, 500), documentId]
  );
}
