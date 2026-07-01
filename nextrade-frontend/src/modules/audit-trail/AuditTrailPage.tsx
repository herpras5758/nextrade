import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ColumnDef } from "@tanstack/react-table";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";
import { EnterpriseDataTable } from "../../components/ui/EnterpriseDataTable";

interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  created_at: string;
}

export function AuditTrailPage() {
  const { t } = useTranslation();
  const { currentTenant } = useTenant();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant) return;
    apiClient
      .get(`/tenants/${currentTenant.id}/audit-trail`)
      .then((res) => setEntries(res.data))
      .finally(() => setIsLoading(false));
  }, [currentTenant]);

  const columns = useMemo<ColumnDef<AuditEntry, any>[]>(
    () => [
      { accessorKey: "action", header: t("auditTrail.action", "Action") },
      { accessorKey: "entity_type", header: t("auditTrail.entityType", "Entity") },
      {
        accessorKey: "entity_id",
        header: t("auditTrail.entityId", "Entity ID"),
        cell: (info) => <span className="data-id">{(info.getValue() as string)?.slice(0, 8)}</span>,
      },
      {
        accessorKey: "created_at",
        header: t("auditTrail.timestamp", "Timestamp"),
        cell: (info) => new Date(info.getValue() as string).toLocaleString(),
      },
    ],
    [t]
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-surface-text">{t("nav.auditTrail")}</h1>
        <p className="mt-0.5 text-sm text-surface-muted">
          {t("auditTrail.subtitle", "Every mutating action across this tenant, append-only.")}
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-surface-muted">{t("common.loading")}</p>
      ) : (
        <EnterpriseDataTable data={entries} columns={columns} emptyMessage={t("common.noData")} />
      )}
    </div>
  );
}
