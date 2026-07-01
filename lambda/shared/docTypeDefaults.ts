// Default doc type + field configurations
// Seeded per tenant on first setup — all configurable via Admin Panel (Rule #4)

export interface FieldDef {
  field_key: string;
  display_name: string;
  is_mandatory: boolean;
  is_mandatory_ceisa: boolean;
  ceisa_field_ref?: string;
  confidence_threshold?: number;
  validation_regex?: string;
  sort_order: number;
}

export interface DocTypeDef {
  doc_type_code: string;
  display_name: string;
  category: string;
  classification_hints: string[];
  fields: FieldDef[];
}

export const DOC_TYPE_DEFAULTS: DocTypeDef[] = [
  {
    doc_type_code: 'COMMERCIAL_INVOICE',
    display_name: 'Commercial Invoice',
    category: 'COMMERCIAL',
    classification_hints: ['COMMERCIAL INVOICE', 'INVOICE NO', 'INVOICE NUMBER', 'FAKTUR KOMERSIAL'],
    fields: [
      { field_key: 'invoice_number',    display_name: 'Nomor Invoice',          is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_16', sort_order: 1 },
      { field_key: 'invoice_date',      display_name: 'Tanggal Invoice',         is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_16_tgl', sort_order: 2 },
      { field_key: 'supplier_name',     display_name: 'Nama Supplier/Pemasok',   is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_1', sort_order: 3 },
      { field_key: 'supplier_address',  display_name: 'Alamat Supplier',         is_mandatory: false, is_mandatory_ceisa: false, sort_order: 4 },
      { field_key: 'supplier_country',  display_name: 'Negara Asal',             is_mandatory: true,  is_mandatory_ceisa: true,  sort_order: 5 },
      { field_key: 'consignee_name',    display_name: 'Nama Importir/Consignee', is_mandatory: true,  is_mandatory_ceisa: true,  sort_order: 6 },
      { field_key: 'consignee_npwp',   display_name: 'NPWP Importir',           is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_2', confidence_threshold: 0.90, sort_order: 7 },
      { field_key: 'po_number',         display_name: 'Nomor PO',                is_mandatory: false, is_mandatory_ceisa: false, sort_order: 8 },
      { field_key: 'incoterm',          display_name: 'Incoterm',                is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 9 },
      { field_key: 'currency',          display_name: 'Valuta',                  is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_23', sort_order: 10 },
      { field_key: 'total_fob',         display_name: 'Total FOB',               is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_25', confidence_threshold: 0.90, sort_order: 11 },
      { field_key: 'payment_terms',     display_name: 'Terms of Payment',        is_mandatory: false, is_mandatory_ceisa: false, sort_order: 12 },
      { field_key: 'items',             display_name: 'Daftar Barang (items)',    is_mandatory: true,  is_mandatory_ceisa: true,  sort_order: 13 },
    ],
  },
  {
    doc_type_code: 'PACKING_LIST',
    display_name: 'Packing List',
    category: 'COMMERCIAL',
    classification_hints: ['PACKING LIST', 'PACKING', 'PKG LIST', 'DAFTAR KEMASAN'],
    fields: [
      { field_key: 'packing_list_number', display_name: 'Nomor Packing List',    is_mandatory: false, is_mandatory_ceisa: false, sort_order: 1 },
      { field_key: 'invoice_reference',   display_name: 'Referensi Invoice',      is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 2 },
      { field_key: 'total_packages',      display_name: 'Jumlah Kemasan',         is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_30', sort_order: 3 },
      { field_key: 'total_gross_weight_kg', display_name: 'Berat Kotor (KG)',     is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_31', confidence_threshold: 0.85, sort_order: 4 },
      { field_key: 'total_net_weight_kg',   display_name: 'Berat Bersih (KG)',    is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_32', confidence_threshold: 0.85, sort_order: 5 },
      { field_key: 'total_cbm',           display_name: 'Total CBM',              is_mandatory: false, is_mandatory_ceisa: false, sort_order: 6 },
      { field_key: 'items',               display_name: 'Daftar Barang',           is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 7 },
    ],
  },
  {
    doc_type_code: 'BILL_OF_LADING',
    display_name: 'Bill of Lading',
    category: 'TRANSPORT',
    classification_hints: ['BILL OF LADING', 'B/L', 'BL NUMBER', 'COMBINED TRANSPORT'],
    fields: [
      { field_key: 'bl_number',          display_name: 'Nomor B/L',              is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_20', sort_order: 1 },
      { field_key: 'bl_date',            display_name: 'Tanggal B/L',            is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_20_tgl', sort_order: 2 },
      { field_key: 'shipper_name',       display_name: 'Nama Shipper',            is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 3 },
      { field_key: 'consignee_name',     display_name: 'Nama Consignee',          is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 4 },
      { field_key: 'vessel_name',        display_name: 'Nama Kapal',              is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_12', sort_order: 5 },
      { field_key: 'voyage_number',      display_name: 'Voyage/Flight',           is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_12v', sort_order: 6 },
      { field_key: 'port_of_loading',    display_name: 'Pelabuhan Muat',          is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_13', sort_order: 7 },
      { field_key: 'port_of_discharge',  display_name: 'Pelabuhan Bongkar',       is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_15', sort_order: 8 },
      { field_key: 'total_packages',     display_name: 'Jumlah Kemasan',          is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 9 },
      { field_key: 'gross_weight_kg',    display_name: 'Berat Kotor (KG)',        is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 10 },
      { field_key: 'container_numbers',  display_name: 'Nomor Kontainer',         is_mandatory: false, is_mandatory_ceisa: false, sort_order: 11 },
      { field_key: 'freight_terms',      display_name: 'Freight Terms',           is_mandatory: false, is_mandatory_ceisa: false, sort_order: 12 },
    ],
  },
  {
    doc_type_code: 'PURCHASE_ORDER',
    display_name: 'Purchase Order',
    category: 'COMMERCIAL',
    classification_hints: ['PURCHASE ORDER', 'PO NO', 'PO NUMBER', 'ORDER PEMBELIAN'],
    fields: [
      { field_key: 'po_number',     display_name: 'Nomor PO',           is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 1 },
      { field_key: 'po_date',       display_name: 'Tanggal PO',         is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 2 },
      { field_key: 'buyer_name',    display_name: 'Nama Buyer',         is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 3 },
      { field_key: 'supplier_name', display_name: 'Nama Supplier',      is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 4 },
      { field_key: 'currency',      display_name: 'Valuta',             is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 5 },
      { field_key: 'incoterm',      display_name: 'Incoterm',           is_mandatory: false, is_mandatory_ceisa: false, sort_order: 6 },
      { field_key: 'grand_total',   display_name: 'Grand Total',        is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 7 },
      { field_key: 'items',         display_name: 'Daftar Barang',      is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 8 },
    ],
  },
  {
    doc_type_code: 'BC_2_3',
    display_name: 'BC 2.3 — PIB TPB',
    category: 'CUSTOMS',
    classification_hints: ['BC 2.3', 'PEMBERITAHUAN IMPOR BARANG', 'PIB', 'TEMPAT PENIMBUNAN BERIKAT'],
    fields: [
      { field_key: 'nomor_pengajuan',   display_name: 'Nomor Pengajuan',       is_mandatory: true,  is_mandatory_ceisa: true,  sort_order: 1 },
      { field_key: 'nomor_pendaftaran', display_name: 'Nomor Pendaftaran',     is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_d', sort_order: 2 },
      { field_key: 'kantor_pabean',     display_name: 'Kantor Pabean',         is_mandatory: true,  is_mandatory_ceisa: true,  sort_order: 3 },
      { field_key: 'kode_kantor_pabean',display_name: 'Kode Kantor Pabean',    is_mandatory: true,  is_mandatory_ceisa: true,  sort_order: 4 },
      { field_key: 'npwp_importir',     display_name: 'NPWP Importir',         is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_2', confidence_threshold: 0.92, sort_order: 5 },
      { field_key: 'nama_importir',     display_name: 'Nama Importir',         is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_3', sort_order: 6 },
      { field_key: 'invoice_number',    display_name: 'Nomor Invoice',         is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_16', sort_order: 7 },
      { field_key: 'bl_number',         display_name: 'Nomor B/L',             is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_20', sort_order: 8 },
      { field_key: 'bc11_number',       display_name: 'Nomor BC 1.1',          is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_21', sort_order: 9 },
      { field_key: 'vessel_name',       display_name: 'Nama Sarana Pengangkut',is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_12', sort_order: 10 },
      { field_key: 'port_loading',      display_name: 'Pelabuhan Muat',        is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_13', sort_order: 11 },
      { field_key: 'port_discharge',    display_name: 'Pelabuhan Bongkar',     is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_15', sort_order: 12 },
      { field_key: 'currency',          display_name: 'Valuta',                is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_23', sort_order: 13 },
      { field_key: 'nilai_fob',         display_name: 'Nilai FOB',             is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_25', sort_order: 14 },
      { field_key: 'freight',           display_name: 'Freight',               is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_26', sort_order: 15 },
      { field_key: 'asuransi',          display_name: 'Asuransi',              is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_27', sort_order: 16 },
      { field_key: 'nilai_cif_usd',     display_name: 'Nilai CIF (USD)',       is_mandatory: true,  is_mandatory_ceisa: true,  confidence_threshold: 0.90, sort_order: 17 },
      { field_key: 'nilai_cif_idr',     display_name: 'Nilai CIF (IDR)',       is_mandatory: true,  is_mandatory_ceisa: true,  confidence_threshold: 0.90, sort_order: 18 },
      { field_key: 'kurs',              display_name: 'Kurs (NDPBM)',          is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_24', sort_order: 19 },
      { field_key: 'total_packages',    display_name: 'Jumlah Kemasan',        is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_30', sort_order: 20 },
      { field_key: 'gross_weight_kg',   display_name: 'Berat Kotor (KG)',      is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_31', sort_order: 21 },
      { field_key: 'net_weight_kg',     display_name: 'Berat Bersih (KG)',     is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_32', sort_order: 22 },
      { field_key: 'hs_codes',          display_name: 'HS Code + Tarif',       is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_33', sort_order: 23 },
      { field_key: 'bm_total',          display_name: 'Total BM',              is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_40', sort_order: 24 },
      { field_key: 'ppn_total',         display_name: 'Total PPN',             is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_43', sort_order: 25 },
    ],
  },
  {
    doc_type_code: 'BC_1_1',
    display_name: 'BC 1.1 — Inward Manifest',
    category: 'CUSTOMS',
    classification_hints: ['BC 1.1', 'INWARD MANIFEST', 'MANIFES KEDATANGAN'],
    fields: [
      { field_key: 'nomor_bc11',     display_name: 'Nomor BC 1.1',    is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_21', sort_order: 1 },
      { field_key: 'tanggal_bc11',   display_name: 'Tanggal BC 1.1',  is_mandatory: true,  is_mandatory_ceisa: true,  sort_order: 2 },
      { field_key: 'kantor_pabean',  display_name: 'Kantor Pabean',   is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 3 },
      { field_key: 'vessel_name',    display_name: 'Nama Kapal',      is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 4 },
      { field_key: 'voyage_number',  display_name: 'Voyage',          is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 5 },
      { field_key: 'bl_number',      display_name: 'Nomor B/L',       is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 6 },
      { field_key: 'total_packages', display_name: 'Jumlah Kemasan',  is_mandatory: false, is_mandatory_ceisa: false, sort_order: 7 },
      { field_key: 'gross_weight_kg',display_name: 'Berat Kotor',     is_mandatory: false, is_mandatory_ceisa: false, sort_order: 8 },
    ],
  },
  {
    doc_type_code: 'INWARD_MANIFEST',
    display_name: 'Inward Manifest',
    category: 'CUSTOMS',
    classification_hints: ['INWARD MANIFEST', 'MANIFES', 'MANIFEST'],
    fields: [
      { field_key: 'nomor_bc11',     display_name: 'Nomor BC 1.1',   is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_21', sort_order: 1 },
      { field_key: 'bl_number',      display_name: 'Nomor B/L',      is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 2 },
      { field_key: 'vessel_name',    display_name: 'Nama Kapal',     is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 3 },
      { field_key: 'gross_weight_kg',display_name: 'Berat Kotor',    is_mandatory: false, is_mandatory_ceisa: false, sort_order: 4 },
    ],
  },
  {
    doc_type_code: 'LETTER_OF_GUARANTEE',
    display_name: 'Letter of Guarantee',
    category: 'SUPPORTING',
    classification_hints: ['LETTER OF GUARANTEE', 'SURAT JAMINAN', 'GUARANTEE'],
    fields: [
      { field_key: 'lg_date',       display_name: 'Tanggal LG',      is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 1 },
      { field_key: 'issuer_name',   display_name: 'Penerbit',        is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 2 },
      { field_key: 'bl_reference',  display_name: 'Referensi B/L',   is_mandatory: true,  is_mandatory_ceisa: false, sort_order: 3 },
      { field_key: 'amount',        display_name: 'Jumlah',          is_mandatory: false, is_mandatory_ceisa: false, sort_order: 4 },
    ],
  },
];
