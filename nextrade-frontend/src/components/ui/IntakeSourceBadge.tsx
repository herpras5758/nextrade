import { Upload, Files, Mail, Plug, FolderSync, FileCode } from "lucide-react";

// Visual identity for "where did this document come from" — used in
// Documents table, Dashboard source breakdown, and anywhere else a
// document's intake_source needs to be shown. One implementation, one
// place to update if the source list changes (mirrors backend
// lib/intakeSources.ts).

const SOURCE_CONFIG: Record<string, { label: string; icon: typeof Upload; className: string }> = {
  manual_upload: { label: "Manual Upload", icon: Upload, className: "bg-surface-page text-surface-muted" },
  bulk_upload: { label: "Bulk Upload", icon: Files, className: "bg-surface-page text-surface-muted" },
  email_intake: { label: "Email Intake", icon: Mail, className: "bg-intel-50 text-intel-500" },
  api: { label: "API", icon: Plug, className: "bg-intel-50 text-intel-500" },
  ftp: { label: "FTP/SFTP", icon: FolderSync, className: "bg-intel-50 text-intel-500" },
  edi: { label: "EDI", icon: FileCode, className: "bg-intel-50 text-intel-500" },
};

export function IntakeSourceBadge({ source }: { source: string }) {
  const config = SOURCE_CONFIG[source] ?? { label: source, icon: Upload, className: "bg-surface-page text-surface-muted" };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ${config.className}`}>
      <Icon size={11} />
      {config.label}
    </span>
  );
}
