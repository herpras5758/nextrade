import { useEffect, useState } from "react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";
import {
  FileText, Cpu, User, Server, Link, AlertTriangle, CheckCircle,
  Upload, RefreshCw, Clock
} from "lucide-react";

interface EvidenceEvent {
  id: string;
  event_time: string;
  event_type: string;
  producer_type: string;
  producer_ref: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, any>;
  sequence_num: string;
}

const PRODUCER_ICONS: Record<string, typeof FileText> = {
  OCR: Cpu, USER: User, ERP: Server, SYSTEM: Server,
  EMAIL: FileText, API: Link, IDENTITY_ENGINE: Link,
  REASONING_ENGINE: AlertTriangle, DRY_RUN_ENGINE: Upload,
};

const EVENT_COLORS: Record<string, string> = {
  DOCUMENT_RECEIVED: "text-blue-600 bg-blue-50",
  FIELD_EXTRACTED: "text-intel-500 bg-intel-50",
  SIGNAL_PRODUCED: "text-purple-600 bg-purple-50",
  SIGNAL_SUPERSEDED: "text-orange-600 bg-orange-50",
  IDENTITY_CREATED: "text-teal-600 bg-teal-50",
  IDENTITY_STRENGTH_CHANGED: "text-teal-600 bg-teal-50",
  SHIPMENT_MATCHED: "text-success-600 bg-success-100",
  SHIPMENT_STATUS_CHANGED: "text-success-600 bg-success-100",
  SHIPMENT_CONFLICT_DETECTED: "text-danger-600 bg-danger-100",
  REASONING_TRIGGERED: "text-warning-600 bg-warning-100",
  REASONING_COMPLETED: "text-warning-600 bg-warning-100",
  FIELD_CORRECTED: "text-orange-600 bg-orange-50",
  UPLOAD_SESSION_COMMITTED: "text-blue-600 bg-blue-50",
};

function formatPayload(payload: Record<string, any>): string {
  const keys = Object.keys(payload).slice(0, 3);
  return keys.map(k => `${k}: ${String(payload[k]).slice(0, 30)}`).join(" · ");
}

export function EvidenceTimeline({ entityId, limit = 20 }: { entityId?: string; limit?: number }) {
  const { currentTenant } = useTenant();
  const [events, setEvents] = useState<EvidenceEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant) return;
    const params = new URLSearchParams({ limit: String(limit) });
    if (entityId) params.set("entity_id", entityId);
    apiClient.get(`/tenants/${currentTenant.id}/admin/evidence-timeline?${params}`)
      .then(r => setEvents(r.data))
      .finally(() => setIsLoading(false));
  }, [currentTenant, entityId, limit]);

  if (isLoading) return <p className="text-sm text-surface-muted py-4">Memuat timeline...</p>;
  if (events.length === 0) return <p className="text-sm text-surface-muted py-4">Belum ada aktivitas.</p>;

  // Group by date
  const grouped = events.reduce<Record<string, EvidenceEvent[]>>((acc, evt) => {
    const date = new Date(evt.event_time).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
    (acc[date] ??= []).push(evt);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([date, evts]) => (
        <div key={date}>
          <div className="sticky top-0 bg-white flex items-center gap-2 py-1 mb-2">
            <div className="h-px flex-1 bg-surface-border" />
            <span className="text-2xs font-semibold text-surface-muted px-2">{date}</span>
            <div className="h-px flex-1 bg-surface-border" />
          </div>

          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-surface-border" />
            <div className="space-y-3">
              {evts.map(evt => {
                const Icon = PRODUCER_ICONS[evt.producer_type] ?? Clock;
                const colorCls = EVENT_COLORS[evt.event_type] ?? "text-surface-muted bg-surface-page";
                return (
                  <div key={evt.id} className="flex items-start gap-3 pl-2">
                    <div className={`relative z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${colorCls}`}>
                      <Icon size={11} />
                    </div>
                    <div className="flex-1 rounded-md border border-surface-border bg-white p-2.5 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-2xs font-semibold text-surface-text">{evt.event_type}</span>
                        <span className="badge-neutral badge text-2xs">{evt.producer_type}</span>
                        <span className="ml-auto text-2xs text-surface-muted">
                          {new Date(evt.event_time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </div>
                      {Object.keys(evt.payload).length > 0 && (
                        <p className="text-2xs text-surface-muted truncate">{formatPayload(evt.payload)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
