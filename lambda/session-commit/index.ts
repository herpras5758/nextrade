import { Handler } from 'aws-lambda';
import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getPool } from '../shared/dbPool.js';
import { EvidenceWriter } from '../shared/evidence/index.js';

const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
const lambda = new LambdaClient({});
const BUCKET = process.env.DOCUMENTS_BUCKET_NAME!;
const TRIGGER_FN = process.env.TRIGGER_PIPELINE_FUNCTION_NAME!;

interface CommitEvent {
  sessionId: string;
  tenantId: string;
  userId: string;
}

export const handler: Handler<CommitEvent> = async ({ sessionId, tenantId, userId }) => {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const writer = new EvidenceWriter(client);

    // 1. Verify session is in PREVIEWED state and all conflicts resolved
    const { rows: [session] } = await client.query(
      `SELECT id, status, summary FROM upload_sessions WHERE id = $1 AND tenant_id = $2`,
      [sessionId, tenantId]
    );
    if (!session) throw new Error('Session not found');
    if (session.status !== 'PREVIEWED') throw new Error(`Cannot commit session in status ${session.status}`);
    const summary = session.summary;
    if (summary.conflict > 0) throw new Error('All conflicts must be resolved before commit');

    // 2. Load files to commit (skip duplicates and skipped)
    const { rows: files } = await client.query(
      `SELECT id, original_filename, s3_staging_key, file_size_bytes,
              detected_type, detected_category, action,
              matched_shipment_id, match_confidence, analysis_detail
       FROM upload_session_files
       WHERE session_id = $1 AND action NOT IN ('DUPLICATE', 'SKIP')`,
      [sessionId]
    );

    const committed: string[] = [];

    const shipmentIds: string[] = [];
    for (const file of files) {
      // 3. Copy from staging → uploads
      const destKey = `uploads/${tenantId}/${crypto.randomUUID()}-${file.original_filename}`;
      await s3.send(new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${file.s3_staging_key}`,
        Key: destKey,
      }));

      // 4. Write DOCUMENT_RECEIVED event (this is when the document officially enters the system)
      const evt = await writer.writeEvent({
        tenantId, eventTime: new Date(), eventType: 'DOCUMENT_RECEIVED',
        producerType: 'DRY_RUN_ENGINE', producerRef: sessionId,
        entityType: 'DOCUMENT',
        payload: {
          file_name: file.original_filename,
          s3_key: destKey,
          category: file.detected_category,
          document_type: file.detected_type,
          intake_source: 'bulk_upload',
          session_id: sessionId,
        },
      });

      // 5. Insert document projection
      const { rows: [doc] } = await client.query(
        `INSERT INTO documents
           (tenant_id, shipment_id, file_name, s3_key, file_size_bytes,
            document_type, category, status, intake_source, intake_session_id,
            uploaded_by, origin_event_id, last_event_id, last_event_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'uploaded','bulk_upload',$8,$9,$10,$10,$11)
         RETURNING id`,
        [tenantId, file.matched_shipment_id ?? null, file.original_filename, destKey,
         file.file_size_bytes, file.detected_type, file.detected_category,
         sessionId, userId, evt.id, evt.sequenceNum]
      );

      // 6. Update session file with committed document id
      await client.query(
        `UPDATE upload_session_files SET committed_document_id = $1 WHERE id = $2`,
        [doc.id, file.id]
      );

      committed.push(doc.id);

      // 7. If matched to existing shipment, write SHIPMENT_MATCHED event and update
      if (file.matched_shipment_id && file.action !== 'NEW_SHIPMENT') {
        await writer.writeEvent({
          tenantId, eventTime: new Date(), eventType: 'SHIPMENT_MATCHED',
          producerType: 'DRY_RUN_ENGINE', producerRef: sessionId,
          entityType: 'SHIPMENT', entityId: file.matched_shipment_id,
          payload: { document_id: doc.id, confidence: file.match_confidence, action: file.action },
        });
        await client.query(
          `UPDATE documents SET shipment_id = $1 WHERE id = $2`,
          [file.matched_shipment_id, doc.id]
        );
        if (!shipmentIds.includes(file.matched_shipment_id)) shipmentIds.push(file.matched_shipment_id);
      }

      // 7b. NEW_SHIPMENT — create shipment record
      if (file.action === 'NEW_SHIPMENT' || !file.matched_shipment_id) {
        const num = `SHP-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 99999)).padStart(5,'0')}`;
        const { rows: [newShipment] } = await client.query(
          `INSERT INTO shipments (tenant_id, shipment_number, status, health, ceisa_readiness_score)
           VALUES ($1, $2, 'DRAFT', 'NEEDS_ATTENTION', 0) RETURNING id`,
          [tenantId, num]
        );
        await client.query(`UPDATE documents SET shipment_id = $1 WHERE id = $2`, [newShipment.id, doc.id]);
        await writer.writeEvent({
          tenantId, eventTime: new Date(), eventType: 'SHIPMENT_CREATED',
          producerType: 'DRY_RUN_ENGINE', producerRef: sessionId,
          entityType: 'SHIPMENT', entityId: newShipment.id,
          payload: { shipment_number: num, document_id: doc.id },
        });
        if (!shipmentIds.includes(newShipment.id)) shipmentIds.push(newShipment.id);
      }
    }

    // 8. Mark session committed
    const commitEvt = await writer.writeEvent({
      tenantId, eventTime: new Date(), eventType: 'UPLOAD_SESSION_COMMITTED',
      producerType: 'DRY_RUN_ENGINE', producerRef: sessionId,
      entityType: 'SESSION', entityId: sessionId,
      payload: { committed_count: committed.length, user_id: userId },
    });

    await client.query(
      `UPDATE upload_sessions SET status = 'COMMITTED', committed_at = NOW(),
       last_event_id = $1 WHERE id = $2`,
      [commitEvt.id, sessionId]
    );

    await client.query('COMMIT');

    // 9. Trigger pipeline for each committed document (async, post-commit)
    console.log('[SessionCommit] triggering pipeline for', committed.length, 'docs, TRIGGER_FN:', process.env.TRIGGER_PIPELINE_FUNCTION_NAME);
    for (const docId of committed) {
      try {
        await lambda.send(new InvokeCommand({
          FunctionName: TRIGGER_FN,
          InvocationType: 'Event',  // async
          Payload: Buffer.from(JSON.stringify({ documentId: docId, tenantId })),
        }));
      } catch (e) {
        console.error('[SessionCommit] pipeline trigger FAILED for', docId, JSON.stringify(e));
      }
    }

    return { success: true, committedDocuments: committed.length, shipmentIds, shipmentId: shipmentIds[0] ?? null };
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[SessionCommit]', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
};
