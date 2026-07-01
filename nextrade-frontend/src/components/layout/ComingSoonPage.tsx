import { useTranslation } from "react-i18next";
import { Construction } from "lucide-react";

const MODULE_NOTES: Record<string, string> = {
  tradeIntelligence: "Membutuhkan query layer OpenSearch yang sedang dalam pengembangan.",
  itInventory: "Modul BC 2.6.1 Subcontracting — fase lanjutan sesuai vision document.",
  analytics: "Dashboard analitik mendalam — menunggu data historis dari pipeline.",
  settings: "Konfigurasi AI engine, tenant, dan preferensi — backlog Addendum F.",
};

export function ComingSoonPage({ moduleKey }: { moduleKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="page-container">
      <div className="card">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning-100">
            <Construction size={24} className="text-warning-600" />
          </div>
          <h2 className="section-title mb-1 text-base">{t(`nav.${moduleKey}`)}</h2>
          <p className="text-sm text-surface-muted max-w-sm">
            Modul ini sedang dalam pengembangan.
            {MODULE_NOTES[moduleKey] ? ` ${MODULE_NOTES[moduleKey]}` : ""}
          </p>
          <div className="mt-4 rounded border border-surface-border bg-surface-page px-4 py-2 text-2xs text-surface-muted font-mono">
            Tercatat di PROJECT_RULES.md backlog
          </div>
        </div>
      </div>
    </div>
  );
}
