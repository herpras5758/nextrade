import { Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PDFDocument } from 'pdf-lib';
import { getPool } from '../shared/dbPool.js';
import { EvidenceWriter } from '../shared/evidence/index.js';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;

interface PipelineEvent { documentId: string; tenantId: string; }

// ── Config loader ─────────────────────────────────────────────────────────────
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
  const fieldsByDocType: Record<string, any[]> = {};
  for (const f of fields) {
    if (!fieldsByDocType[f.doc_type_code]) fieldsByDocType[f.doc_type_code] = [];
    fieldsByDocType[f.doc_type_code].push(f);
  }
  return {
    aiCfg: aiCfg ?? {
      extraction_model_id: 'gpt-4o',
      extraction_max_tokens: 4096,
    },
    docTypes,
    fieldsByDocType,
  };
}

// ── Classify a single page ────────────────────────────────────────────────────
// ── AI Provider abstraction (Bedrock Claude/Nova + OpenAI) ──────────────────
function buildBedrockBody(model: string, contentBlocks: any[], textPrompt: string, maxTokens: number): string {
  const isNova = model.startsWith('amazon.nova') || model.startsWith('amazon.titan');
  if (isNova) {
    const novaContent: any[] = [];
    for (const block of contentBlocks) {
      if (block.type === 'document') {
        novaContent.push({ document: { format: 'pdf', name: 'doc', source: { bytes: block.source.data } } });
      } else if (block.type === 'image') {
        const fmt = block.source.media_type.split('/')[1];
        novaContent.push({ image: { format: fmt, source: { bytes: block.source.data } } });
      }
    }
    novaContent.push({ text: textPrompt });
    return JSON.stringify({
      messages: [{ role: 'user', content: novaContent }],
      inferenceConfig: { max_new_tokens: maxTokens },
    });
  } else {
    const claudeContent: any[] = contentBlocks.map(b => b);
    claudeContent.push({ type: 'text', text: textPrompt });
    return JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: claudeContent }],
    });
  }
}

function parseBedrockResponse(model: string, resBody: Uint8Array): string {
  const parsed = JSON.parse(new TextDecoder().decode(resBody));
  const isNova = model.startsWith('amazon.nova') || model.startsWith('amazon.titan');
  if (isNova) {
    return parsed.output?.message?.content?.[0]?.text ?? '{}';
  }
  return parsed.content?.[0]?.text ?? '{}';
}

// OpenAI API call
async function callOpenAI(
  apiKey: string,
  model: string,
  contentBlocks: any[],
  textPrompt: string,
  maxTokens: number
): Promise<string> {
  const messages: any[] = [];
  const userContent: any[] = [];

  for (const block of contentBlocks) {
    if (block.type === 'document') {
      // PDF as base64 file
      userContent.push({
        type: 'file',
        file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${block.source.data}` }
      });
    } else if (block.type === 'image') {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${block.source.media_type};base64,${block.source.data}`, detail: 'high' }
      });
    }
  }
  userContent.push({ type: 'text', text: textPrompt });
  messages.push({ role: 'user', content: userContent });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model ?? 'gpt-4o',
      max_tokens: maxTokens,
      messages,
      response_format: { type: 'text' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '{}';
}

// Anthropic direct API call
async function callAnthropic(
  apiKey: string,
  model: string,
  contentBlocks: any[],
  textPrompt: string,
  maxTokens: number
): Promise<string> {
  const messages: any[] = [];
  const userContent: any[] = [];

  for (const block of contentBlocks) {
    if (block.type === 'document') {
      userContent.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: block.source.data }
      });
    } else if (block.type === 'image') {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: block.source.media_type, data: block.source.data }
      });
    }
  }
  userContent.push({ type: 'text', text: textPrompt });
  messages.push({ role: 'user', content: userContent });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model ?? 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  return data.content?.[0]?.text ?? '{}';
}

// Universal invoke — picks provider based on model config
async function invokeAI(
  model: string,
  openaiApiKey: string | null,
  contentBlocks: any[],
  textPrompt: string,
  maxTokens: number,
  anthropicApiKey: string | null = null
): Promise<string> {
  const isOpenAI = model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3');
  const isAnthropic = model.startsWith('claude-') && !model.startsWith('claude-') === false;
  const isAnthropicDirect = anthropicApiKey && (model.startsWith('claude-') || !model.includes('.'));

  if (isOpenAI) {
    if (!openaiApiKey) throw new Error('OpenAI API key not configured');
    console.log('[Pipeline] Using OpenAI:', model);
    return await callOpenAI(openaiApiKey, model, contentBlocks, textPrompt, maxTokens);
  }

  if (isAnthropicDirect) {
    console.log('[Pipeline] Using Anthropic direct:', model);
    return await callAnthropic(anthropicApiKey!, model, contentBlocks, textPrompt, maxTokens);
  }

  // Bedrock (Claude or Nova)
  console.log('[Pipeline] Using Bedrock:', model);
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: model,
    contentType: 'application/json',
    accept: 'application/json',
    body: buildBedrockBody(model, contentBlocks, textPrompt, maxTokens),
  }));
  return parseBedrockResponse(model, res.body);
}

async function classifyContent(
  base64Data: string,
  mediaType: string,
  docTypes: any[],
  model: string,
  openaiApiKey: string | null = null,
  anthropicApiKey: string | null = null
): Promise<{ type: string; confidence: number }> {
  const hints = docTypes.map(dt =>
    `- ${dt.doc_type_code}: ${(dt.classification_hints ?? []).join(', ')}`
  ).join('\n');

  const prompt = `Klasifikasikan dokumen ini. Pilih SATU dari:\n${hints}\n- UNKNOWN\n\nJawab JSON saja: {"type":"COMMERCIAL_INVOICE","confidence":0.97}`;

  const contentBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };

  const text = await invokeAI(model, openaiApiKey, [contentBlock], prompt, 128, anthropicApiKey);
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { type: 'UNKNOWN', confidence: 0.5 };
  }
}

// ── Extract fields from content ───────────────────────────────────────────────
async function extractFields(
  base64Data: string,
  mediaType: string,
  docTypeCode: string,
  docTypeFields: any[],
  docTypes: any[],
  model: string,
  maxTokens: number,
  openaiApiKey: string | null = null,
  anthropicApiKey: string | null = null
): Promise<Record<string, any>> {
  const promptOverride = docTypes.find(dt => dt.doc_type_code === docTypeCode)?.extraction_prompt_override;
  const fieldList = docTypeFields
    .filter(f => f.is_enabled)
    .map(f => `  "${f.field_key}": ""  // ${f.display_name}${f.is_mandatory_ceisa ? ' [WAJIB CEISA]' : ''}`)
    .join(',\n');

  const prompt = promptOverride ?? `Ekstrak field dari dokumen ${docTypeCode}. Jawab HANYA JSON:\n{\n${fieldList},\n  "_confidence": {${docTypeFields.map(f => `"${f.field_key}":0.0`).join(',')}}\n}`;

  const contentBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };

  const text = await invokeAI(model, openaiApiKey, [contentBlock], prompt, Math.min(maxTokens * 2, 8192), anthropicApiKey);
  try {
    let jsonStr = text.replace(/```json|```/g, '').trim();
    const lastBrace = jsonStr.lastIndexOf('}');
    if (lastBrace > 0) jsonStr = jsonStr.substring(0, lastBrace + 1);
    return JSON.parse(jsonStr);
  } catch (e: any) {
    console.warn('[Pipeline] JSON parse failed:', e.message?.slice(0, 80));
    // Partial extraction via regex
    const result: Record<string, any> = {};
    for (const [, k, v] of text.matchAll(/"([^"]+)":\s*"([^"]*?)"/g)) {
      if (k !== '_confidence' && v) result[k] = v;
    }
    return result;
  }
}

// ── Write document + fields to DB ─────────────────────────────────────────────
async function writeDocumentAndFields(
  client: any,
  writer: EvidenceWriter,
  tenantId: string,
  parentDocId: string,
  shipmentId: string | null,
  fileName: string,
  s3Key: string,
  docTypeCode: string,
  extracted: Record<string, any>,
  confidenceMap: Record<string, number>,
  classificationConfidence: number,
  thresholdAuto: number,
  thresholdRecommended: number,
  fieldsByDocType: Record<string, any[]>
) {
  const category = {
    COMMERCIAL_INVOICE: 'COMMERCIAL', PACKING_LIST: 'COMMERCIAL', PURCHASE_ORDER: 'COMMERCIAL',
    BILL_OF_LADING: 'TRANSPORT', BC_2_3: 'CUSTOMS', BC_1_1: 'CUSTOMS', INWARD_MANIFEST: 'CUSTOMS',
    LETTER_OF_GUARANTEE: 'SUPPORTING',
  }[docTypeCode] ?? 'SUPPORTING';

  const evtDoc = await writer.writeEvent({
    tenantId, eventTime: new Date(), eventType: 'DOCUMENT_RECEIVED',
    producerType: 'EXTRACTION_ENGINE', producerRef: parentDocId,
    entityType: 'DOCUMENT',
    payload: { file_name: fileName, doc_type: docTypeCode, split_from: parentDocId },
  });

  // Use parent document record if same type, otherwise create new
  const isNewDoc = docTypeCode !== 'PARENT';
  let docId = parentDocId;

  if (isNewDoc && fileName !== (await client.query(`SELECT file_name FROM documents WHERE id=$1`,[parentDocId])).rows[0]?.file_name + '_segment') {
    const { rows: [newDoc] } = await client.query(
      `INSERT INTO documents
         (tenant_id, shipment_id, file_name, s3_key, document_type, category,
          status, intake_source, uploaded_by, origin_event_id, last_event_id, last_event_seq)
       VALUES ($1,$2,$3,$4,$5,$6,'extracting','pipeline','system',$7,$7,$8)
       RETURNING id`,
      [tenantId, shipmentId, fileName, s3Key, docTypeCode, category, evtDoc.id, evtDoc.sequenceNum]
    );
    docId = newDoc.id;
  } else {
    await client.query(
      `UPDATE documents SET document_type=$1, category=$2, status='extracting', last_event_id=$3 WHERE id=$4`,
      [docTypeCode, category, evtDoc.id, parentDocId]
    );
  }

  const docTypeFields = fieldsByDocType[docTypeCode] ?? [];
  const evtExtract = await writer.writeEvent({
    tenantId, eventTime: new Date(), eventType: 'DOCUMENT_EXTRACTED',
    producerType: 'EXTRACTION_ENGINE', producerRef: docId,
    entityType: 'DOCUMENT', entityId: docId,
    payload: { doc_type: docTypeCode, fields: Object.keys(extracted).length, model: 'bedrock' },
  });

  let fieldCount = 0;
  for (const [key, value] of Object.entries(extracted)) {
    if (!value || (typeof value === 'object' && !Array.isArray(value))) continue;
    const resolvedValue = Array.isArray(value) ? JSON.stringify(value) : String(value);
    const fieldCfg = docTypeFields.find((f: any) => f.field_key === key);
    const rawConf = confidenceMap[key] ?? (classificationConfidence * 0.85);
    const confidence = Math.max(0, Math.min(1, rawConf));
    const effectiveThreshold = fieldCfg?.confidence_threshold ?? thresholdAuto;
    const status = confidence >= effectiveThreshold ? 'auto_approved'
      : confidence >= thresholdRecommended ? 'recommended' : 'review_required';

    await client.query(
      `INSERT INTO ctdm_fields
         (tenant_id, shipment_id, document_id, field_key, resolved_value, confidence, status, last_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, shipment_id, document_id, field_key) DO UPDATE SET
         resolved_value=EXCLUDED.resolved_value, confidence=EXCLUDED.confidence,
         status=EXCLUDED.status`,
      [tenantId, shipmentId, docId, key, resolvedValue, confidence, status, evtExtract.id]
    );
    fieldCount++;
  }

  // Identity signals
  const SIGNAL_MAP: Record<string, string> = {
    invoice_number: 'INVOICE_NUMBER', bl_number: 'BL_NUMBER',
    po_number: 'PO_NUMBER', nomor_pendaftaran: 'BC_NUMBER',
    nomor_bc11: 'BC11_NUMBER', vessel_name: 'VESSEL_NAME',
  };
  for (const [fieldKey, signalType] of Object.entries(SIGNAL_MAP)) {
    const value = extracted[fieldKey];
    if (!value || String(value).trim() === '') continue;
    await client.query(
      `INSERT INTO identity_signals
         (tenant_id, signal_type, raw_value, normalized_value, source_document_id, confidence, is_active)
       VALUES ($1,$2,$3,$3,$4,$5,true)
       ON CONFLICT (tenant_id, signal_type, normalized_value) DO UPDATE SET
         confidence=GREATEST(identity_signals.confidence,EXCLUDED.confidence)`,
      [tenantId, signalType, String(value).trim(), docId, classificationConfidence]
    );
  }

  // Mark document extracted
  await client.query(
    `UPDATE documents SET status='extracted', last_event_id=$1 WHERE id=$2`,
    [evtExtract.id, docId]
  );

  return { docId, fieldCount };
}

// ── Split PDF into segments by document type ──────────────────────────────────
async function splitAndClassifyPDF(
  pdfBytes: Uint8Array,
  docTypes: any[],
  model: string,
  openaiApiKey: string | null = null,
  anthropicApiKey: string | null = null
): Promise<{ pageRange: [number, number]; type: string; confidence: number }[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  console.log('[Pipeline] PDF pages:', totalPages);

  if (totalPages === 1) {
    // Single page — classify whole doc
    const singlePdf = await PDFDocument.create();
    const [page] = await singlePdf.copyPages(pdfDoc, [0]);
    singlePdf.addPage(page);
    const singleBytes = await singlePdf.save();
    const b64 = Buffer.from(singleBytes).toString('base64');
    const cls = await classifyContent(b64, 'application/pdf', docTypes, model, openaiApiKey, anthropicApiKey);
    return [{ pageRange: [0, 0], type: cls.type, confidence: cls.confidence }];
  }

  // Classify each page independently (max 20 pages to control cost)
  const pagesToCheck = Math.min(totalPages, 20);
  const pageTypes: { type: string; confidence: number }[] = [];

  for (let i = 0; i < pagesToCheck; i++) {
    const singlePdf = await PDFDocument.create();
    const [page] = await singlePdf.copyPages(pdfDoc, [i]);
    singlePdf.addPage(page);
    const pageBytes = await singlePdf.save();
    const b64 = Buffer.from(pageBytes).toString('base64');
    const cls = await classifyContent(b64, 'application/pdf', docTypes, model, openaiApiKey, anthropicApiKey);
    pageTypes.push(cls);
    console.log(`[Pipeline] Page ${i + 1}/${pagesToCheck}: ${cls.type} (${Math.round(cls.confidence * 100)}%)`);
  }

  // Group consecutive same-type pages into segments
  const segments: { pageRange: [number, number]; type: string; confidence: number }[] = [];
  let segStart = 0;
  let currentType = pageTypes[0].type;
  let maxConf = pageTypes[0].confidence;

  for (let i = 1; i < pageTypes.length; i++) {
    if (pageTypes[i].type !== currentType) {
      segments.push({ pageRange: [segStart, i - 1], type: currentType, confidence: maxConf });
      segStart = i;
      currentType = pageTypes[i].type;
      maxConf = pageTypes[i].confidence;
    } else {
      maxConf = Math.max(maxConf, pageTypes[i].confidence);
    }
  }
  segments.push({ pageRange: [segStart, pagesToCheck - 1], type: currentType, confidence: maxConf });

  // If there are more pages beyond what we checked, add as last segment with same type
  if (totalPages > pagesToCheck) {
    const lastSeg = segments[segments.length - 1];
    lastSeg.pageRange[1] = totalPages - 1;
  }

  console.log('[Pipeline] Segments detected:', segments.map(s => `${s.type}[${s.pageRange[0]}-${s.pageRange[1]}]`));
  return segments;
}

// ── Extract segment as base64 PDF ─────────────────────────────────────────────
async function extractSegment(pdfBytes: Uint8Array, fromPage: number, toPage: number): Promise<string> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const segDoc = await PDFDocument.create();
  const pageIndices = Array.from({ length: toPage - fromPage + 1 }, (_, i) => fromPage + i);
  const pages = await segDoc.copyPages(pdfDoc, pageIndices);
  pages.forEach(p => segDoc.addPage(p));
  const segBytes = await segDoc.save();
  return Buffer.from(segBytes).toString('base64');
}

// ── Main handler ───────────────────────────────────────────────────────────────
export const handler: Handler<PipelineEvent> = async ({ documentId, tenantId }) => {
  console.log('[Pipeline] START', { documentId, tenantId });
  if (!documentId || !tenantId) {
    console.error('[Pipeline] ERROR Missing documentId or tenantId');
    return { success: false, error: 'Missing documentId or tenantId' };
  }

  const pool = await getPool();
  const client = await pool.connect();

  try {
    // 1. Load document + config
    const { rows: [doc] } = await client.query(
      `SELECT * FROM documents WHERE id=$1 AND tenant_id=$2`, [documentId, tenantId]
    );
    if (!doc) throw new Error(`Document ${documentId} not found`);

    const { aiCfg, docTypes, fieldsByDocType } = await loadConfig(client, tenantId);
    const model = aiCfg.extraction_model_id ?? 'amazon.nova-lite-v1:0';
    const maxTokens = aiCfg.extraction_max_tokens ?? 4096;
    const thresholdAuto = aiCfg.threshold_auto_approved ?? 0.85;
    const thresholdRecommended = aiCfg.threshold_recommended ?? 0.70;

    // 2. Update status → extracting
    await client.query(`UPDATE documents SET status='extracting' WHERE id=$1`, [documentId]);

    // 3. Download file from S3
    console.log('[Pipeline] Downloading:', doc.s3_key);
    const s3Obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: doc.s3_key }));
    const fileBytes = await s3Obj.Body!.transformToByteArray();
    const fileBuffer = Buffer.from(fileBytes);

    // 4. Detect media type
    const fileName = (doc.file_name ?? '').toLowerCase();
    const isPDF = !fileName.endsWith('.png') && !fileName.endsWith('.jpg')
      && !fileName.endsWith('.jpeg') && !fileName.endsWith('.webp');
    const mediaType = fileName.endsWith('.png') ? 'image/png'
      : fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') ? 'image/jpeg'
      : fileName.endsWith('.webp') ? 'image/webp'
      : 'application/pdf';

    console.log('[Pipeline] File type:', mediaType, 'for', doc.file_name);

    const writer = new EvidenceWriter(client);
    await client.query('BEGIN');

    let totalFields = 0;
    let segmentsProcessed = 0;

    if (isPDF) {
      // ── PDF: detect segments, extract per segment ──────────────────────────
      const segments = await splitAndClassifyPDF(fileBytes, docTypes, model, openaiApiKey, anthropicApiKey);

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        console.log(`[Pipeline] Processing segment ${i + 1}/${segments.length}: ${seg.type} pages ${seg.pageRange[0]}-${seg.pageRange[1]}`);

        const segBase64 = await extractSegment(fileBytes, seg.pageRange[0], seg.pageRange[1]);
        const docTypeFields = fieldsByDocType[seg.type] ?? [];

        // Extract fields from segment
        const extracted = docTypeFields.length > 0
          ? await extractFields(segBase64, 'application/pdf', seg.type, docTypeFields, docTypes, model, maxTokens, openaiApiKey, anthropicApiKey)
          : {};
        const confidenceMap = extracted._confidence ?? {};
        delete extracted._confidence;

        console.log(`[Pipeline] Segment ${i + 1} extracted ${Object.keys(extracted).length} fields`);

        // For first segment: update parent document record
        // For subsequent segments: create new document records
        if (i === 0) {
          const category = getCategory(seg.type);
          await client.query(
            `UPDATE documents SET document_type=$1, category=$2, status='extracting' WHERE id=$3`,
            [seg.type, category, documentId]
          );

          const evtExtract = await writer.writeEvent({
            tenantId, eventTime: new Date(), eventType: 'DOCUMENT_EXTRACTED',
            producerType: 'EXTRACTION_ENGINE', producerRef: documentId,
            entityType: 'DOCUMENT', entityId: documentId,
            payload: { doc_type: seg.type, fields: Object.keys(extracted).length, segment: i + 1, total_segments: segments.length },
          });

          totalFields += await writeFields(client, tenantId, doc.shipment_id, documentId, extracted, confidenceMap, seg.confidence, thresholdAuto, thresholdRecommended, docTypeFields, evtExtract.id);
          await writeSignals(client, tenantId, documentId, extracted, seg.confidence);
          await client.query(`UPDATE documents SET status='extracted', last_event_id=$1 WHERE id=$2`, [evtExtract.id, documentId]);

        } else {
          // Create new document record for each additional segment
          const segFileName = `${doc.file_name} [${seg.type} hal.${seg.pageRange[0] + 1}-${seg.pageRange[1] + 1}]`;
          const segS3Key = `${doc.s3_key}_segment_${i}`;

          // Save segment PDF to S3
          const segDoc = await PDFDocument.create();
          const srcDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
          const pageIndices = Array.from({ length: seg.pageRange[1] - seg.pageRange[0] + 1 }, (_, j) => seg.pageRange[0] + j);
          const pages = await segDoc.copyPages(srcDoc, pageIndices);
          pages.forEach(p => segDoc.addPage(p));
          const segBytes = await segDoc.save();

          await s3.send(new PutObjectCommand({
            Bucket: BUCKET, Key: segS3Key,
            Body: segBytes, ContentType: 'application/pdf',
          }));

          const evtDoc = await writer.writeEvent({
            tenantId, eventTime: new Date(), eventType: 'DOCUMENT_RECEIVED',
            producerType: 'EXTRACTION_ENGINE', producerRef: documentId,
            entityType: 'DOCUMENT',
            payload: { file_name: segFileName, split_from: documentId, segment: i + 1 },
          });

          const { rows: [newDoc] } = await client.query(
            `INSERT INTO documents
               (tenant_id, shipment_id, file_name, s3_key, document_type, category,
                status, intake_source, uploaded_by, origin_event_id, last_event_id, last_event_seq)
             VALUES ($1,$2,$3,$4,$5,$6,'extracting','pipeline','system',$7,$7,$8)
             RETURNING id`,
            [tenantId, doc.shipment_id, segFileName, segS3Key,
             seg.type, getCategory(seg.type), evtDoc.id, evtDoc.sequenceNum]
          );

          const evtExtract = await writer.writeEvent({
            tenantId, eventTime: new Date(), eventType: 'DOCUMENT_EXTRACTED',
            producerType: 'EXTRACTION_ENGINE', producerRef: newDoc.id,
            entityType: 'DOCUMENT', entityId: newDoc.id,
            payload: { doc_type: seg.type, fields: Object.keys(extracted).length, split_from: documentId },
          });

          totalFields += await writeFields(client, tenantId, doc.shipment_id, newDoc.id, extracted, confidenceMap, seg.confidence, thresholdAuto, thresholdRecommended, docTypeFields, evtExtract.id);
          await writeSignals(client, tenantId, newDoc.id, extracted, seg.confidence);
          await client.query(`UPDATE documents SET status='extracted', last_event_id=$1 WHERE id=$2`, [evtExtract.id, newDoc.id]);
        }

        segmentsProcessed++;
      }

    } else {
      // ── IMAGE: single classification + extraction ──────────────────────────
      const b64 = fileBuffer.toString('base64');
      const cls = await classifyContent(b64, mediaType, docTypes, model, openaiApiKey, anthropicApiKey);
      console.log('[Pipeline] Classification:', cls);

      const docTypeFields = fieldsByDocType[cls.type] ?? [];
      const extracted = docTypeFields.length > 0
        ? await extractFields(b64, mediaType, cls.type, docTypeFields, docTypes, model, maxTokens, openaiApiKey, anthropicApiKey)
        : {};
      const confidenceMap = extracted._confidence ?? {};
      delete extracted._confidence;

      console.log('[Pipeline] Extracted', Object.keys(extracted).length, 'fields');

      await client.query(
        `UPDATE documents SET document_type=$1, category=$2, status='extracting' WHERE id=$3`,
        [cls.type, getCategory(cls.type), documentId]
      );

      const evtExtract = await writer.writeEvent({
        tenantId, eventTime: new Date(), eventType: 'DOCUMENT_EXTRACTED',
        producerType: 'EXTRACTION_ENGINE', producerRef: documentId,
        entityType: 'DOCUMENT', entityId: documentId,
        payload: { doc_type: cls.type, fields: Object.keys(extracted).length },
      });

      totalFields += await writeFields(client, tenantId, doc.shipment_id, documentId, extracted, confidenceMap, cls.confidence, thresholdAuto, thresholdRecommended, docTypeFields, evtExtract.id);
      await writeSignals(client, tenantId, documentId, extracted, cls.confidence);
      await client.query(`UPDATE documents SET status='extracted', last_event_id=$1 WHERE id=$2`, [evtExtract.id, documentId]);
      segmentsProcessed = 1;
    }

    // Update shipment health
    if (doc.shipment_id) await updateShipmentHealth(client, doc.shipment_id, tenantId);

    await client.query('COMMIT');
    console.log('[Pipeline] DONE', { documentId, segments: segmentsProcessed, fields: totalFields });
    return { success: true, documentId, segments: segmentsProcessed, fieldsExtracted: totalFields };

  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    await client.query(`UPDATE documents SET status='needs_review' WHERE id=$1`, [documentId]).catch(() => {});
    console.error('[Pipeline] ERROR', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCategory(docType: string): string {
  const map: Record<string, string> = {
    COMMERCIAL_INVOICE: 'COMMERCIAL', PACKING_LIST: 'COMMERCIAL', PURCHASE_ORDER: 'COMMERCIAL',
    BILL_OF_LADING: 'TRANSPORT', BC_2_3: 'CUSTOMS', BC_1_1: 'CUSTOMS',
    INWARD_MANIFEST: 'CUSTOMS', LETTER_OF_GUARANTEE: 'SUPPORTING',
  };
  return map[docType] ?? 'SUPPORTING';
}

async function writeFields(
  client: any, tenantId: string, shipmentId: string | null, docId: string,
  extracted: Record<string, any>, confidenceMap: Record<string, number>,
  classConf: number, threshAuto: number, threshRecommended: number,
  docTypeFields: any[], evtId: string
): Promise<number> {
  let count = 0;
  for (const [key, value] of Object.entries(extracted)) {
    if (!value || (typeof value === 'object' && !Array.isArray(value))) continue;
    const resolvedValue = Array.isArray(value) ? JSON.stringify(value) : String(value);
    const rawConf = confidenceMap[key] ?? (classConf * 0.85);
    const confidence = Math.max(0, Math.min(1, rawConf));
    const fieldCfg = docTypeFields.find((f: any) => f.field_key === key);
    const effectiveThreshold = fieldCfg?.confidence_threshold ?? threshAuto;
    const status = confidence >= effectiveThreshold ? 'auto_approved'
      : confidence >= threshRecommended ? 'recommended' : 'review_required';

    await client.query(
      `INSERT INTO ctdm_fields
         (tenant_id, shipment_id, document_id, field_key, resolved_value, confidence, status, last_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, shipment_id, document_id, field_key) DO UPDATE SET
         resolved_value=EXCLUDED.resolved_value, confidence=EXCLUDED.confidence,
         status=EXCLUDED.status`,
      [tenantId, shipmentId, docId, key, resolvedValue, confidence, status, evtId]
    );
    count++;
  }
  return count;
}

async function writeSignals(client: any, tenantId: string, docId: string, extracted: Record<string, any>, conf: number) {
  const SIGNAL_MAP: Record<string, string> = {
    invoice_number: 'INVOICE_NUMBER', bl_number: 'BL_NUMBER',
    po_number: 'PO_NUMBER', nomor_pendaftaran: 'BC_NUMBER',
    nomor_bc11: 'BC11_NUMBER', vessel_name: 'VESSEL_NAME',
  };
  for (const [fieldKey, signalType] of Object.entries(SIGNAL_MAP)) {
    const value = extracted[fieldKey];
    if (!value || String(value).trim() === '') continue;
    await client.query(
      `INSERT INTO identity_signals
         (tenant_id, signal_type, raw_value, normalized_value, source_document_id, confidence, is_active)
       VALUES ($1,$2,$3,$3,$4,$5,true)
       ON CONFLICT (tenant_id, signal_type, normalized_value) DO UPDATE SET
         confidence=GREATEST(identity_signals.confidence,EXCLUDED.confidence)`,
      [tenantId, signalType, String(value).trim(), docId, conf]
    ).catch(() => {});
  }
}

async function updateShipmentHealth(client: any, shipmentId: string, tenantId: string) {
  const { rows: docs } = await client.query(
    `SELECT status FROM documents WHERE shipment_id=$1`, [shipmentId]
  );
  const { rows: [stats] } = await client.query(
    `SELECT AVG(confidence) as avg_conf,
            SUM(CASE WHEN status='review_required' THEN 1 ELSE 0 END) as needs_review
     FROM ctdm_fields WHERE shipment_id=$1 AND tenant_id=$2`,
    [shipmentId, tenantId]
  );

  const avgConf = parseFloat(stats?.avg_conf ?? '0');
  const needsReview = parseInt(stats?.needs_review ?? '0');
  const allExtracted = docs.every((d: any) => d.status === 'extracted');
  const health = needsReview > 5 ? 'CRITICAL' : needsReview > 0 || avgConf < 0.75 ? 'NEEDS_ATTENTION' : 'HEALTHY';

  await client.query(
    `UPDATE shipments SET health=$1, ceisa_readiness_score=$2,
       status=CASE WHEN $3 AND status='DRAFT' THEN 'UNDER_REVIEW' ELSE status END
     WHERE id=$4`,
    [health, Math.round(Math.min(avgConf * 100, 100)), allExtracted, shipmentId]
  );
}
