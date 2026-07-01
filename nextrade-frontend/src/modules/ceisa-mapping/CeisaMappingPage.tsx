import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, AlertTriangle, FileCheck2 } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";

export function CeisaMappingPage() {
  const { t } = useTranslation();
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const { currentTenant } = useTenant();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [blocked, setBlocked] = useState<{ currentStatus: string; openValidationErrors: number; fieldsNeedingReview: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant || !shipmentId) return;
    apiClient
      .get(`/tenants/${currentTenant.id}/shipments/${shipmentId}/ceisa-payload`)
      .then((res) => setPayload(res.data.payload))
      .catch((err) => {
        if (err.response?.status === 409) {
          setBlocked({
            currentStatus: err.response.data.currentStatus,
            openValidationErrors: err.response.data.blockingIssues.openValidationErrors,
            fieldsNeedingReview: err.response.data.blockingIssues.fieldsNeedingReview,
          });
        }
      })
      .finally(() => setIsLoading(false));
  }, [currentTenant, shipmentId]);

  if (isLoading) return <p className="text-sm text-surface-muted">{t("common.loading")}</p>;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/ceisa-mapping" className="mb-4 inline-flex items-center gap-1 text-2xs text-surface-muted hover:text-surface-text">
        <ArrowLeft size={12} /> {t("common.back", "Back")}
      </Link>
      <h1 className="mb-6 text-xl font-semibold text-surface-text">{t("nav.ceisaMapping")}</h1>

      {blocked && (
        <div className="rounded border border-warning-600 bg-warning-100 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={16} className="text-warning-600" />
            <span className="text-sm font-semibold text-warning-600">
              {t("ceisaMapping.blocked", "Not ready for CEISA")}
            </span>
          </div>
          <p className="text-2xs text-surface-text">
            {t("ceisaMapping.status", "Current status")}: <span className="font-mono">{blocked.currentStatus}</span>
          </p>
          <p className="text-2xs text-surface-text">
            {t("ceisaMapping.openMismatches", "Open mismatches")}: {blocked.openValidationErrors} -{" "}
            {t("ceisaMapping.needingReview", "Fields needing review")}: {blocked.fieldsNeedingReview}
          </p>
        </div>
      )}

      {payload && (
        <div className="rounded border border-surface-border bg-surface-card shadow-card">
          <div className="flex items-center gap-2 border-b border-surface-border px-4 py-3">
            <FileCheck2 size={16} className="text-success-600" />
            <p className="text-sm font-semibold text-surface-text">{t("ceisaMapping.payloadReady", "BC 2.3 Payload")}</p>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-xs text-surface-text">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
