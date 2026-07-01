import { Handler } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getPool } from '../shared/dbPool.js';
import { EvidenceWriter } from '../shared/evidence/index.js';
import { findBestShipmentMatch, IncomingSignal } from '../shared/identity/shipmentMatcher.js';

const s3 = new S3Client({});
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;

interface DryRunEvent {
  sessionId: string;
  tenantId: string;
  userId: string;
}

// Categories that cannot auto-attach to READY_FOR_CEISA shipments
const PROTECTED_CATEGORIES = new Set(['COMMERCIAL', 'TRANSPORT', 'CUSTOMS']);

export const handler: Handler<DryRunEvent> = async ({ sessionId, tenantId, userId }) => {
  console.log('[DryRunAnalyze] START', { sessionId, tenantId, userId });
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const writer = new EvidenceWriter(client);

    // 1. Load all staged files for this session
    const { rows: files } = await client.query(
      `SELECT id, original_filename, s3_staging_key, file_size_bytes
       FROM upload_session_files WHERE session_id = $1`,
      [sessionId]
    );
    console.log('[DryRunAnalyze] files found:', files.length);

    const results = {
      autoAttach: [] as any[], suggest: [] as any[],
      manualReview: [] as any[], newShipment: [] as any[],
      conflict: [] as any[], duplicate: [] as any[],
    };

    for (const file of files) {
      // 2. Quick classify file type from filename + light Bedrock call
      const { detectedType, detectedCategory, extractedSignals } =
        await classifyAndExtractSignals(file.original_filename, file.s3_staging_key);

      // 3. Duplicate check: same filename + size already in documents
      const { rows: dupes } = await client.query(
        `SELECT id FROM documents WHERE tenant_id = $1 AND file_name = $2
         AND ABS(file_size_bytes - $3) < 1024 LIMIT 1`,
        [tenantId, file.original_filename, file.file_size_bytes]
      );

      if (dupes.length > 0) {
        await updateFileResult(client, file.id, {
          detectedType, detectedCategory,
          action: 'DUPLICATE', tier: 'DUPLICATE',
          matchedShipmentId: null, confidence: 1.0,
          analysisDetail: { duplicate_of: dupes[0].id },
        });
        results.duplicate.push({ fileId: file.id, name: file.original_filename, duplicateOf: dupes[0].id });
        continue;
      }

      // 4. Run shipment matching via Identity Graph
      const match = await findBestShipmentMatch(client, tenantId, extractedSignals, detectedCategory);

      // 5. Handle conflict case
      if (match.isConflict && PROTECTED_CATEGORIES.has(detectedCategory)) {
        await updateFileResult(client, file.id, {
          detectedType, detectedCategory,
          action: 'PENDING_CONFLICT_RESOLUTION', tier: 'CONFLICT',
          matchedShipmentId: match.shipmentId!, confidence: match.confidence,
          analysisDetail: {
            match_tier: match.tier, reasoning: match.reasoning,
            shipment_status: match.shipmentStatus,
            conflict_category: match.conflictCategory,
          },
        });
        results.conflict.push({ fileId: file.id, name: file.original_filename, ...match });
        continue;
      }

      // 6. Normal attachment
      const tier = match.tier === 'NEW_SHIPMENT' ? 'NEW_SHIPMENT' : match.tier;
      await updateFileResult(client, file.id, {
        detectedType, detectedCategory, action: tier,
        tier, matchedShipmentId: match.shipmentId ?? null,
        confidence: match.confidence,
        analysisDetail: { reasoning: match.reasoning, signals: extractedSignals.map(s => s.signalType) },
      });

      const entry = { fileId: file.id, name: file.original_filename, shipmentId: match.shipmentId, confidence: match.confidence, reasoning: match.reasoning };
      if (tier === 'AUTO_ATTACH')   results.autoAttach.push(entry);
      else if (tier === 'SUGGEST')  results.suggest.push(entry);
      else if (tier === 'MANUAL_REVIEW') results.manualReview.push(entry);
      else                          results.newShipment.push(entry);
    }

    // 7. Build summary and update session
    const summary = {
      totalFiles: files.length,
      autoAttach: results.autoAttach.length,
      suggest: results.suggest.length,
      manualReview: results.manualReview.length,
      newShipment: results.newShipment.length,
      conflict: results.conflict.length,
      duplicate: results.duplicate.length,
      canCommit: results.conflict.length === 0,
      details: results,
    };
    console.log('[DryRunAnalyze] summary built:', JSON.stringify({ ...summary, details: undefined }));

    // Write event FIRST — then UPDATE with real event id (no empty string UUID)
    const evt = await writer.writeEvent({
      tenantId, eventTime: new Date(), eventType: 'UPLOAD_SESSION_ANALYZED',
      producerType: 'DRY_RUN_ENGINE', producerRef: sessionId,
      entityType: 'SESSION', entityId: sessionId,
      payload: { summary, user_id: userId },
    });

    await client.query(
      `UPDATE upload_sessions SET status = 'PREVIEWED', summary = $1, last_event_id = $2
       WHERE id = $3`,
      [JSON.stringify(summary), evt.id, sessionId]
    );

    await client.query('COMMIT');
    return { success: true, summary };
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[DryRunAnalyze]', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
};

async function updateFileResult(client: any, fileId: string, data: any) {
  await client.query(
    `UPDATE upload_session_files
     SET detected_type = $1, detected_category = $2, action = $3,
         confidence_tier = $4, matched_shipment_id = $5,
         match_confidence = $6, analysis_detail = $7
     WHERE id = $8`,
    [data.detectedType, data.detectedCategory, data.action, data.tier,
     data.matchedShipmentId, data.confidence, JSON.stringify(data.analysisDetail), fileId]
  );
}

// Lightweight classification using filename + optional Bedrock call
async function classifyAndExtractSignals(
  filename: string,
  s3Key: string
): Promise<{ detectedType: string; detectedCategory: string; extractedSignals: IncomingSignal[] }> {
  const lower = filename.toLowerCase();
  let detectedType = 'Unknown';
  let detectedCategory = 'SUPPORTING';

  // Filename-based heuristics (fast path before Bedrock)
  if (lower.includes('inv') || lower.includes('invoice')) { detectedType = 'Invoice'; detectedCategory = 'COMMERCIAL'; }
  else if (lower.includes('pl') || lower.includes('packing')) { detectedType = 'Packing List'; detectedCategory = 'COMMERCIAL'; }
  else if (lower.includes('bl') || lower.includes('bill') || lower.includes('lading')) { detectedType = 'Bill of Lading'; detectedCategory = 'TRANSPORT'; }
  else if (lower.includes('po') || lower.includes('purchase')) { detectedType = 'Purchase Order'; detectedCategory = 'COMMERCIAL'; }
  else if (lower.includes('pib') || lower.includes('bc') || lower.includes('manifest')) { detectedType = 'PIB'; detectedCategory = 'CUSTOMS'; }
  else if (lower.includes('cert')) { detectedType = 'Certificate'; detectedCategory = 'COMPLIANCE'; }

  // Extract signals from filename (lightweight — full extraction happens post-commit in pipeline)
  const signals: IncomingSignal[] = [];

  // PO number pattern: PO followed by digits
  const poMatch = filename.match(/PO[-_\s]?(\d{6,})/i);
  if (poMatch) signals.push({ signalType: 'PO_NUMBER', rawValue: poMatch[0], confidence: 0.75 });

  // Invoice number pattern
  const invMatch = filename.match(/INV[-_\s]?([\w\d]+)/i);
  if (invMatch) signals.push({ signalType: 'INVOICE_NUMBER', rawValue: invMatch[0], confidence: 0.70 });

  // BL number pattern
  const blMatch = filename.match(/BL[-_\s]?([\w\d]+)/i) || filename.match(/[A-Z]{4}\d{7}/);
  if (blMatch) signals.push({ signalType: 'BL_NUMBER', rawValue: blMatch[0], confidence: 0.70 });

  return { detectedType, detectedCategory, extractedSignals: signals };
}
