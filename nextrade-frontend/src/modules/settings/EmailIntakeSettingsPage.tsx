import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mail, Plus, X } from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../store/tenantContext";
import { EnterpriseDataTable } from "../../components/ui/EnterpriseDataTable";
import { ColumnDef } from "@tanstack/react-table";

interface EmailIntakeConfig {
  intake_address: string;
  allowed_senders: string[];
  is_active: boolean;
}

interface EmailLogEntry {
  sender_address: string;
  subject: string;
  status: string;
  attachment_count: number;
  received_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  ACCEPTED: "bg-success-100 text-success-600",
  REJECTED_UNAUTHORIZED_SENDER: "bg-danger-100 text-danger-600",
  REJECTED_NO_ATTACHMENTS: "bg-surface-page text-surface-muted",
  REJECTED_INACTIVE_INTAKE: "bg-surface-page text-surface-muted",
};

export function EmailIntakeSettingsPage() {
  const { t } = useTranslation();
  const { claims } = useAuth();
  const { currentTenant } = useTenant();
  const isAdmin = claims?.["cognito:groups"]?.includes("admin");

  const [config, setConfig] = useState<EmailIntakeConfig | null>(null);
  const [draftAddress, setDraftAddress] = useState("");
  const [logs, setLogs] = useState<EmailLogEntry[]>([]);
  const [newSender, setNewSender] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!currentTenant) return;
    apiClient.get(`/tenants/${currentTenant.id}/email-intake-config`).then((res) => setConfig(res.data));
    apiClient.get(`/tenants/${currentTenant.id}/email-intake-log`).then((res) => setLogs(res.data));
  }, [currentTenant]);

  async function saveConfig(updated: EmailIntakeConfig) {
    if (!currentTenant) return;
    setIsSaving(true);
    try {
      const { data } = await apiClient.put(`/tenants/${currentTenant.id}/email-intake-config`, {
        intakeAddress: updated.intake_address,
        allowedSenders: updated.allowed_senders,
        isActive: updated.is_active,
      });
      setConfig(data);
    } finally {
      setIsSaving(false);
    }
  }

  const logColumns: ColumnDef<EmailLogEntry, any>[] = [
    { accessorKey: "sender_address", header: t("emailIntake.sender", "Sender") },
    { accessorKey: "subject", header: t("emailIntake.subject", "Subject") },
    {
      accessorKey: "status",
      header: t("table.status", "Status"),
      cell: (info) => (
        <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${STATUS_STYLE[info.getValue() as string] ?? ""}`}>
          {info.getValue() as string}
        </span>
      ),
    },
    { accessorKey: "attachment_count", header: t("emailIntake.attachments", "Attachments") },
    {
      accessorKey: "received_at",
      header: t("emailIntake.received", "Received"),
      cell: (info) => new Date(info.getValue() as string).toLocaleString(),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-surface-text">{t("nav.emailIntake")}</h1>
        <p className="mt-0.5 text-sm text-surface-muted">
          {t("emailIntake.subtitle", "Auto-forward emails from suppliers/forwarders into the document pipeline.")}
        </p>
      </div>

      <div className="mb-6 rounded border border-surface-border bg-surface-card p-4 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <Mail size={16} className="text-intel-500" />
          <span className="text-sm font-semibold text-surface-text">
            {t("emailIntake.intakeAddress", "Intake Address")}
          </span>
        </div>

        {config ? (
          <p className="data-id mb-4 text-sm">{config.intake_address}</p>
        ) : isAdmin ? (
          <div className="mb-4 flex gap-2">
            <input
              value={draftAddress}
              onChange={(e) => setDraftAddress(e.target.value)}
              placeholder="intake-yourcompany@mail.nextrade.id"
              className="flex-1 rounded border border-surface-border px-3 py-1.5 text-sm outline-none focus-visible:border-intel-500"
            />
            <button
              disabled={!draftAddress || isSaving}
              onClick={() => saveConfig({ intake_address: draftAddress, allowed_senders: [], is_active: true })}
              className="rounded bg-navy-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-700 disabled:opacity-40"
            >
              {t("common.save")}
            </button>
          </div>
        ) : (
          <p className="mb-4 text-sm text-surface-muted">{t("emailIntake.notConfigured", "Not configured yet")}</p>
        )}

        {config && (
          <>
            <p className="mb-2 text-2xs font-semibold uppercase text-surface-muted">
              {t("emailIntake.allowedSenders", "Allowed Senders")}
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {config.allowed_senders.map((sender) => (
                <span key={sender} className="inline-flex items-center gap-1 rounded-full bg-surface-page px-2 py-1 text-2xs text-surface-text">
                  {sender}
                  {isAdmin && (
                    <button
                      onClick={() => saveConfig({ ...config, allowed_senders: config.allowed_senders.filter((s) => s !== sender) })}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
              {config.allowed_senders.length === 0 && (
                <span className="text-2xs text-surface-muted">{t("common.noData")}</span>
              )}
            </div>
            {isAdmin ? (
              <div className="flex gap-2">
                <input
                  value={newSender}
                  onChange={(e) => setNewSender(e.target.value)}
                  placeholder={t("emailIntake.addSenderPlaceholder", "email@supplier.com or @domain.com")}
                  className="flex-1 rounded border border-surface-border px-3 py-1.5 text-sm outline-none focus-visible:border-intel-500"
                />
                <button
                  disabled={!newSender || isSaving}
                  onClick={() => {
                    saveConfig({ ...config, allowed_senders: [...config.allowed_senders, newSender] });
                    setNewSender("");
                  }}
                  className="flex items-center gap-1 rounded bg-navy-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-700 disabled:opacity-40"
                >
                  <Plus size={14} /> {t("common.add", "Add")}
                </button>
              </div>
            ) : (
              <p className="text-2xs text-surface-muted">{t("emailIntake.adminOnly", "Only admins can edit this list.")}</p>
            )}
          </>
        )}
      </div>

      <p className="mb-2 text-sm font-semibold text-surface-text">{t("emailIntake.recentActivity", "Recent Activity")}</p>
      <EnterpriseDataTable data={logs} columns={logColumns} emptyMessage={t("common.noData")} />
    </div>
  );
}
