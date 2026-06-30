// ERP Mapping — IDP Engine module #13. Adapter pattern (Rule #10):
// every external ERP is accessed through this standard interface, never
// called directly from core CTDM logic. What's real here: the adapter
// contract and the config-driven field mapping engine. What's stubbed:
// actual network calls to SAP/Oracle/Dynamics — those need real
// per-tenant credentials and endpoint URLs we don't have yet, so the
// stub methods throw a clear "not configured" error rather than
// pretending to succeed.

export interface ERPField {
  ctdmFieldKey: string;
  erpFieldName: string;
  direction: "import" | "export" | "bidirectional";
  transform?: "none" | "uppercase" | "date_iso" | "currency_minor_units";
}

export interface ERPAdapterConfig {
  erpSystem: "SAP" | "ORACLE" | "DYNAMICS" | "ODOO" | "CUSTOM";
  tenantId: string;
  connectionEndpoint?: string;
  fieldMappings: ERPField[];
}

export interface ERPAdapter {
  pushShipment(ctdmData: Record<string, string>): Promise<{ success: boolean; erpReference?: string; error?: string }>;
  pullPurchaseOrder(poNumber: string): Promise<Record<string, string> | null>;
}

export const DEFAULT_SAP_FIELD_MAPPING: ERPField[] = [
  { ctdmFieldKey: "po_number", erpFieldName: "EBELN", direction: "bidirectional" },
  { ctdmFieldKey: "hs_code", erpFieldName: "STAWN", direction: "export" },
  { ctdmFieldKey: "total_value", erpFieldName: "NETWR", direction: "export", transform: "currency_minor_units" },
  { ctdmFieldKey: "invoice_date", erpFieldName: "BLDAT", direction: "export", transform: "date_iso" },
  { ctdmFieldKey: "consignee_name", erpFieldName: "NAME1", direction: "import" },
];

export function applyFieldMapping(
  ctdmData: Record<string, string>,
  mapping: ERPField[],
  direction: "import" | "export"
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of mapping) {
    if (field.direction !== "bidirectional" && field.direction !== direction) continue;
    const sourceKey = direction === "export" ? field.ctdmFieldKey : field.erpFieldName;
    const targetKey = direction === "export" ? field.erpFieldName : field.ctdmFieldKey;
    const rawValue = ctdmData[sourceKey];
    if (rawValue === undefined) continue;
    result[targetKey] = applyTransform(rawValue, field.transform);
  }
  return result;
}

function applyTransform(value: string, transform?: ERPField["transform"]): string {
  switch (transform) {
    case "uppercase":
      return value.toUpperCase();
    case "date_iso": {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
    }
    case "currency_minor_units": {
      const num = Number(value.replace(/[^\d.-]/g, ""));
      return Number.isFinite(num) ? String(Math.round(num * 100)) : value;
    }
    default:
      return value;
  }
}

export class UnconfiguredERPAdapter implements ERPAdapter {
  constructor(private config: ERPAdapterConfig) {}

  async pushShipment(): Promise<{ success: boolean; error?: string }> {
    return {
      success: false,
      error: `ERP adapter for ${this.config.erpSystem} has no connectionEndpoint configured for tenant ${this.config.tenantId}. Provide credentials via tenant onboarding before enabling.`,
    };
  }

  async pullPurchaseOrder(): Promise<Record<string, string> | null> {
    return null;
  }
}
