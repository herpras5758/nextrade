import { Handler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient, AdminCreateUserCommand,
  AdminSetUserPasswordCommand, AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getPool } from '../shared/dbPool.js';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface FieldDef {
  field_key: string;
  display_name: string;
  is_mandatory: boolean;
  is_mandatory_ceisa: boolean;
  ceisa_field_ref?: string;
  confidence_threshold: number;
  is_graph_signal: boolean;
  graph_entity_type?: string;
  sort_order: number;
}

interface DocTypeDef {
  doc_type_code: string;
  display_name: string;
  category: string;
  classification_hints: string[];
  sort_order: number;
  fields: FieldDef[];
}

const DOC_TYPES: DocTypeDef[] = [
  // ── COMMERCIAL INVOICE ──────────────────────────────────────────────────────
  {
    doc_type_code: 'COMMERCIAL_INVOICE',
    display_name: 'Commercial Invoice',
    category: 'COMMERCIAL',
    sort_order: 1,
    classification_hints: ['COMMERCIAL INVOICE','INVOICE NO','INVOICE NUMBER','INVOICE DATE','FAKTUR KOMERSIAL','BILL TO','SOLD TO'],
    fields: [
      { field_key: 'invoice_number',       display_name: 'Invoice Number',            is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_16',     confidence_threshold: 0.85, is_graph_signal: true,  graph_entity_type: 'INVOICE_NUMBER', sort_order: 1 },
      { field_key: 'invoice_date',         display_name: 'Invoice Date',              is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_16_tgl', confidence_threshold: 0.80, is_graph_signal: false, sort_order: 2 },
      { field_key: 'po_number',            display_name: 'PO Number',                 is_mandatory: false, is_mandatory_ceisa: false,                                    confidence_threshold: 0.75, is_graph_signal: true,  graph_entity_type: 'PO_NUMBER',      sort_order: 3 },
      { field_key: 'supplier_name',        display_name: 'Shipper / Supplier Name',   is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_1',      confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'SUPPLIER',       sort_order: 4 },
      { field_key: 'supplier_address',     display_name: 'Shipper Address',           is_mandatory: true,  is_mandatory_ceisa: true,                                     confidence_threshold: 0.70, is_graph_signal: false, sort_order: 5 },
      { field_key: 'supplier_country',     display_name: 'Country of Origin',         is_mandatory: true,  is_mandatory_ceisa: true,                                     confidence_threshold: 0.80, is_graph_signal: false, sort_order: 6 },
      { field_key: 'consignee_name',       display_name: 'Consignee Name',            is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_2',      confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'CONSIGNEE',      sort_order: 7 },
      { field_key: 'consignee_address',    display_name: 'Consignee Address',         is_mandatory: true,  is_mandatory_ceisa: true,                                     confidence_threshold: 0.70, is_graph_signal: false, sort_order: 8 },
      { field_key: 'consignee_npwp',       display_name: 'Consignee NPWP',            is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_2_npwp', confidence_threshold: 0.90, is_graph_signal: false, sort_order: 9 },
      { field_key: 'notify_party_name',    display_name: 'Notify Party',              is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_3',      confidence_threshold: 0.70, is_graph_signal: true,  graph_entity_type: 'NOTIFY_PARTY',   sort_order: 10 },
      { field_key: 'ship_mode',            display_name: 'Ship Mode (Sea/Air)',        is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_11',     confidence_threshold: 0.80, is_graph_signal: false, sort_order: 11 },
      { field_key: 'port_of_loading',      display_name: 'Port of Loading (POL)',      is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_13',     confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'PORT_LOADING',   sort_order: 12 },
      { field_key: 'incoterm',             display_name: 'Incoterm',                  is_mandatory: true,  is_mandatory_ceisa: false,                                    confidence_threshold: 0.80, is_graph_signal: false, sort_order: 13 },
      { field_key: 'currency',             display_name: 'Currency',                  is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_23',     confidence_threshold: 0.85, is_graph_signal: false, sort_order: 14 },
      { field_key: 'total_fob',            display_name: 'Total FOB Amount',           is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_25',     confidence_threshold: 0.85, is_graph_signal: false, sort_order: 15 },
      { field_key: 'freight',              display_name: 'Freight Amount',             is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_26',     confidence_threshold: 0.75, is_graph_signal: false, sort_order: 16 },
      { field_key: 'insurance',            display_name: 'Insurance Amount',           is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_27',     confidence_threshold: 0.75, is_graph_signal: false, sort_order: 17 },
      { field_key: 'total_cif',            display_name: 'Total CIF (USD)',            is_mandatory: false, is_mandatory_ceisa: true,                                     confidence_threshold: 0.85, is_graph_signal: false, sort_order: 18 },
      { field_key: 'payment_terms',        display_name: 'Payment Terms',             is_mandatory: false, is_mandatory_ceisa: false,                                    confidence_threshold: 0.70, is_graph_signal: false, sort_order: 19 },
      { field_key: 'total_packages',       display_name: 'Total Packages',            is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_30',     confidence_threshold: 0.80, is_graph_signal: false, sort_order: 20 },
      { field_key: 'kind_of_package',      display_name: 'Kind of Package',           is_mandatory: true,  is_mandatory_ceisa: true,                                     confidence_threshold: 0.75, is_graph_signal: false, sort_order: 21 },
      { field_key: 'gross_weight_kg',      display_name: 'Gross Weight (KG)',          is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_31',     confidence_threshold: 0.80, is_graph_signal: false, sort_order: 22 },
      { field_key: 'net_weight_kg',        display_name: 'Net Weight (KG)',            is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_32',     confidence_threshold: 0.80, is_graph_signal: false, sort_order: 23 },
      { field_key: 'total_cbm',            display_name: 'Total CBM (Sea)',            is_mandatory: false, is_mandatory_ceisa: false,                                    confidence_threshold: 0.70, is_graph_signal: false, sort_order: 24 },
      { field_key: 'items',                display_name: 'Item List (Description+HS)', is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_33',     confidence_threshold: 0.75, is_graph_signal: false, sort_order: 25 },
    ],
  },

  // ── PACKING LIST ────────────────────────────────────────────────────────────
  {
    doc_type_code: 'PACKING_LIST',
    display_name: 'Packing List',
    category: 'COMMERCIAL',
    sort_order: 2,
    classification_hints: ['PACKING LIST','PACKING','PKG LIST','DAFTAR KEMASAN','MARKS AND NUMBERS','CTN NO'],
    fields: [
      { field_key: 'packing_list_number',   display_name: 'Packing List Number',      is_mandatory: false, is_mandatory_ceisa: false,                                   confidence_threshold: 0.70, is_graph_signal: false, sort_order: 1 },
      { field_key: 'invoice_reference',     display_name: 'Invoice Reference',         is_mandatory: true,  is_mandatory_ceisa: false,                                   confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'INVOICE_NUMBER', sort_order: 2 },
      { field_key: 'total_packages',        display_name: 'Total Packages',            is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_30',     confidence_threshold: 0.80, is_graph_signal: false, sort_order: 3 },
      { field_key: 'kind_of_package',       display_name: 'Kind of Package',           is_mandatory: true,  is_mandatory_ceisa: true,                                    confidence_threshold: 0.75, is_graph_signal: false, sort_order: 4 },
      { field_key: 'total_gross_weight_kg', display_name: 'Total Gross Weight (KG)',   is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_31',     confidence_threshold: 0.85, is_graph_signal: false, sort_order: 5 },
      { field_key: 'total_net_weight_kg',   display_name: 'Total Net Weight (KG)',     is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_32',     confidence_threshold: 0.85, is_graph_signal: false, sort_order: 6 },
      { field_key: 'total_cbm',             display_name: 'Total CBM (Sea)',           is_mandatory: false, is_mandatory_ceisa: false,                                   confidence_threshold: 0.70, is_graph_signal: false, sort_order: 7 },
      { field_key: 'items',                 display_name: 'Item List per Carton',      is_mandatory: true,  is_mandatory_ceisa: false,                                   confidence_threshold: 0.75, is_graph_signal: false, sort_order: 8 },
    ],
  },

  // ── PURCHASE ORDER ──────────────────────────────────────────────────────────
  {
    doc_type_code: 'PURCHASE_ORDER',
    display_name: 'Purchase Order (PO Sheet)',
    category: 'COMMERCIAL',
    sort_order: 3,
    classification_hints: ['PURCHASE ORDER','PO NO','PO NUMBER','PO #','ORDER PEMBELIAN','BUYER','VENDOR','ORDER DATE'],
    fields: [
      { field_key: 'po_number',     display_name: 'PO Number',                         is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_pos',    confidence_threshold: 0.85, is_graph_signal: true,  graph_entity_type: 'PO_NUMBER',   sort_order: 1 },
      { field_key: 'po_date',       display_name: 'PO Date',                           is_mandatory: true,  is_mandatory_ceisa: false,                                    confidence_threshold: 0.80, is_graph_signal: false, sort_order: 2 },
      { field_key: 'sub_po_number', display_name: 'Sub PO Number',                     is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_subpos', confidence_threshold: 0.75, is_graph_signal: false, sort_order: 3 },
      { field_key: 'buyer_name',    display_name: 'Buyer / Brand',                     is_mandatory: true,  is_mandatory_ceisa: false,                                    confidence_threshold: 0.80, is_graph_signal: false, sort_order: 4 },
      { field_key: 'supplier_name', display_name: 'Vendor / Supplier',                 is_mandatory: true,  is_mandatory_ceisa: false,                                    confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'SUPPLIER',    sort_order: 5 },
      { field_key: 'currency',      display_name: 'Currency',                          is_mandatory: true,  is_mandatory_ceisa: false,                                    confidence_threshold: 0.80, is_graph_signal: false, sort_order: 6 },
      { field_key: 'incoterm',      display_name: 'Incoterm',                          is_mandatory: false, is_mandatory_ceisa: false,                                    confidence_threshold: 0.75, is_graph_signal: false, sort_order: 7 },
      { field_key: 'grand_total',   display_name: 'Grand Total (USD)',                 is_mandatory: true,  is_mandatory_ceisa: false,                                    confidence_threshold: 0.80, is_graph_signal: false, sort_order: 8 },
      { field_key: 'items',         display_name: 'Item List (Full Description + HS)', is_mandatory: true,  is_mandatory_ceisa: true,                                     confidence_threshold: 0.75, is_graph_signal: false, sort_order: 9 },
    ],
  },

  // ── BILL OF LADING ──────────────────────────────────────────────────────────
  {
    doc_type_code: 'BILL_OF_LADING',
    display_name: 'Bill of Lading / AWB',
    category: 'TRANSPORT',
    sort_order: 4,
    classification_hints: ['BILL OF LADING','B/L NO','BL NUMBER','COMBINED TRANSPORT','OCEAN BILL','AIR WAYBILL','AWB','PORT OF LOADING','PORT OF DISCHARGE'],
    fields: [
      { field_key: 'bl_number',         display_name: 'B/L or AWB Number',             is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_20',     confidence_threshold: 0.90, is_graph_signal: true,  graph_entity_type: 'BL_NUMBER',      sort_order: 1 },
      { field_key: 'bl_date',           display_name: 'B/L Date',                       is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_20_tgl', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 2 },
      { field_key: 'shipper_name',      display_name: 'Shipper Name',                   is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_1',      confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'SUPPLIER',       sort_order: 3 },
      { field_key: 'shipper_address',   display_name: 'Shipper Address',                is_mandatory: false, is_mandatory_ceisa: false,                                    confidence_threshold: 0.70, is_graph_signal: false, sort_order: 4 },
      { field_key: 'consignee_name',    display_name: 'Consignee Name',                 is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_2',      confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'CONSIGNEE',      sort_order: 5 },
      { field_key: 'consignee_address', display_name: 'Consignee Address',              is_mandatory: false, is_mandatory_ceisa: false,                                    confidence_threshold: 0.70, is_graph_signal: false, sort_order: 6 },
      { field_key: 'notify_party',      display_name: 'Notify Party',                   is_mandatory: false, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_3',      confidence_threshold: 0.70, is_graph_signal: true,  graph_entity_type: 'NOTIFY_PARTY',   sort_order: 7 },
      { field_key: 'ship_mode',         display_name: 'Ship Mode (Sea/Air)',             is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_11',     confidence_threshold: 0.80, is_graph_signal: false, sort_order: 8 },
      { field_key: 'vessel_name',       display_name: 'Vessel / Flight Name',            is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_12',     confidence_threshold: 0.85, is_graph_signal: true,  graph_entity_type: 'VESSEL',         sort_order: 9 },
      { field_key: 'voyage_number',     display_name: 'Voyage / Flight Number',          is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_12v',    confidence_threshold: 0.85, is_graph_signal: false, sort_order: 10 },
      { field_key: 'port_of_loading',   display_name: 'Port of Loading (POL)',           is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_13',     confidence_threshold: 0.85, is_graph_signal: true,  graph_entity_type: 'PORT_LOADING',   sort_order: 11 },
      { field_key: 'port_of_discharge', display_name: 'Port of Discharge (POD)',         is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_15',     confidence_threshold: 0.85, is_graph_signal: true,  graph_entity_type: 'PORT_DISCHARGE', sort_order: 12 },
      { field_key: 'total_packages',    display_name: 'Total Packages',                 is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_30',     confidence_threshold: 0.80, is_graph_signal: false, sort_order: 13 },
      { field_key: 'kind_of_package',   display_name: 'Kind of Package',                is_mandatory: true,  is_mandatory_ceisa: true,                                     confidence_threshold: 0.75, is_graph_signal: false, sort_order: 14 },
      { field_key: 'gross_weight_kg',   display_name: 'Gross Weight (KG)',               is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_31',     confidence_threshold: 0.80, is_graph_signal: false, sort_order: 15 },
      { field_key: 'net_weight_kg',     display_name: 'Net Weight (KG)',                 is_mandatory: false, is_mandatory_ceisa: false,                                    confidence_threshold: 0.75, is_graph_signal: false, sort_order: 16 },
      { field_key: 'container_numbers', display_name: 'Container Numbers',               is_mandatory: false, is_mandatory_ceisa: false,                                    confidence_threshold: 0.85, is_graph_signal: true,  graph_entity_type: 'CONTAINER_NUMBER', sort_order: 17 },
      { field_key: 'total_cbm',         display_name: 'Total CBM',                      is_mandatory: false, is_mandatory_ceisa: false,                                    confidence_threshold: 0.70, is_graph_signal: false, sort_order: 18 },
      { field_key: 'freight_terms',     display_name: 'Freight Terms',                  is_mandatory: false, is_mandatory_ceisa: false,                                    confidence_threshold: 0.70, is_graph_signal: false, sort_order: 19 },
      { field_key: 'description_goods', display_name: 'Description of Goods',           is_mandatory: true,  is_mandatory_ceisa: false,                                    confidence_threshold: 0.75, is_graph_signal: false, sort_order: 20 },
    ],
  },

  // ── BC 1.1 ──────────────────────────────────────────────────────────────────
  {
    doc_type_code: 'BC_1_1',
    display_name: 'BC 1.1 — Final Inward Manifest',
    category: 'CUSTOMS',
    sort_order: 5,
    classification_hints: ['BC 1.1','INWARD MANIFEST','MANIFES KEDATANGAN','FINAL MANIFEST','BC11'],
    fields: [
      { field_key: 'nomor_bc11',       display_name: 'BC 1.1 Number',    is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_21',     confidence_threshold: 0.90, is_graph_signal: true,  graph_entity_type: 'BL_NUMBER',      sort_order: 1 },
      { field_key: 'tanggal_bc11',     display_name: 'BC 1.1 Date',      is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_21_tgl', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 2 },
      { field_key: 'kantor_pabean',    display_name: 'Customs Office',    is_mandatory: true,  is_mandatory_ceisa: true,                                    confidence_threshold: 0.80, is_graph_signal: false, sort_order: 3 },
      { field_key: 'vessel_name',      display_name: 'Vessel Name',       is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_12',     confidence_threshold: 0.85, is_graph_signal: true,  graph_entity_type: 'VESSEL',         sort_order: 4 },
      { field_key: 'voyage_number',    display_name: 'Voyage Number',     is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_12v',    confidence_threshold: 0.85, is_graph_signal: false, sort_order: 5 },
      { field_key: 'port_of_loading',  display_name: 'Port of Loading',   is_mandatory: true,  is_mandatory_ceisa: false,                                   confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'PORT_LOADING',   sort_order: 6 },
      { field_key: 'port_of_discharge',display_name: 'Port of Discharge', is_mandatory: true,  is_mandatory_ceisa: false,                                   confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'PORT_DISCHARGE', sort_order: 7 },
      { field_key: 'bl_number',        display_name: 'B/L Reference',     is_mandatory: true,  is_mandatory_ceisa: false,                                   confidence_threshold: 0.85, is_graph_signal: true,  graph_entity_type: 'BL_NUMBER',      sort_order: 8 },
      { field_key: 'total_packages',   display_name: 'Total Packages',    is_mandatory: true,  is_mandatory_ceisa: false,                                   confidence_threshold: 0.75, is_graph_signal: false, sort_order: 9 },
      { field_key: 'gross_weight_kg',  display_name: 'Gross Weight (KG)', is_mandatory: true,  is_mandatory_ceisa: false,                                   confidence_threshold: 0.75, is_graph_signal: false, sort_order: 10 },
      { field_key: 'consignee_name',   display_name: 'Consignee Name',    is_mandatory: false, is_mandatory_ceisa: false,                                   confidence_threshold: 0.75, is_graph_signal: true,  graph_entity_type: 'CONSIGNEE',      sort_order: 11 },
    ],
  },

  // ── SURAT JALAN ─────────────────────────────────────────────────────────────
  {
    doc_type_code: 'SURAT_JALAN',
    display_name: 'Surat Jalan (Delivery Order)',
    category: 'COMMERCIAL',
    sort_order: 6,
    classification_hints: ['SURAT JALAN','DELIVERY ORDER','DO','NOTA PENGIRIMAN','DELIVERY NOTE','SURAT PENGIRIMAN'],
    fields: [
      { field_key: 'sj_number',      display_name: 'Surat Jalan Number',   is_mandatory: true,  is_mandatory_ceisa: false, confidence_threshold: 0.80, is_graph_signal: false, sort_order: 1 },
      { field_key: 'sj_date',        display_name: 'Surat Jalan Date',     is_mandatory: true,  is_mandatory_ceisa: false, confidence_threshold: 0.80, is_graph_signal: false, sort_order: 2 },
      { field_key: 'invoice_ref',    display_name: 'Invoice Reference',    is_mandatory: true,  is_mandatory_ceisa: false, confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'INVOICE_NUMBER', sort_order: 3 },
      { field_key: 'po_number',      display_name: 'PO Number',            is_mandatory: false, is_mandatory_ceisa: false, confidence_threshold: 0.75, is_graph_signal: true,  graph_entity_type: 'PO_NUMBER',      sort_order: 4 },
      { field_key: 'supplier_name',  display_name: 'Supplier',             is_mandatory: true,  is_mandatory_ceisa: false, confidence_threshold: 0.75, is_graph_signal: true,  graph_entity_type: 'SUPPLIER',       sort_order: 5 },
      { field_key: 'consignee_name', display_name: 'Destination',          is_mandatory: true,  is_mandatory_ceisa: false, confidence_threshold: 0.75, is_graph_signal: true,  graph_entity_type: 'CONSIGNEE',      sort_order: 6 },
      { field_key: 'total_packages', display_name: 'Total Packages',       is_mandatory: true,  is_mandatory_ceisa: false, confidence_threshold: 0.75, is_graph_signal: false, sort_order: 7 },
      { field_key: 'gross_weight_kg',display_name: 'Gross Weight (KG)',    is_mandatory: false, is_mandatory_ceisa: false, confidence_threshold: 0.70, is_graph_signal: false, sort_order: 8 },
      { field_key: 'items',          display_name: 'Item List',            is_mandatory: true,  is_mandatory_ceisa: false, confidence_threshold: 0.70, is_graph_signal: false, sort_order: 9 },
    ],
  },

  // ── BC 2.3 ──────────────────────────────────────────────────────────────────
  {
    doc_type_code: 'BC_2_3',
    display_name: 'BC 2.3 — PIB TPB (CEISA Output)',
    category: 'CUSTOMS',
    sort_order: 7,
    classification_hints: ['BC 2.3','PEMBERITAHUAN IMPOR BARANG','PIB','TEMPAT PENIMBUNAN BERIKAT'],
    fields: [
      { field_key: 'nomor_pengajuan',    display_name: 'Nomor Pengajuan',           is_mandatory: true,  is_mandatory_ceisa: true,  confidence_threshold: 0.90, is_graph_signal: false, sort_order: 1 },
      { field_key: 'npwp_importir',      display_name: 'NPWP Importir',             is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_2',  confidence_threshold: 0.92, is_graph_signal: false, sort_order: 2 },
      { field_key: 'nama_importir',      display_name: 'Nama Importir (CEISA #2)',  is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_3',  confidence_threshold: 0.85, is_graph_signal: false, sort_order: 3 },
      { field_key: 'nama_pemasok',       display_name: 'Nama Pemasok (CEISA #1)',   is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_1',  confidence_threshold: 0.85, is_graph_signal: false, sort_order: 4 },
      { field_key: 'cara_pengangkutan',  display_name: 'Cara Pengangkutan',        is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_11', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 5 },
      { field_key: 'vessel_name',        display_name: 'Vessel/Voyage (CEISA #5)', is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_12', confidence_threshold: 0.85, is_graph_signal: true,  graph_entity_type: 'VESSEL',   sort_order: 6 },
      { field_key: 'port_loading',       display_name: 'Pelabuhan Muat (CEISA #6)',is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_13', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 7 },
      { field_key: 'port_discharge',     display_name: 'Pelabuhan Bongkar (CEISA #7)', is_mandatory: true, is_mandatory_ceisa: true, ceisa_field_ref: 'field_15', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 8 },
      { field_key: 'invoice_number',     display_name: 'Invoice No/Date (CEISA #8)', is_mandatory: true, is_mandatory_ceisa: true,  ceisa_field_ref: 'field_16', confidence_threshold: 0.90, is_graph_signal: true,  graph_entity_type: 'INVOICE_NUMBER', sort_order: 9 },
      { field_key: 'bl_number',          display_name: 'B/L No/Date (CEISA #9)',   is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_20', confidence_threshold: 0.90, is_graph_signal: true,  graph_entity_type: 'BL_NUMBER',      sort_order: 10 },
      { field_key: 'bc11_number',        display_name: 'BC 1.1 No/Date (CEISA #10)',is_mandatory: false, is_mandatory_ceisa: true, ceisa_field_ref: 'field_21', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 11 },
      { field_key: 'total_packages',     display_name: 'Jumlah Kemasan (CEISA #11)',is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_30', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 12 },
      { field_key: 'gross_weight_kg',    display_name: 'Berat Kotor (CEISA #12)', is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_31', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 13 },
      { field_key: 'net_weight_kg',      display_name: 'Berat Bersih (CEISA #13)',is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_32', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 14 },
      { field_key: 'currency',           display_name: 'Currency',                 is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_23', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 15 },
      { field_key: 'kurs',               display_name: 'Kurs NDPBM',              is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_24', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 16 },
      { field_key: 'nilai_fob',          display_name: 'Nilai FOB (USD)',          is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_25', confidence_threshold: 0.85, is_graph_signal: false, sort_order: 17 },
      { field_key: 'nilai_cif_usd',      display_name: 'Total CIF USD (CEISA #17)',is_mandatory: true,  is_mandatory_ceisa: true,                               confidence_threshold: 0.90, is_graph_signal: false, sort_order: 18 },
      { field_key: 'hs_codes',           display_name: 'HS Code (CEISA #14)',      is_mandatory: true,  is_mandatory_ceisa: true,  ceisa_field_ref: 'field_33', confidence_threshold: 0.80, is_graph_signal: true,  graph_entity_type: 'HS_CODE',        sort_order: 19 },
      { field_key: 'item_description',   display_name: 'Item Desc (CEISA #15)',    is_mandatory: true,  is_mandatory_ceisa: true,                               confidence_threshold: 0.80, is_graph_signal: false, sort_order: 20 },
      { field_key: 'total_quantity',     display_name: 'Total Qty (CEISA #16)',    is_mandatory: true,  is_mandatory_ceisa: true,                               confidence_threshold: 0.80, is_graph_signal: false, sort_order: 21 },
    ],
  },
];

// Matching rules (configurable weights per entity type)
const MATCHING_RULES = [
  { entity_type: 'INVOICE_NUMBER',   weight: 1.00, is_required: false, description: 'Invoice number — strongest link between CI, PL, PO' },
  { entity_type: 'BL_NUMBER',        weight: 1.00, is_required: false, description: 'Bill of Lading / AWB number — links transport docs to commercial' },
  { entity_type: 'CONTAINER_NUMBER', weight: 0.95, is_required: false, description: 'Container number — highly unique, strong signal' },
  { entity_type: 'PO_NUMBER',        weight: 0.80, is_required: false, description: 'Purchase order number — links PO to Invoice' },
  { entity_type: 'SUPPLIER',         weight: 0.50, is_required: false, description: 'Supplier name — not unique enough alone' },
  { entity_type: 'CONSIGNEE',        weight: 0.50, is_required: false, description: 'Consignee name — not unique enough alone' },
  { entity_type: 'NOTIFY_PARTY',     weight: 0.40, is_required: false, description: 'Notify party — supporting signal' },
  { entity_type: 'VESSEL',           weight: 0.30, is_required: false, description: 'Vessel name — many shipments per vessel' },
  { entity_type: 'PORT_LOADING',     weight: 0.20, is_required: false, description: 'Port of loading — not unique' },
  { entity_type: 'PORT_DISCHARGE',   weight: 0.20, is_required: false, description: 'Port of discharge — not unique' },
  { entity_type: 'HS_CODE',          weight: 0.40, is_required: false, description: 'HS code — supporting signal for product linking' },
];

export const handler: Handler = async () => {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Tenant
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (code, name) VALUES ('USG','PT Ungaran Sari Garments')
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`
    );
    const tenantId = tenant.id;

    // AI config (empty keys — user sets via Admin Panel)
    await client.query(
      `INSERT INTO tenant_ai_config (tenant_id) VALUES ($1)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId]
    );

    // Doc types + field configs
    for (const dt of DOC_TYPES) {
      await client.query(
        `INSERT INTO tenant_doc_type_config
           (tenant_id, doc_type_code, display_name, category, classification_hints, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, doc_type_code) DO UPDATE SET
           display_name=EXCLUDED.display_name, category=EXCLUDED.category,
           classification_hints=EXCLUDED.classification_hints`,
        [tenantId, dt.doc_type_code, dt.display_name, dt.category, dt.classification_hints, dt.sort_order]
      );

      for (const f of dt.fields) {
        await client.query(
          `INSERT INTO tenant_field_config
             (tenant_id, doc_type_code, field_key, display_name, is_mandatory, is_mandatory_ceisa,
              ceisa_field_ref, confidence_threshold, is_graph_signal, graph_entity_type, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (tenant_id, doc_type_code, field_key) DO UPDATE SET
             display_name=EXCLUDED.display_name, is_graph_signal=EXCLUDED.is_graph_signal,
             graph_entity_type=EXCLUDED.graph_entity_type, confidence_threshold=EXCLUDED.confidence_threshold`,
          [tenantId, dt.doc_type_code, f.field_key, f.display_name,
           f.is_mandatory, f.is_mandatory_ceisa, f.ceisa_field_ref ?? null,
           f.confidence_threshold, f.is_graph_signal, f.graph_entity_type ?? null, f.sort_order]
        );
      }
    }

    // Matching rules
    for (const rule of MATCHING_RULES) {
      await client.query(
        `INSERT INTO tenant_matching_rules (tenant_id, entity_type, weight, is_required, description)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, entity_type) DO UPDATE SET weight=EXCLUDED.weight`,
        [tenantId, rule.entity_type, rule.weight, rule.is_required, rule.description]
      );
    }

    await client.query('COMMIT');
    return { success: true, tenantId, message: 'Ship-X v2 seed complete' };
  } catch (e: any) {
    await client.query('ROLLBACK');
    return { success: false, error: e.message };
  } finally {
    client.release();
  }
};
