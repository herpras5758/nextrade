import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plug } from "lucide-react";
import { apiClient } from "../../lib/apiClient";

interface ErpField {
  ctdmFieldKey: string;
  erpFieldName: string;
  direction: string;
}

export function ErpMappingPage() {
  const { t } = useTranslation();
  const [mappings, setMappings] = useState<ErpField[]>([]);

  useEffect(() => {
    apiClient.get("/erp-field-mappings").then((res) => setMappings(res.data.sap));
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-surface-text">{t("nav.erp")}</h1>
        <p className="mt-0.5 text-sm text-surface-muted">
          {t("erp.subtitle", "Config-driven field mapping - example shown for SAP. Live connection requires tenant credentials.")}
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded border border-surface-border bg-surface-card px-4 py-3 shadow-card">
        <Plug size={16} className="text-surface-muted" />
        <span className="text-sm text-surface-text">SAP</span>
        <span className="ml-auto rounded-full bg-surface-page px-2 py-0.5 text-2xs text-surface-muted">
          {t("erp.notConnected", "Not connected")}
        </span>
      </div>

      <div className="rounded border border-surface-border bg-surface-card shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-page text-left text-2xs uppercase text-surface-muted">
              <th className="px-4 py-2 font-medium">{t("erp.ctdmField", "CTDM Field")}</th>
              <th className="px-4 py-2 font-medium">{t("erp.erpField", "ERP Field")}</th>
              <th className="px-4 py-2 font-medium">{t("erp.direction", "Direction")}</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.ctdmFieldKey} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-2 text-surface-text">{m.ctdmFieldKey}</td>
                <td className="data-id px-4 py-2">{m.erpFieldName}</td>
                <td className="px-4 py-2 text-2xs text-surface-muted">{m.direction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
