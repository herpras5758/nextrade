// Email Intake — "no human touch" document intake via auto-forwarding.
//
// Setup model (confirmed): tenant configures an AUTO-FORWARDING RULE
// (mail-server level, e.g. Gmail "Forwarding and POP/IMAP" or Outlook
// inbox rule "Forward to") in their real corporate inbox for specific
// supplier/forwarder senders or domains, pointed at a dedicated NexTrade
// intake address (intake-{tenant}@mail.nextrade.id). Auto-forwarding
// rules relay the original message at the transport level, so the
// original "From:" header survives intact — this is NOT the same as a
// user manually clicking "Forward" (which wraps the message and changes
// From to the forwarder). That distinction is why sender validation
// below trusts the From header directly rather than needing to parse a
// quoted/embedded original message.
//
// Every attachment that passes validation lands under the same
// uploads/ S3 prefix the manual upload flow uses, so it flows through
// the existing 9-stage pipeline unchanged. Email is just another door
// into the same building — Document Linking Engine auto-creates a
// shipment if no existing one matches, exactly as it would for a
// manually-uploaded document with no prior shipment.
//
// STOPS at READY_FOR_CEISA (confirmed): this Lambda never submits to
// CEISA itself. Auto-submitting a customs declaration without a human
// decision has real legal/compliance exposure if anything is wrong —
// the unified status becoming READY_FOR_CEISA still requires one
// explicit approve click from an operator (see ceisa-payload endpoint,
// which itself only GENERATES the payload, not submits it).

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { simpleParser } from "mailparser";
import crypto from "crypto";
import { getPool, withTenant } from "../shared/dbPool.js";

const s3 = new S3Client({});
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;
const EMAIL_RAW_BUCKET = process.env.EMAIL_RAW_BUCKET!;

interface SesEvent {
  Records: Array<{
    ses: {
      mail: { messageId: string };
      receipt: { recipients: string[] };
    };
  }>;
}

const ALLOWED_ATTACHMENT_TYPES = [".pdf", ".jpg", ".jpeg", ".png", ".tiff"];

export async function handler(event: SesEvent) {
  for (const record of event.Records) {
    await processEmail(record.ses.mail.messageId, record.ses.receipt.recipients[0]);
  }
}

async function processEmail(messageId: string, recipientAddress: string) {
  const rawObject = await s3.send(new GetObjectCommand({ Bucket: EMAIL_RAW_BUCKET, Key: messageId }));
  const rawBuffer = Buffer.from(await rawObject.Body!.transformToByteArray());
  const parsed = await simpleParser(rawBuffer);

  const senderAddress = (parsed.from?.value[0]?.address ?? "").toLowerCase();
  const subject = parsed.subject ?? "(no subject)";

  const tenantLookup = await lookupTenantByIntakeAddress(recipientAddress.toLowerCase());
  if (!tenantLookup) {
    console.error(`No tenant registered for intake address ${recipientAddress}, dropping email ${messageId}`);
    return;
  }
  const { tenantId, allowedSenders, isActive } = tenantLookup;

  if (!isActive) {
    await logIntake(tenantId, senderAddress, subject, "REJECTED_INACTIVE_INTAKE", 0, []);
    return;
  }

  // Security boundary: this email intake path bypasses normal
  // Cognito-authenticated upload entirely, so this allowlist check IS
  // the security control protecting it. An email from any sender not
  // explicitly registered is logged for audit (could be a probing
  // attempt) and dropped — never processed, regardless of how
  // legitimate-looking the attachment is.
  if (!isSenderAllowed(senderAddress, allowedSenders)) {
    await logIntake(tenantId, senderAddress, subject, "REJECTED_UNAUTHORIZED_SENDER", 0, []);
    console.warn(`Sender ${senderAddress} not in allowlist for tenant ${tenantId}, rejecting email ${messageId}`);
    return;
  }

  const validAttachments = parsed.attachments.filter((att) =>
    ALLOWED_ATTACHMENT_TYPES.some((ext) => (att.filename ?? "").toLowerCase().endsWith(ext))
  );

  if (validAttachments.length === 0) {
    await logIntake(tenantId, senderAddress, subject, "REJECTED_NO_ATTACHMENTS", 0, []);
    return;
  }

  const documentIds: string[] = [];
  for (const attachment of validAttachments) {
    const documentId = await ingestAttachment(
      tenantId,
      attachment.filename ?? "attachment",
      attachment.content,
      { senderAddress, subject, messageId }
    );
    documentIds.push(documentId);
  }

  // Pipeline picks these up exactly like manual uploads (S3 event ->
  // EventBridge -> SQS -> trigger-pipeline -> Step Functions). From here
  // on, Document Linking Engine decides whether this joins an existing
  // shipment (matching reference numbers) or starts a new one
  // automatically — no special-casing for "came from email" anywhere
  // downstream.
  await logIntake(tenantId, senderAddress, subject, "ACCEPTED", validAttachments.length, documentIds);
}

async function lookupTenantByIntakeAddress(
  address: string
): Promise<{ tenantId: string; allowedSenders: string[]; isActive: boolean } | null> {
  // Runs without tenant context — we don't know the tenant until this
  // resolves. In production this should use a dedicated read-only DB
  // role scoped to exactly this one lookup table, not the general pool.
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT tenant_id, allowed_senders, is_active FROM email_intake_config WHERE intake_address = $1`,
    [address]
  );
  if (rows.length === 0) return null;
  return { tenantId: rows[0].tenant_id, allowedSenders: rows[0].allowed_senders, isActive: rows[0].is_active };
}

function isSenderAllowed(sender: string, allowedSenders: string[]): boolean {
  return allowedSenders.some((allowed) => {
    const normalized = allowed.toLowerCase();
    // "@domain.com" registers an entire supplier/forwarder organization
    // at once; an exact address registers just one person there.
    return normalized.startsWith("@") ? sender.endsWith(normalized) : sender === normalized;
  });
}

async function ingestAttachment(
  tenantId: string,
  fileName: string,
  content: Buffer,
  metadata: { senderAddress: string; subject: string; messageId: string }
): Promise<string> {
  const s3Key = `uploads/${tenantId}/${crypto.randomUUID()}-${fileName}`;

  return withTenant(tenantId, async (client) => {
    // Same ordering fix as manual upload (v13): row exists BEFORE the
    // object lands in S3, so trigger-pipeline can never race against it.
    // intake_source/intake_metadata record exactly where this document
    // came from — answerable at any time later via the Evidence
    // Registry or a simple query, not just "uploaded by someone."
    const { rows } = await client.query(
      `INSERT INTO documents (tenant_id, file_name, s3_key, document_type, status, intake_source, intake_metadata)
       VALUES ($1, $2, $3, 'UNCLASSIFIED', 'pending_upload', 'email_intake', $4)
       RETURNING id`,
      [tenantId, fileName, s3Key, JSON.stringify(metadata)]
    );
    const documentId = rows[0].id;

    await s3.send(new PutObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: s3Key, Body: content }));
    await client.query(`UPDATE documents SET status = 'uploaded' WHERE id = $1`, [documentId]);

    return documentId;
  });
}

async function logIntake(
  tenantId: string,
  sender: string,
  subject: string,
  status: string,
  attachmentCount: number,
  documentIds: string[]
) {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO email_intake_log (tenant_id, sender_address, subject, status, attachment_count, document_ids)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, sender, subject, status, attachmentCount, documentIds]
    );
  });
}
