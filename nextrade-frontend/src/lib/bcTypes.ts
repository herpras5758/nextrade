// BC (Bea Cukai / Customs Declaration) Types — Rule B, PROJECT_RULES.md
//
// This is intentionally DATA, not branching logic. Adding a 9th BC type
// later means adding an entry here, not writing new if/else in a
// component or service. Any UI that renders "required documents" or
// "BC-specific fields" reads from this config.

export type BCCategory = "import" | "export" | "transfer";

export interface BCDocumentRequirement {
  document: string;
  fields: string[];
}

export interface BCTypeConfig {
  code: string;
  nameId: string;
  nameEn: string;
  category: BCCategory;
  description: string;
  requiredDocuments: BCDocumentRequirement[];
  hasReconciliationFlow: boolean; // true only for BC 2.6.1 / 2.6.2
}

export const BC_TYPES: BCTypeConfig[] = [
  {
    code: "BC_2.0",
    nameId: "Pemberitahuan Impor Barang (PIB)",
    nameEn: "Import Goods Declaration (PIB)",
    category: "import",
    description: "Self assessment, commercial goods",
    requiredDocuments: [
      { document: "Commercial Invoice", fields: ["invoice_number", "invoice_date", "total_value"] },
      { document: "Bill of Lading / AWB", fields: ["bl_number", "vessel_name", "pol", "pod"] },
      { document: "Packing List", fields: ["gross_weight", "net_weight", "package_count"] },
    ],
    hasReconciliationFlow: false,
  },
  {
    code: "BC_2.3",
    nameId: "Impor Barang untuk TPB",
    nameEn: "Import Goods to Bonded Zone (TPB)",
    category: "import",
    description: "Imported goods entering Bonded Zone — duty & PPN deferred, min. 50% must be exported",
    requiredDocuments: [
      { document: "Commercial Invoice", fields: ["exporter_name", "invoice_number", "invoice_date", "total_value"] },
      { document: "Bill of Lading / AWB", fields: ["bl_number", "vessel_name", "voyage", "pol", "pod"] },
      { document: "Packing List", fields: ["gross_weight", "net_weight", "package_count", "package_type"] },
      { document: "Certificate of Origin", fields: ["country_origin"] },
      { document: "Purchase Order", fields: ["po_number", "hs_code", "item_description", "unit_price"] },
      { document: "Letter of Guarantee", fields: ["guarantee_amount", "guarantee_reference", "issuing_party"] },
      { document: "Inward Manifest BC 1.1", fields: ["manifest_number", "pos_number", "bc11_date", "port_of_entry"] },
    ],
    hasReconciliationFlow: false,
  },
  {
    code: "BC_2.5",
    nameId: "Impor Barang dari TPB",
    nameEn: "Release from Bonded Zone to Domestic",
    category: "import",
    description: "Release from Bonded Zone to domestic market",
    requiredDocuments: [
      { document: "Commercial Invoice", fields: ["invoice_number", "total_value"] },
      { document: "Packing List", fields: ["gross_weight", "net_weight", "package_count"] },
    ],
    hasReconciliationFlow: false,
  },
  {
    code: "BC_2.6.1",
    nameId: "Subkontrak Keluar (Subcontract OUT)",
    nameEn: "Subcontract OUT",
    category: "transfer",
    description: "Goods sent to subcontractor TPB, requires guarantee",
    requiredDocuments: [
      { document: "Subcontract Agreement", fields: ["subcontract_number", "main_tpb", "sub_tpb"] },
      { document: "Commercial Invoice", fields: ["sender_name", "invoice_number", "transfer_value"] },
      { document: "Packing List", fields: ["gross_weight", "net_weight", "package_count"] },
      { document: "Delivery Order / Surat Jalan", fields: ["do_number", "do_date"] },
      { document: "Stock Statement", fields: ["initial_stock", "output_stock", "waste_percentage"] },
    ],
    hasReconciliationFlow: true,
  },
  {
    code: "BC_2.6.2",
    nameId: "Subkontrak Masuk (Subcontract IN)",
    nameEn: "Subcontract IN",
    category: "transfer",
    description: "Goods returned from subcontractor TPB after processing",
    requiredDocuments: [
      { document: "Subcontract Agreement", fields: ["subcontract_number", "main_tpb", "sub_tpb"] },
      { document: "Stock Statement", fields: ["initial_stock", "output_stock", "waste_percentage"] },
    ],
    hasReconciliationFlow: true,
  },
  {
    code: "BC_3.0",
    nameId: "Pemberitahuan Ekspor Barang (PEB)",
    nameEn: "Export Goods Declaration (PEB)",
    category: "export",
    description: "Export from Bonded Zone, no export duty, correctable within 30 days",
    requiredDocuments: [
      { document: "Commercial Invoice", fields: ["exporter_name", "importer_name", "invoice_number", "export_value", "currency", "incoterm"] },
      { document: "Packing List", fields: ["gross_weight", "net_weight", "package_count", "package_type", "marks"] },
      { document: "Bill of Lading / AWB", fields: ["bl_number", "vessel_name", "voyage", "pol", "pod", "eta"] },
      { document: "Certificate of Origin", fields: ["country_origin"] },
    ],
    hasReconciliationFlow: false,
  },
  {
    code: "BC_4.0",
    nameId: "Pemasukan Barang dari TLDDP ke TPB",
    nameEn: "Domestic Goods Entering Bonded Zone",
    category: "transfer",
    description: "Domestic raw materials entering TPB for export-oriented manufacturing",
    requiredDocuments: [
      { document: "Commercial Invoice", fields: ["sender_name", "tpb_operator_name", "invoice_number", "transfer_value"] },
      { document: "Packing List", fields: ["gross_weight", "net_weight", "package_count"] },
      { document: "Delivery Order / Surat Jalan", fields: ["do_number", "do_date"] },
      { document: "Tax Invoice (Faktur Pajak)", fields: ["tax_invoice_number", "tax_invoice_date", "ppn_value"] },
    ],
    hasReconciliationFlow: false,
  },
  {
    code: "BC_4.1",
    nameId: "Pengeluaran Barang dari TPB ke TLDDP",
    nameEn: "Domestic Goods Leaving Bonded Zone",
    category: "transfer",
    description: "Goods leaving Bonded Zone to domestic market (TLDDP)",
    requiredDocuments: [
      { document: "Commercial Invoice", fields: ["invoice_number", "transfer_value"] },
      { document: "Packing List", fields: ["gross_weight", "net_weight", "package_count"] },
    ],
    hasReconciliationFlow: false,
  },
];

export function getBCType(code: string): BCTypeConfig | undefined {
  return BC_TYPES.find((t) => t.code === code);
}
