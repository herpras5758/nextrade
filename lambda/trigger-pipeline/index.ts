// Trigger Pipeline — fired by the EventBridge "Object Created" rule
// (pipeline-stack.ts) whenever a file lands under uploads/{tenantId}/...
// in the documents bucket. Looks up the corresponding documents row
// (registered by api/src/routes/documents.ts POST /documents right after
// the S3 PUT succeeds) to get shipmentId, then starts one Step Functions
// execution per document.

import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { withTenant } from "../shared/dbPool.js";

const sfn = new SFNClient({});

interface S3EventBridgeDetail {
  bucket: { name: string };
  object: { key: string };
}

interface EventBridgeS3Event {
  detail: S3EventBridgeDetail;
}

interface SqsEvent {
  Records: Array<{ body: string }>;
}

export async function handler(sqsEvent: SqsEvent) {
  // Each SQS record's body is the full EventBridge event JSON, passed
  // through unchanged by the SqsQueue event target (batchSize: 1, so
  // there's exactly one record per invocation — this Lambda's reserved
  // concurrency is what does the actual rate limiting, not batch size).
  for (const record of sqsEvent.Records) {
    const event: EventBridgeS3Event = JSON.parse(record.body);
    await processUploadEvent(event);
  }
}

async function processUploadEvent(event: EventBridgeS3Event) {
  const key = event.detail.object.key;
  const bucket = event.detail.bucket.name;

  // Key shape: uploads/{tenantId}/{uuid}-{originalFileName}
  const parts = key.split("/");
  if (parts.length < 3 || parts[0] !== "uploads") {
    console.error(`Unexpected object key shape, skipping: ${key}`);
    return;
  }
  const tenantId = parts[1];

  const document = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string; shipment_id: string | null; status: string }>(
      `SELECT id, shipment_id, status FROM documents WHERE tenant_id = $1 AND s3_key = $2 ORDER BY uploaded_at DESC LIMIT 1`,
      [tenantId, key]
    );
    return rows[0] ?? null;
  });

  if (!document) {
    // With the upload-url race fix (documents row created BEFORE the
    // presigned URL is issued), this should now be structurally
    // impossible rather than just unlikely — kept as a defensive log in
    // case of a bug elsewhere, not an expected path.
    console.error(`No documents row found for key ${key} — this should not happen post-fix, investigate.`);
    return;
  }

  if (document.status === "pending_upload") {
    // S3 ObjectCreated event somehow fired before the confirm-upload
    // PATCH landed (clock skew, client never called confirm). Don't
    // start the pipeline on an unconfirmed upload — bulk upload UI
    // retries confirm-upload on failure, so this will resolve itself
    // shortly; starting extraction on a possibly-still-uploading
    // (multipart) file would be premature anyway.
    console.warn(`Document ${document.id} still pending_upload, skipping pipeline start for now.`);
    return;
  }

  await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: process.env.STATE_MACHINE_ARN!,
      name: `doc-${document.id}-${Date.now()}`,
      input: JSON.stringify({
        tenantId,
        documentId: document.id,
        shipmentId: document.shipment_id,
        s3Bucket: bucket,
        s3Key: key,
      }),
    })
  );
}
