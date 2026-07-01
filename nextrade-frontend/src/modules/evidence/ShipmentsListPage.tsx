import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";
import { EnterpriseDataTable } from "../../components/ui/EnterpriseDataTable";

interface Shipment {
  id: string;
  shipment_number: string;
  bc_type: string;
  status: string;
  ceisa_readiness_score: number;
  party_from_name: string | null;
  party_to_name: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-surface-page text-surface-muted",
  pending_review: "bg-warning-100 text-warning-600",
  ready: "bg-success-100 text-success-600",
  submitted: "bg-intel-50 text-intel-500",
};

export function ShipmentsListPage({ linkTo }: { linkTo: "evidence-registry" | "ceisa-mapping" }) {
  const { t } = useTranslation();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant) return;
    apiClient
      .get(`/tenants/${currentTenant.id}/shipments`)
      .then((res) => setShipments(res.data))
      .finally(() => setIsLoading(false));
  }, [currentTenant]);

  const columns = useMemo<ColumnDef<Shipment, any>[]>(
    () => [
      { accessorKey: "shipment_number", header: t("shipments.number", "Shipment"), cell: (info) => <span className="data-id">{info.getValue() as string}</span> },
      { accessorKey: "bc_type", header: t("shipments.bcType", "BC Type") },
      { accessorKey: "party_from_name", header: t("shipments.from", "From") },
      { accessorKey: "party_to_name", header: t("shipments.to", "To") },
      {
        accessorKey: "status",
        header: t("table.status", "Status"),
        cell: (info) => (
          <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${STATUS_COLORS[info.getValue() as string] ?? "bg-surface-page text-surface-muted"}`}>
            {info.getValue() as string}
          </span>
        ),
      },
      {
        accessorKey: "ceisa_readiness_score",
        header: t("shipments.readiness", "Readiness"),
        cell: (info) => <span className="font-mono text-sm">{info.getValue() as number}%</span>,
      },
    ],
    [t]
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-surface-text">
          {linkTo === "evidence-registry" ? t("nav.evidenceRegistry") : t("nav.ceisaMapping")}
        </h1>
        <p className="mt-0.5 text-sm text-surface-muted">
          {t("shipments.selectPrompt", "Select a shipment to view detail")}
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-surface-muted">{t("common.loading")}</p>
      ) : (
        <EnterpriseDataTable
          data={shipments}
          columns={columns}
          searchPlaceholder={t("common.search")}
          emptyMessage={t("dashboard.emptyState")}
          onRowClick={(row) => navigate(`/${linkTo}/${row.id}`)}
        />
      )}
    </div>
  );
}
