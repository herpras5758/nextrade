import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FileText } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";

interface EvidenceField {
  id: string;
  field_key: string;
  resolved_value: string;
  confidence: number;
  status: string;
  sources: Array<{ raw_value: string; confidence: number; reasoning: string; file_name: string; document_type: string }>;
}

interface AuditEntry {
  action: string;
  entity_type: string;
  changes: Record<string, unknown> | null;
  actor_id: string | null;
  created_at: string;
}

export function EvidenceRegistryPage() {
  const { t } = useTranslation();
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const { currentTenant } = useTenant();
  const [evidenceTrail, setEvidenceTrail] = useState<EvidenceField[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant || !shipmentId) return;
    apiClient
      .get(`/tenants/${currentTenant.id}/shipments/${shipmentId}/evidence-registry`)
      .then((res) => {
        setEvidenceTrail(res.data.evidenceTrail);
        setAuditTrail(res.data.auditTrail);
      })
      .finally(() => setIsLoading(false));
  }, [currentTenant, shipmentId]);

  if (isLoading) return <p className="text-sm text-surface-muted">{t("common.loading")}</p>;

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/evidence-registry" className="mb-4 inline-flex items-center gap-1 text-2xs text-surface-muted hover:text-surface-text">
        <ArrowLeft size={12} /> {t("common.back", "Back")}
      </Link>
      <h1 className="mb-6 text-xl font-semibold text-surface-text">{t("nav.evidenceRegistry")}</h1>

      <div className="mb-6 rounded border border-surface-border bg-surface-card shadow-card">
        <div className="border-b border-surface-border px-4 py-3">
          <p className="text-sm font-semibold text-surface-text">{t("evidence.fields", "Resolved Fields & Sources")}</p>
        </div>
        <div className="divide-y divide-surface-border">
          {evidenceTrail.map((field) => (
            <div key={field.id} className="px-4 py-3">
              <div className="mb-2 flex items-center gap-3">
                <span className="w-40 shrink-0 text-sm font-medium text-surface-text">{field.field_key}</span>
                <span className="data-id text-sm">{field.resolved_value}</span>
                <span className="ml-auto rounded-full bg-surface-page px-2 py-0.5 text-2xs text-surface-muted">
                  {(field.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="space-y-1 pl-2">
                {field.sources.map((source, i) => (
                  <div key={i} className="flex items-center gap-2 text-2xs text-surface-muted">
                    <FileText size={11} />
                    <span>{source.file_name}</span>
                    <span className="data-id">{source.raw_value}</span>
                    <span>({(source.confidence * 100).toFixed(0)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {evidenceTrail.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-surface-muted">{t("common.noData")}</p>
          )}
        </div>
      </div>

      <div className="rounded border border-surface-border bg-surface-card shadow-card">
        <div className="border-b border-surface-border px-4 py-3">
          <p className="text-sm font-semibold text-surface-text">{t("evidence.auditTrail", "Audit Trail")}</p>
        </div>
        <div className="divide-y divide-surface-border">
          {auditTrail.map((entry, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="text-surface-text">{entry.action}</span>
              <span className="text-2xs text-surface-muted">{entry.entity_type}</span>
              <span className="ml-auto text-2xs text-surface-muted">
                {new Date(entry.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {auditTrail.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-surface-muted">{t("common.noData")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
