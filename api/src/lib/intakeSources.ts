// Intake Sources Registry — config-driven (Rule #4) list of every
// channel a document can enter the system through. This is what makes
// "darimana datanya" answerable and auditable at any time, and what an
// admin sees/toggles in Settings → Integrations (frontend wiring is the
// next step; this is the backend source of truth it will read from).
//
// Adding a new intake channel (API key ingestion, FTP drop, EDI feed —
// all named in the original vision doc's "Supported integration" list)
// means adding ONE entry here, not new columns or new branching logic
// anywhere else. documents.intake_source stores the `key` below.

export interface IntakeSourceConfig {
  key: string;
  label: string;
  description: string;
  status: "active" | "planned" | "disabled";
  /** Whether an admin can toggle this on/off per tenant (false = always-on system default, e.g. manual upload) */
  configurable: boolean;
}

export const INTAKE_SOURCES: IntakeSourceConfig[] = [
  {
    key: "manual_upload",
    label: "Manual Upload",
    description: "Operator uploads a single document via the Document Processing UI.",
    status: "active",
    configurable: false,
  },
  {
    key: "bulk_upload",
    label: "Bulk Upload",
    description: "Operator selects many files at once (drag-and-drop batch).",
    status: "active",
    configurable: false,
  },
  {
    key: "email_intake",
    label: "Email Intake",
    description:
      "Documents arrive as email attachments via an auto-forwarding rule from the tenant's real mailbox to a registered NexTrade intake address. Sender allowlist is the security boundary.",
    status: "active",
    configurable: true,
  },
  {
    key: "api",
    label: "API Ingestion",
    description: "Third-party system pushes documents via authenticated API key.",
    status: "planned",
    configurable: true,
  },
  {
    key: "ftp",
    label: "FTP/SFTP Drop",
    description: "Tenant's existing FTP workflow drops files into a watched folder.",
    status: "planned",
    configurable: true,
  },
  {
    key: "edi",
    label: "EDI Feed",
    description: "Structured EDI messages from logistics/customs partners.",
    status: "planned",
    configurable: true,
  },
];

export function getIntakeSource(key: string): IntakeSourceConfig | undefined {
  return INTAKE_SOURCES.find((s) => s.key === key);
}
