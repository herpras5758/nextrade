import { useTranslation } from "react-i18next";
import { Check, AlertTriangle, XCircle } from "lucide-react";
import { ShipmentReadiness, CheckpointField } from "../../types/review";
import clsx from "clsx";

const STATUS_CONFIG = {
  AUTO_APPROVED: { icon: Check, className: "text-success-600 bg-success-100" },
  RECOMMENDED: { icon: AlertTriangle, className: "text-warning-600 bg-warning-100" },
  REVIEW_REQUIRED: { icon: AlertTriangle, className: "text-warning-600 bg-warning-100" },
  MISSING: { icon: XCircle, className: "text-danger-600 bg-danger-100" },
} as const;

function CheckpointRow({ field, index, onReviewClick }: { field: CheckpointField; index: number; onReviewClick: (field: CheckpointField) => void }) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[field.status];
  const Icon = config.icon;
  const needsReview = field.status !== "AUTO_APPROVED";

  return (
    <div className="flex items-center gap-3 border-b border-surface-border px-4 py-2.5 last:border-0">
      <span className="data-id w-5 text-surface-muted">{index + 1}.</span>
      <span
        className={clsx("flex h-5 w-5 items-center justify-center rounded-full", config.className)}
      >
        <Icon size={12} strokeWidth={2.5} />
      </span>
      <span className="w-44 shrink-0 text-sm font-medium text-surface-text">{field.label}</span>
      <span className="flex-1 text-sm text-surface-text">
        {field.value ?? <span className="text-surface-muted">{t("common.noData")}</span>}
      </span>
      <span className="text-2xs text-surface-muted">
        [{field.sources.map((s) => s.documentName).join(" + ") || "—"}]
      </span>
      {needsReview && (
        <button
          onClick={() => onReviewClick(field)}
          className="rounded border border-warning-600 px-2 py-1 text-2xs font-medium text-warning-600 hover:bg-warning-100"
        >
          {t("common.review")}
        </button>
      )}
    </div>
  );
}

export function CheckpointSummary({
  shipment,
  onReviewField,
}: {
  shipment: ShipmentReadiness;
  onReviewField: (field: CheckpointField) => void;
}) {
  const { t } = useTranslation();
  const total = shipment.checkpoints.length;
  const autoApproved = shipment.checkpoints.filter((c) => c.status === "AUTO_APPROVED").length;
  const reviewNeeded = total - autoApproved;

  return (
    <div className="rounded border border-surface-border bg-surface-card shadow-card">
      <div className="border-b border-surface-border px-4 py-3">
        <p className="text-sm font-semibold text-surface-text">
          {t("ceisa.readinessSummary", "Ringkasan Kesiapan CEISA")}
        </p>
        <p className="data-id text-xs text-surface-muted">
          {shipment.shipmentNumber} — {shipment.partyFrom} → {shipment.partyTo}
        </p>
      </div>

      <div className="flex items-center justify-between bg-navy-900 px-4 py-3 text-white">
        <span className="font-mono text-lg font-semibold">{shipment.readinessScore}%</span>
        <span className="text-2xs text-navy-600">
          {t("common.aiRecommendation")}: {autoApproved}/{total} {t("common.review")} {reviewNeeded > 0 ? reviewNeeded : 0}
        </span>
      </div>

      <div>
        {shipment.checkpoints.map((field, i) => (
          <CheckpointRow key={field.id} field={field} index={i} onReviewClick={onReviewField} />
        ))}
      </div>

      <div className="flex justify-end gap-2 border-t border-surface-border px-4 py-3">
        <button className="rounded border border-surface-border px-3 py-1.5 text-sm font-medium text-surface-text hover:bg-surface-page">
          {t("common.save")}
        </button>
        <button
          disabled={reviewNeeded > 0}
          className="rounded bg-navy-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("common.submit")} CEISA
        </button>
      </div>
    </div>
  );
}
