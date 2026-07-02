import { FastifyInstance } from 'fastify';
import { withTenant } from '../lib/db.js';
import { assertTenantAccess } from '../middleware/auth.js';

export async function shipmentRoutes(app: FastifyInstance) {

  // GET /tenants/:tenantId/shipments
  app.get('/tenants/:tenantId/shipments', async (req, reply) => {
    const { tenantId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    const { status, limit = '20', offset = '0' } = req.query as any;

    return withTenant(tenantId, async (client) => {
      let where = 'WHERE s.tenant_id=$1';
      const params: any[] = [tenantId];
      if (status) where += ` AND s.status=$${params.push(status)}`;

      const { rows } = await client.query(
        `SELECT s.*,
                r.confidence_score, r.found_doc_types, r.missing_doc_types,
                r.invoice_numbers, r.bl_numbers, r.vessel_names,
                COUNT(rd.id) as document_count
         FROM shipments s
         JOIN resolutions r ON r.id=s.resolution_id
         LEFT JOIN resolution_documents rd ON rd.resolution_id=r.id
         ${where}
         GROUP BY s.id, r.id
         ORDER BY s.created_at DESC
         LIMIT $${params.push(parseInt(limit))} OFFSET $${params.push(parseInt(offset))}`,
        params
      );
      return { shipments: rows, total: rows.length };
    });
  });

  // GET /tenants/:tenantId/shipments/:shipId
  app.get('/tenants/:tenantId/shipments/:shipId', async (req, reply) => {
    const { tenantId, shipId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows: [shipment] } = await client.query(
        `SELECT s.*, r.confidence_score, r.confidence_breakdown,
                r.found_doc_types, r.missing_doc_types, r.expected_doc_types,
                r.invoice_numbers, r.bl_numbers, r.po_numbers, r.vessel_names,
                r.container_numbers, r.human_approved_by, r.human_approved_at
         FROM shipments s
         JOIN resolutions r ON r.id=s.resolution_id
         WHERE s.id=$1 AND s.tenant_id=$2`,
        [shipId, tenantId]
      );
      if (!shipment) return reply.code(404).send({ error: 'Shipment not found' });

      // Documents
      const { rows: documents } = await client.query(
        `SELECT d.id, d.file_name, d.doc_type, d.status, d.uploaded_at,
                d.is_split_child, d.page_range_start, d.page_range_end,
                rd.doc_role
         FROM resolution_documents rd
         JOIN documents d ON d.id=rd.document_id
         WHERE rd.resolution_id=$1
         ORDER BY d.doc_type, d.uploaded_at`,
        [shipment.resolution_id]
      );

      // Merged fields (best value per field_key across all docs)
      const docIds = documents.map(d => d.id);
      const { rows: fields } = await client.query(
        `SELECT DISTINCT ON (fe.field_key)
                fe.field_key, fe.raw_value, fe.normalized_value, fe.confidence,
                fe.status, fe.corrected_value,
                COALESCE(fe.corrected_value, fe.raw_value) as effective_value,
                d.doc_type, d.file_name,
                tfc.display_name, tfc.is_mandatory_ceisa, tfc.ceisa_field_ref, tfc.sort_order
         FROM field_extractions fe
         JOIN documents d ON d.id=fe.document_id
         LEFT JOIN tenant_field_config tfc
           ON tfc.tenant_id=fe.tenant_id AND tfc.doc_type_code=d.doc_type AND tfc.field_key=fe.field_key
         WHERE fe.document_id=ANY($1::uuid[]) AND fe.tenant_id=$2
           AND fe.raw_value IS NOT NULL AND fe.raw_value!=''
         ORDER BY fe.field_key, fe.confidence DESC`,
        [docIds, tenantId]
      );

      // Snapshots
      const { rows: snapshots } = await client.query(
        `SELECT id, trigger_event, created_at FROM shipment_snapshots
         WHERE shipment_id=$1 ORDER BY created_at DESC LIMIT 5`,
        [shipId]
      );

      return { shipment, documents, fields, snapshots };
    });
  });

  // GET /tenants/:tenantId/shipments/:shipId/ceisa-readiness
  app.get('/tenants/:tenantId/shipments/:shipId/ceisa-readiness', async (req, reply) => {
    const { tenantId, shipId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows: [shipment] } = await client.query(
        `SELECT s.*, r.id as resolution_id FROM shipments s
         JOIN resolutions r ON r.id=s.resolution_id
         WHERE s.id=$1 AND s.tenant_id=$2`,
        [shipId, tenantId]
      );
      if (!shipment) return reply.code(404).send({ error: 'Shipment not found' });

      // Get all docs in resolution
      const { rows: docs } = await client.query(
        `SELECT d.id, d.doc_type, d.status FROM resolution_documents rd
         JOIN documents d ON d.id=rd.document_id
         WHERE rd.resolution_id=$1`, [shipment.resolution_id]
      );

      // Get all fields
      const docIds = docs.map((d: any) => d.id);
      const { rows: fields } = await client.query(
        `SELECT fe.field_key, fe.confidence, fe.status,
                COALESCE(fe.corrected_value, fe.raw_value) as value
         FROM field_extractions fe
         WHERE fe.document_id=ANY($1::uuid[]) AND fe.tenant_id=$2
           AND fe.raw_value IS NOT NULL AND fe.raw_value!=''`,
        [docIds, tenantId]
      );

      const fieldMap: Record<string, { value: string; confidence: number }> = {};
      for (const f of fields) {
        if (!fieldMap[f.field_key] || f.confidence > fieldMap[f.field_key].confidence) {
          fieldMap[f.field_key] = { value: f.value, confidence: parseFloat(f.confidence) };
        }
      }

      const has = (key: string, minConf = 0.70) =>
        !!fieldMap[key]?.value && fieldMap[key].confidence >= minConf;

      const docTypes = new Set(docs.map((d: any) => d.doc_type));

      const checkpoints = [
        {
          id: 1, name: 'Commercial Invoice',
          status: docTypes.has('COMMERCIAL_INVOICE') && has('invoice_number') ? 'PASS' : docTypes.has('COMMERCIAL_INVOICE') ? 'WARN' : 'FAIL',
          detail: has('invoice_number') ? `Invoice: ${fieldMap.invoice_number.value}` : 'Invoice not found or number not extracted',
          ceisa_fields: ['invoice_number', 'invoice_date', 'total_fob', 'supplier_name', 'consignee_name'],
        },
        {
          id: 2, name: 'Packing List',
          status: docTypes.has('PACKING_LIST') && has('total_gross_weight_kg') ? 'PASS' : docTypes.has('PACKING_LIST') ? 'WARN' : 'FAIL',
          detail: has('total_gross_weight_kg') ? `Gross: ${fieldMap.total_gross_weight_kg?.value} KG | Net: ${fieldMap.total_net_weight_kg?.value ?? '-'} KG` : 'Packing List not found or weight missing',
          ceisa_fields: ['total_packages', 'total_gross_weight_kg', 'total_net_weight_kg'],
        },
        {
          id: 3, name: 'Bill of Lading',
          status: docTypes.has('BILL_OF_LADING') && has('bl_number') ? 'PASS' : docTypes.has('BILL_OF_LADING') ? 'WARN' : 'FAIL',
          detail: has('bl_number') ? `B/L: ${fieldMap.bl_number.value} | Vessel: ${fieldMap.vessel_name?.value ?? '-'}` : 'B/L not found or B/L number missing',
          ceisa_fields: ['bl_number', 'bl_date', 'vessel_name', 'voyage_number', 'port_of_loading', 'port_of_discharge'],
        },
        {
          id: 4, name: 'BC 1.1 Inward Manifest',
          status: docTypes.has('BC_1_1') && has('nomor_bc11') ? 'PASS' : 'WARN',
          detail: has('nomor_bc11') ? `BC1.1: ${fieldMap.nomor_bc11.value}` : 'BC 1.1 not yet received from forwarder',
          ceisa_fields: ['nomor_bc11', 'tanggal_bc11'],
        },
        {
          id: 5, name: 'HS Code',
          status: has('hs_codes', 0.60) || has('items', 0.60) ? 'PASS' : 'FAIL',
          detail: has('hs_codes') ? 'HS Codes extracted' : 'HS Code not found — required for tariff classification',
          ceisa_fields: ['hs_codes'],
        },
        {
          id: 6, name: 'CIF Value',
          status: has('total_cif') || (has('total_fob') && has('freight')) ? 'PASS' : has('total_fob') ? 'WARN' : 'FAIL',
          detail: has('total_cif') ? `CIF: ${fieldMap.total_cif?.value}` : has('total_fob') ? `FOB: ${fieldMap.total_fob?.value} — freight/insurance missing` : 'CIF not available',
          ceisa_fields: ['total_cif', 'nilai_fob', 'freight', 'insurance'],
        },
        {
          id: 7, name: 'Shipper & Consignee',
          status: (has('supplier_name') || has('shipper_name')) && has('consignee_name') ? 'PASS' : 'WARN',
          detail: has('supplier_name') ? `Shipper: ${fieldMap.supplier_name.value?.slice(0, 40)}` : 'Shipper or consignee missing',
          ceisa_fields: ['supplier_name', 'consignee_name', 'notify_party_name'],
        },
        {
          id: 8, name: 'Port & Transport',
          status: has('port_of_loading') && has('port_of_discharge') && has('vessel_name') ? 'PASS' : 'WARN',
          detail: has('vessel_name') ? `${fieldMap.vessel_name.value} | ${fieldMap.port_of_loading?.value ?? '-'} → ${fieldMap.port_of_discharge?.value ?? '-'}` : 'Transport details incomplete',
          ceisa_fields: ['ship_mode', 'vessel_name', 'voyage_number', 'port_of_loading', 'port_of_discharge'],
        },
      ];

      const passed = checkpoints.filter(c => c.status === 'PASS').length;
      const warned = checkpoints.filter(c => c.status === 'WARN').length;
      const failed = checkpoints.filter(c => c.status === 'FAIL').length;
      const score = Math.round((passed / checkpoints.length) * 100);
      const overall = failed === 0 && warned === 0 ? 'READY'
        : failed === 0 ? 'NEARLY_READY'
        : failed <= 2 ? 'NEEDS_ATTENTION' : 'NOT_READY';

      // Update score
      await client.query(
        `UPDATE shipments SET ceisa_readiness_score=$1 WHERE id=$2`, [score, shipId]
      );

      return { shipId, score, overall, checkpoints, summary: { passed, warned, failed } };
    });
  });

  // GET /tenants/:tenantId/shipments/:shipId/ceisa-draft
  app.get('/tenants/:tenantId/shipments/:shipId/ceisa-draft', async (req, reply) => {
    const { tenantId, shipId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);

    return withTenant(tenantId, async (client) => {
      const { rows: [shipment] } = await client.query(
        `SELECT s.*, r.id as resolution_id FROM shipments s
         JOIN resolutions r ON r.id=s.resolution_id WHERE s.id=$1 AND s.tenant_id=$2`,
        [shipId, tenantId]
      );
      if (!shipment) return reply.code(404).send({ error: 'Shipment not found' });

      const { rows: docs } = await client.query(
        `SELECT d.id, d.doc_type FROM resolution_documents rd
         JOIN documents d ON d.id=rd.document_id WHERE rd.resolution_id=$1`,
        [shipment.resolution_id]
      );
      const docIds = docs.map((d: any) => d.id);

      const { rows: fields } = await client.query(
        `SELECT DISTINCT ON (fe.field_key)
                fe.field_key, COALESCE(fe.corrected_value, fe.raw_value) as value,
                fe.confidence, d.doc_type
         FROM field_extractions fe
         JOIN documents d ON d.id=fe.document_id
         WHERE fe.document_id=ANY($1::uuid[]) AND fe.tenant_id=$2
           AND fe.raw_value IS NOT NULL
         ORDER BY fe.field_key, fe.confidence DESC`,
        [docIds, tenantId]
      );

      const f: Record<string, string> = {};
      for (const row of fields) f[row.field_key] = row.value ?? '';

      // Map to BC 2.3 CEISA format (18 mandatory fields per workflow)
      const bc23: Record<string, any> = {
        // Header
        jenis_dokumen: 'BC 2.3',
        // 1. Shipper/Pemasok
        nama_pemasok: f.supplier_name ?? f.shipper_name ?? '',
        alamat_pemasok: f.supplier_address ?? f.shipper_address ?? '',
        negara_asal: f.supplier_country ?? '',
        // 2. Consignee/Importir
        nama_importir: f.consignee_name ?? '',
        alamat_importir: f.consignee_address ?? '',
        npwp_importir: f.consignee_npwp ?? f.npwp_importir ?? '',
        // 3. Notify Party
        pemilik_barang: f.notify_party_name ?? f.notify_party ?? '',
        // 4. Ship Mode
        cara_pengangkutan: f.ship_mode ?? 'Laut',
        // 5. Vessel/Voyage
        nama_sarana_pengangkut: f.vessel_name ?? '',
        nomor_voyage: f.voyage_number ?? '',
        // 6. POL
        pelabuhan_muat: f.port_of_loading ?? '',
        // 7. POD
        pelabuhan_tujuan: f.port_of_discharge ?? '',
        // 8. Invoice No/Date
        nomor_invoice: f.invoice_number ?? '',
        tanggal_invoice: f.invoice_date ?? '',
        // 9. BL/AWB No/Date
        nomor_bl_awb: f.bl_number ?? '',
        tanggal_bl_awb: f.bl_date ?? '',
        // 10. BC 1.1
        nomor_bc11: f.nomor_bc11 ?? '',
        tanggal_bc11: f.tanggal_bc11 ?? '',
        // 10b. POS/Sub POS
        pos_number: f.po_number ?? '',
        sub_pos_number: f.sub_po_number ?? '',
        // 11. Packages
        jumlah_kemasan: f.total_packages ?? f.total_packages ?? '',
        jenis_kemasan: f.kind_of_package ?? '',
        // 12. Gross Weight
        berat_kotor: f.gross_weight_kg ?? f.total_gross_weight_kg ?? '',
        // 13. Net Weight
        berat_bersih: f.net_weight_kg ?? f.total_net_weight_kg ?? '',
        // 14. HS Code
        pos_tarif: f.hs_codes ?? '',
        // 15. Item Description
        uraian_barang: f.items ?? f.description_goods ?? '',
        // 16. Total Quantity
        jumlah_satuan: f.total_quantity ?? '',
        // 17. CIF (= FOB + Freight + Insurance)
        nilai_fob: f.total_fob ?? f.nilai_fob ?? '',
        freight: f.freight ?? '',
        asuransi: f.insurance ?? f.asuransi ?? '',
        nilai_cif_usd: f.total_cif ?? f.nilai_cif_usd ?? '',
        // Currency
        valuta: f.currency ?? 'USD',
        kurs_ndpbm: f.kurs ?? '',
        // Completeness flags
        _missing_fields: Object.entries(bc23)
          .filter(([k, v]) => !k.startsWith('_') && !v)
          .map(([k]) => k),
      };

      // Save draft
      await client.query(
        `INSERT INTO customs_declarations (tenant_id, shipment_id, bc_type, payload, status)
         VALUES ($1,$2,'BC_2_3',$3,'draft')
         ON CONFLICT (shipment_id, bc_type) DO UPDATE SET payload=EXCLUDED.payload, status='draft'
         RETURNING id`,
        [tenantId, shipId, JSON.stringify(bc23)]
      ).catch(() => {/* ignore conflict */});

      return { shipId, bc23, missingFields: bc23._missing_fields };
    });
  });

  // PATCH /tenants/:tenantId/shipments/:shipId/status
  app.patch('/tenants/:tenantId/shipments/:shipId/status', async (req, reply) => {
    const { tenantId, shipId } = req.params as any;
    assertTenantAccess(req.auth!, tenantId);
    const { status } = req.body as { status: string };

    const validTransitions: Record<string, string[]> = {
      verified: ['ready_ceisa'],
      ready_ceisa: ['submitted'],
      submitted: ['sppb', 'verified'],
      sppb: ['closed'],
    };

    return withTenant(tenantId, async (client) => {
      const { rows: [s] } = await client.query(
        `SELECT status FROM shipments WHERE id=$1 AND tenant_id=$2`, [shipId, tenantId]
      );
      if (!s) return reply.code(404).send({ error: 'Shipment not found' });
      if (!validTransitions[s.status]?.includes(status)) {
        return reply.code(400).send({ error: `Cannot transition from ${s.status} to ${status}` });
      }

      await client.query(
        `UPDATE shipments SET status=$1, updated_at=NOW() WHERE id=$2`, [status, shipId]
      );
      return { success: true, status };
    });
  });
}
