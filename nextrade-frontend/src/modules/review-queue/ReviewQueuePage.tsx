import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ColumnDef } from "@tanstack/react-table";
import { AlertOctagon, AlertTriangle, Clock } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";
import { EnterpriseDataTable } from "../../components/ui/EnterpriseDataTable";

interface QueueItem {
  queue_item_id: string;
  item_type: "DOCUMENT_MISMATCH" | "FIELD_REVIEW" | "PROCESSING";
  shipment_id: string;
  shipment_number: string | null;
  reference_type: string;
  expected_value?: string;
  actual_value: string;
  created_at: string;
}

const TYPE_CONFIG = {
  DOCUMENT_MISMATCH: { label: "Mismatch", icon: AlertOctagon, className: "text-danger-600" },
  FIELD_REVIEW: { label: "Needs Review", icon: AlertTriangle, className: "text-warning-600" },
  PROCESSING: { label: "Processing", icon: Clock, className: "text-surface-muted" },
};

export function ReviewQueuePage() {
  const { t } = useTranslation();
  const { currentTenant } = useTenant();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant) return;
    apiClient
      .get(`/tenants/${currentTenant.id}/review-queue`)
      .then((res) => setItems(res.data))
      .finally(() => setIsLoading(false));
  }, [currentTenant]);

  const columns = useMemo<ColumnDef<QueueItem, any>[]>(
    () => [
      {
        accessorKey: "item_type",
        header: t("reviewQueue.type", "Type"),
        cell: (info) => {
          const config = TYPE_CONFIG[info.getValue() as keyof typeof TYPE_CONFIG];
          const Icon = config.icon;
          return (
            <span className={`inline-flex items-center gap-1.5 text-sm ${config.className}`}>
              <Icon size={14} />
              {config.label}
            </span>
          );
        },
      },
      {
        accessorKey: "shipment_number",
        header: t("reviewQueue.shipment", "Shipment"),
        cell: (info) => <span className="data-id">{(info.getValue() as string) ?? "-"}</span>,
      },
      { accessorKey: "reference_type", header: t("reviewQueue.field", "Field") },
      {
        accessorKey: "actual_value",
        header: t("reviewQueue.value", "Value"),
        cell: (info) => <span className="data-id">{info.getValue() as string}</span>,
      },
      {
        accessorKey: "created_at",
        header: t("reviewQueue.detected", "Detected"),
        cell: (info) => new Date(info.getValue() as string).toLocaleString(),
      },
    ],
    [t]
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-surface-text">{t("nav.reviewQueue", "Review Queue")}</h1>
        <p className="mt-0.5 text-sm text-surface-muted">
          {t("reviewQueue.subtitle", "Everything across all shipments that needs a human decision, most urgent first.")}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-surface-muted">{t("common.loading")}</p>
      ) : (
        <EnterpriseDataTable
          data={items}
          columns={columns}
          searchPlaceholder={t("common.search")}
          emptyMessage={t("reviewQueue.empty", "Nothing needs review right now.")}
        />
      )}
    </div>
  );
}
