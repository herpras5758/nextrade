import { Handler } from 'aws-lambda';
import { getPool } from '../shared/dbPool.js';
import { EvidenceWriter } from '../shared/evidence/index.js';

// Seed hanya struktur shipment + dokumen metadata
// TANPA ctdm_fields — user akan upload dokumen sendiri, pipeline yang ekstrak

export const handler: Handler = async () => {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: [tenant] } = await client.query(
      `SELECT id FROM tenants ORDER BY created_at DESC LIMIT 1`
    );
    if (!tenant) throw new Error('No tenant — run seed-data-v2 first');
    const tenantId = tenant.id;
    const writer = new EvidenceWriter(client);

    // ── Shipment 1: Obor International ────────────────────────────────────
    const e1 = await writer.writeEvent({
      tenantId, eventTime: new Date('2026-06-11'), eventType: 'SHIPMENT_CREATED',
      producerType: 'SYSTEM', producerRef: 'seed-test',
      entityType: 'SHIPMENT',
      payload: { invoice: 'OI126061', supplier: 'Obor International PTE LTD' },
    });
    const { rows: [s1] } = await client.query(
      `INSERT INTO shipments
         (tenant_id, shipment_number, status, health, ceisa_readiness_score, last_event_id)
       VALUES ($1,'SHP-2026-OI126061','DRAFT','NEEDS_ATTENTION',0,$2)
       RETURNING id`,
      [tenantId, e1.id]
    );

    // Dokumen Shipment 1 — metadata saja, s3_key kosong, status 'uploaded'
    // User akan upload file aktual melalui UI
    const docs1 = [
      { name: 'Invoice OI126061 - Obor International.pdf', type: 'COMMERCIAL_INVOICE', cat: 'COMMERCIAL' },
      { name: 'Packing List OI126061.pdf',                 type: 'PACKING_LIST',       cat: 'COMMERCIAL' },
      { name: 'PO 5613002 - PT USG ke Obor.pdf',           type: 'PURCHASE_ORDER',     cat: 'COMMERCIAL' },
      { name: 'BL DFS717006813 - Sinar Bajo.pdf',          type: 'BILL_OF_LADING',     cat: 'TRANSPORT'  },
      { name: 'Letter of Guarantee DFS717006813.pdf',      type: 'LETTER_OF_GUARANTEE',cat: 'SUPPORTING' },
      { name: 'Inward Manifest BC 1.1 002126.pdf',         type: 'BC_1_1',             cat: 'CUSTOMS'    },
    ];

    const docIds1: string[] = [];
    for (const doc of docs1) {
      const ed = await writer.writeEvent({
        tenantId, eventTime: new Date('2026-06-14'), eventType: 'DOCUMENT_RECEIVED',
        producerType: 'SYSTEM', producerRef: 'seed-test', entityType: 'DOCUMENT',
        payload: { file_name: doc.name, type: doc.type },
      });
      const { rows: [r] } = await client.query(
        `INSERT INTO documents
           (tenant_id, shipment_id, file_name, s3_key, document_type, category,
            status, intake_source, uploaded_by, origin_event_id, last_event_id, last_event_seq)
         VALUES ($1,$2,$3,'','$4',$5,$6,'uploaded','manual_seed','system',$7,$7,$8)
         RETURNING id`,
        [tenantId, s1.id, doc.name, doc.type, doc.cat, 'uploaded', ed.id, ed.sequenceNum]
      );
      docIds1.push(r.id);
    }

    // ── Shipment 2: Wilson Garment ─────────────────────────────────────────
    const e2 = await writer.writeEvent({
      tenantId, eventTime: new Date('2026-06-03'), eventType: 'SHIPMENT_CREATED',
      producerType: 'SYSTEM', producerRef: 'seed-test',
      entityType: 'SHIPMENT',
      payload: { invoice: 'YW008945', supplier: 'Wilson Garment Accessories (Int\'l) Ltd' },
    });
    const { rows: [s2] } = await client.query(
      `INSERT INTO shipments
         (tenant_id, shipment_number, status, health, ceisa_readiness_score, last_event_id)
       VALUES ($1,'SHP-2026-YW008945','DRAFT','NEEDS_ATTENTION',0,$2)
       RETURNING id`,
      [tenantId, e2.id]
    );

    const docs2 = [
      { name: 'Invoice YW008945 - Wilson Garment.pdf', type: 'COMMERCIAL_INVOICE', cat: 'COMMERCIAL' },
      { name: 'Packing List YW008945.pdf',             type: 'PACKING_LIST',       cat: 'COMMERCIAL' },
      { name: 'PO 5621292 - PT USG ke Wilson.pdf',     type: 'PURCHASE_ORDER',     cat: 'COMMERCIAL' },
      { name: 'PO 5621294 - PT USG ke Wilson.pdf',     type: 'PURCHASE_ORDER',     cat: 'COMMERCIAL' },
      { name: 'BL HCMJKT26065961 - KMTC Xiamen.pdf',  type: 'BILL_OF_LADING',     cat: 'TRANSPORT'  },
    ];

    const docIds2: string[] = [];
    for (const doc of docs2) {
      const ed = await writer.writeEvent({
        tenantId, eventTime: new Date('2026-06-10'), eventType: 'DOCUMENT_RECEIVED',
        producerType: 'SYSTEM', producerRef: 'seed-test', entityType: 'DOCUMENT',
        payload: { file_name: doc.name, type: doc.type },
      });
      const { rows: [r] } = await client.query(
        `INSERT INTO documents
           (tenant_id, shipment_id, file_name, s3_key, document_type, category,
            status, intake_source, uploaded_by, origin_event_id, last_event_id, last_event_seq)
         VALUES ($1,$2,$3,'','$4',$5,$6,'uploaded','manual_seed','system',$7,$7,$8)
         RETURNING id`,
        [tenantId, s2.id, doc.name, doc.type, doc.cat, 'uploaded', ed.id, ed.sequenceNum]
      );
      docIds2.push(r.id);
    }

    await client.query('COMMIT');

    return {
      success: true,
      shipments: [
        {
          number: 'SHP-2026-OI126061',
          id: s1.id,
          supplier: 'Obor International PTE LTD',
          docs: docs1.length,
          status: 'DRAFT — siap upload dokumen aktual',
        },
        {
          number: 'SHP-2026-YW008945',
          id: s2.id,
          supplier: 'Wilson Garment Accessories',
          docs: docs2.length,
          status: 'DRAFT — siap upload dokumen aktual',
        },
      ],
      message: 'Struktur shipment + dokumen seeded. Upload file aktual via UI untuk trigger pipeline ekstraksi.',
    };

  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[SeedTestData]', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
};
