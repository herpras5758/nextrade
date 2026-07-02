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
    console.log('[Seed] Starting...');

    const { rows: [tenant] } = await client.query(
      `SELECT id FROM tenants ORDER BY created_at DESC LIMIT 1`
    );
    if (!tenant) throw new Error('No tenant — run seed-data-v2 first');
    const tenantId = tenant.id;
    const writer = new EvidenceWriter(client);

    // ── Shipment 1: Obor International ────────────────────────────────────
    console.log('[Seed] writeEvent 1');
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
    console.log('[Seed] Inserting docs1...');
    for (const doc of docs1) {
      console.log('[Seed] writeEvent doc1', doc.name);
      const ed = await writer.writeEvent({
        tenantId, eventTime: new Date('2026-06-14'), eventType: 'DOCUMENT_RECEIVED',
        producerType: 'SYSTEM', producerRef: 'seed-test', entityType: 'DOCUMENT',
        payload: { file_name: doc.name, type: doc.type },
      });
      const { rows: [r] } = await client.query(
        `INSERT INTO documents
           (tenant_id, shipment_id, file_name, s3_key, document_type, category,
            status, intake_source, uploaded_by, origin_event_id, last_event_id, last_event_seq)
         VALUES ($1,$2,$3,'',$4,$5,$6,'uploaded','manual_seed',$7,$7,$8)
         RETURNING id`,
        [tenantId, s1.id, doc.name, doc.type, doc.cat, doc.status, ed.id, ed.sequenceNum]
      );
      docIds1.push(r.id);
    }

    // ── Shipment 2: Wilson Garment ─────────────────────────────────────────
    console.log('[Seed] writeEvent 2');
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
    console.log('[Seed] Inserting docs2...');
    for (const doc of docs2) {
      console.log('[Seed] writeEvent doc2', doc.name);
      const ed = await writer.writeEvent({
        tenantId, eventTime: new Date('2026-06-10'), eventType: 'DOCUMENT_RECEIVED',
        producerType: 'SYSTEM', producerRef: 'seed-test', entityType: 'DOCUMENT',
        payload: { file_name: doc.name, type: doc.type },
      });
      const { rows: [r] } = await client.query(
        `INSERT INTO documents
           (tenant_id, shipment_id, file_name, s3_key, document_type, category,
            status, intake_source, uploaded_by, origin_event_id, last_event_id, last_event_seq)
         VALUES ($1,$2,$3,'',$4,$5,$6,'uploaded','manual_seed',$7,$7,$8)
         RETURNING id`,
        [tenantId, s2.id, doc.name, doc.type, doc.cat, 'uploaded', ed.id, ed.sequenceNum]
      );
      docIds2.push(r.id);
    }

    // Seed ctdm_fields for SHP-2026-YW008945 (Wilson Garment)
    const fieldsYW: [number, string, string, number][] = [
      [0,'invoice_number','YW008945',0.98],
      [0,'invoice_date','2026-06-03',0.96],
      [0,'supplier_name','WILSON GARMENT ACCESSORIES (INT\'L) LTD',0.97],
      [0,'supplier_country','HONG KONG',0.98],
      [0,'consignee_name','PT UNGARAN SARI GARMENTS',0.98],
      [0,'consignee_npwp','01.139.605.8-505.000',0.93],
      [0,'currency','USD',0.99],
      [0,'total_fob','5796.81',0.97],
      [0,'incoterm','EX-FACTORY',0.88],
      [1,'total_packages','34',0.99],
      [1,'total_gross_weight_kg','135.70',0.98],
      [1,'total_net_weight_kg','117.80',0.97],
      [1,'total_cbm','0.624',0.93],
      [2,'po_number','5621292',0.98],
      [2,'po_date','2026-05-08',0.97],
      [2,'buyer_name','BAPL - LULULEMON ATHLETICA',0.95],
      [3,'po_number','5621294',0.98],
      [4,'bl_number','HCMJKT26065961',0.99],
      [4,'bl_date','2026-06-09',0.97],
      [4,'vessel_name','KMTC XIAMEN V.2605S',0.97],
      [4,'voyage_number','2605S',0.96],
      [4,'port_of_loading','HO CHI MINH, VIETNAM',0.98],
      [4,'port_of_discharge','JAKARTA, INDONESIA',0.97],
      [4,'gross_weight_kg','135.700',0.97],
      [4,'freight_terms','FREIGHT COLLECT',0.95],
    ];

    const evtFieldsYW = await writer.writeEvent({
      tenantId, eventTime: new Date(), eventType: 'DOCUMENT_EXTRACTED',
      producerType: 'EXTRACTION_ENGINE', producerRef: 'seed-test',
      entityType: 'SHIPMENT', entityId: s2.id, payload: { fields: fieldsYW.length },
    });

    for (const [di, key, value, conf] of fieldsYW) {
      const status = conf >= 0.85 ? 'auto_approved' : conf >= 0.70 ? 'recommended' : 'review_required';
      await client.query(
        `INSERT INTO ctdm_fields
           (tenant_id, shipment_id, document_id, field_key, resolved_value, confidence, status, last_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING`,
        [tenantId, s2.id, docIds2[di], key, value, conf, status, evtFieldsYW.id]
      );
    }

    // Update shipment health YW
    await client.query(
      `UPDATE shipments SET health='NEEDS_ATTENTION', ceisa_readiness_score=68,
         status='UNDER_REVIEW', last_event_id=$1 WHERE id=$2`,
      [evtFieldsYW.id, s2.id]
    );

    // Seed ctdm_fields for SHP-2026-OI126061 (Obor International)
    const fieldsOI: [number, string, string, number][] = [
      [0,'invoice_number','OI126061',0.97],
      [0,'invoice_date','2026-06-11',0.95],
      [0,'supplier_name','OBOR INTERNATIONAL PTE. LTD',0.96],
      [0,'supplier_country','SINGAPORE',0.99],
      [0,'consignee_name','PT. UNGARAN SARI GARMENTS',0.97],
      [0,'currency','USD',0.99],
      [0,'total_fob','162500',0.95],
      [0,'po_number','1409443',0.97],
      [1,'total_packages','146',0.99],
      [1,'total_gross_weight_kg','4415.30',0.97],
      [1,'total_net_weight_kg','4235.68',0.96],
      [1,'total_cbm','13.014',0.93],
      [2,'po_number','5613002',0.98],
      [2,'po_date','2026-03-18',0.95],
      [3,'bl_number','DFS717006813',0.99],
      [3,'bl_date','2026-06-12',0.97],
      [3,'vessel_name','SINAR BAJO',0.96],
      [3,'voyage_number','123S',0.95],
      [3,'port_of_loading','SINGAPORE',0.98],
      [3,'port_of_discharge','SEMARANG INDONESIA',0.97],
      [3,'gross_weight_kg','4415.30',0.97],
      [4,'nomor_bc11','002126',0.99],
      [4,'tanggal_bc11','2026-06-13',0.97],
      [4,'kantor_pabean','060100/KPPBC TMP TANJUNG EMAS',0.95],
      [4,'vessel_name','MV SINAR BAJO',0.97],
      [4,'bl_number','DFS717006813',0.99],
      [5,'bl_reference','DFS717006813',0.98],
      [5,'vessel_name','SINAR BAJO 123S',0.96],
      [5,'lg_date','2025-06-18',0.92],
    ];

    const evtFieldsOI = await writer.writeEvent({
      tenantId, eventTime: new Date(), eventType: 'DOCUMENT_EXTRACTED',
      producerType: 'EXTRACTION_ENGINE', producerRef: 'seed-test',
      entityType: 'SHIPMENT', entityId: s1.id, payload: { fields: fieldsOI.length },
    });

    for (const [di, key, value, conf] of fieldsOI) {
      const status = conf >= 0.85 ? 'auto_approved' : conf >= 0.70 ? 'recommended' : 'review_required';
      await client.query(
        `INSERT INTO ctdm_fields
           (tenant_id, shipment_id, document_id, field_key, resolved_value, confidence, status, last_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING`,
        [tenantId, s1.id, docIds1[di], key, value, conf, status, evtFieldsOI.id]
      );
    }

    // Identity signals
    for (const [type, value] of [
      ['INVOICE_NUMBER','YW008945'],['BL_NUMBER','HCMJKT26065961'],['PO_NUMBER','5621292'],
    ] as const) {
      await client.query(
        `INSERT INTO identity_signals (tenant_id,signal_type,raw_value,producer_type,producer_ref,extraction_confidence,is_active)
         VALUES ($1,$2,$3,'EXTRACTION_ENGINE','seed-test',0.97,true) ON CONFLICT DO NOTHING`,
        [tenantId, type, value]
      );
    }
    for (const [type, value] of [
      ['INVOICE_NUMBER','OI126061'],['BL_NUMBER','DFS717006813'],['PO_NUMBER','1409443'],
    ] as const) {
      await client.query(
        `INSERT INTO identity_signals (tenant_id,signal_type,raw_value,producer_type,producer_ref,extraction_confidence,is_active)
         VALUES ($1,$2,$3,'EXTRACTION_ENGINE','seed-test',0.97,true) ON CONFLICT DO NOTHING`,
        [tenantId, type, value]
      );
    }

    // Update shipment health OI
    await client.query(
      `UPDATE shipments SET health='CRITICAL', ceisa_readiness_score=38,
         status='UNDER_REVIEW', last_event_id=$1 WHERE id=$2`,
      [evtFieldsOI.id, s1.id]
    );

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
