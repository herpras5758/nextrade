// CEISA Mapping — IDP Engine module #12. Transforms resolved CTDM
// fields into the BC 2.3 declaration structure, mirroring the numbered
// field layout seen on the actual PIB form (kolom 1-46) from the sample
// shipment. This produces the STRUCTURED payload; the actual submission
// transport (CEISA's real API endpoint, authentication, XML/EDI envelope
// format) is a separate integration not yet built — that requires
// credentials/API docs from Bea Cukai we don't have. What's real here:
// the field-by-field mapping logic itself, which is the substantial,
// reusable part.
//
// Adapter pattern (Rule #10): this module knows the CEISA shape. No
// other code in the system reaches into "BC 2.3 form fields" directly —
// they all go through here.

import pg from "pg";

export interface CeisaBc23Payload {
  kantorPabean: string;
  noPengajuan: string | null;
  namaSaranaPengangkut: string | null;
  noVoyFlight: string | null;
  tanggalTibaBerangkat: string | null;
  shipper: {
    nama: string | null;
    npwp: string | null;
    alamat: string | null;
  };
  consignee: {
    nama: string | null;
    npwp: string | null;
    alamat: string | null;
  };
  posTarif: {
    nomorPo: string | null;
    uraianBarang: string | null;
    hsCode: string | null;
    incoterm: string;
  };
  brutoTotal: number | null;
  volumeTotal: string | null;
  jumlahKemasan: number | null;
  nilaiCif: number | null;
  valuta: string;
  // Cross-document evidence this declaration is built from — required so
  // the declaration is never submitted without its supporting chain
  // (Rule "Evidence First").
  evidenceReferences: {
    poNumber: string | null;
    invoiceNumber: string | null;
    blNumber: string | null;
  };
}

const CTDM_TO_CEISA_FIELD_MAP: Record<string, string> = {
  shipper_name: "shipper.nama",
  consignee_name: "consignee.nama",
  po_number: "posTarif.nomorPo",
  item_description: "posTarif.uraianBarang",
  hs_code: "posTarif.hsCode",
  gross_weight: "brutoTotal",
  total_value: "nilaiCif",
  bl_number: "evidenceReferences.blNumber",
  invoice_number: "evidenceReferences.invoiceNumber",
};

export async function mapToCeisaBc23(client: pg.PoolClient, shipmentId: string, tenantId: string): Promise<CeisaBc23Payload> {
  const { rows: fields } = await client.query<{ field_key: string; resolved_value: string }>(
    `SELECT field_key, resolved_value FROM ctdm_fields WHERE shipment_id = $1 AND tenant_id = $2`,
    [shipmentId, tenantId]
  );
  const fieldMap = new Map(fields.map((f) => [f.field_key, f.resolved_value]));

  const { rows: shipmentRows } = await client.query<{ shipment_number: string }>(
    `SELECT shipment_number FROM shipments WHERE id = $1 AND tenant_id = $2`,
    [shipmentId, tenantId]
  );

  return {
    kantorPabean: "060100", // TODO: config-driven per tenant's registered customs office, hardcoded to the sample's Tanjung Emas code for now
    noPengajuan: null, // assigned by CEISA itself on submission, not us
    namaSaranaPengangkut: fieldMap.get("vessel_name") ?? null,
    noVoyFlight: fieldMap.get("voyage") ?? null,
    tanggalTibaBerangkat: fieldMap.get("eta") ?? null,
    shipper: {
      nama: fieldMap.get("shipper_name") ?? fieldMap.get("exporter_name") ?? null,
      npwp: fieldMap.get("shipper_npwp") ?? null,
      alamat: fieldMap.get("shipper_address") ?? null,
    },
    consignee: {
      nama: fieldMap.get("consignee_name") ?? null,
      npwp: fieldMap.get("consignee_npwp") ?? null,
      alamat: fieldMap.get("consignee_address") ?? null,
    },
    posTarif: {
      nomorPo: fieldMap.get("po_number") ?? shipmentRows[0]?.shipment_number ?? null,
      uraianBarang: fieldMap.get("item_description") ?? null,
      hsCode: fieldMap.get("hs_code") ?? null,
      incoterm: fieldMap.get("incoterm") ?? "FOB",
    },
    brutoTotal: parseNumericField(fieldMap.get("gross_weight")),
    volumeTotal: fieldMap.get("cbm") ?? null,
    jumlahKemasan: parseIntField(fieldMap.get("package_count")),
    nilaiCif: parseNumericField(fieldMap.get("total_value")),
    valuta: fieldMap.get("currency") ?? "USD",
    evidenceReferences: {
      poNumber: fieldMap.get("po_number") ?? null,
      invoiceNumber: fieldMap.get("invoice_number") ?? null,
      blNumber: fieldMap.get("bl_number") ?? null,
    },
  };
}

function parseNumericField(value: string | undefined): number | null {
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseIntField(value: string | undefined): number | null {
  if (!value) return null;
  const num = parseInt(value, 10);
  return Number.isFinite(num) ? num : null;
}
