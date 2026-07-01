import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ColumnDef } from "@tanstack/react-table";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";
import { EnterpriseDataTable } from "../../components/ui/EnterpriseDataTable";

interface ComplianceIssue {
  id: string;
  shipment_number: string;
  field_key: string;
  rule_type: string;
  message: string;
  created_at: string;
}

export function CompliancePage() {
  const { t } = useTranslation();
  const { currentTenant } = useTenant();
  const [issues, setIssues] = useState<ComplianceIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant) return;
    apiClient
      .get(`/tenants/${currentTenant.id}/compliance`)
      .then((res) => setIssues(res.data))
      .finally(() => setIsLoading(false));
  }, [currentTenant]);

  const columns = useMemo<ColumnDef<ComplianceIssue, any>[]>(
    () => [
      {
        accessorKey: "shipment_number",
        header: t("shipments.number", "Shipment"),
        cell: (info) => <span className="data-id">{info.getValue() as string}</span>,
      },
      { accessorKey: "field_key", header: t("compliance.field", "Field") },
      { accessorKey: "message", header: t("compliance.issue", "Issue") },
      {
        accessorKey: "created_at",
        header: t("compliance.detected", "Detected"),
        cell: (info) => new Date(info.getValue() as string).toLocaleString(),
      },
    ],
    [t]
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-surface-text">{t("nav.compliance")}</h1>
        <p className="mt-0.5 text-sm text-surface-muted">
          {t("compliance.subtitle", "Business rule validation failures across all shipments.")}
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-surface-muted">{t("common.loading")}</p>
      ) : (
        <EnterpriseDataTable data={issues} columns={columns} emptyMessage={t("compliance.empty", "No compliance issues found.")} />
      )}
    </div>
  );
}
