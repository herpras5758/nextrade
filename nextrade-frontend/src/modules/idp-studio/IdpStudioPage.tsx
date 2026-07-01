import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ArrowLeft, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Maximize2, RotateCcw, Check, AlertTriangle,
  MousePointer, Square, Type, Table2, KeyRound, Minus,
  Highlighter, MessageSquare, EyeOff, Sparkles, FileText
} from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useTenant } from "../../store/tenantContext";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface DocInfo {
  id: string;
  shipment_id: string | null;
  file_name: string;
  document_type: string;
  status: string;
  intake_source: string;
}

interface ExtractedField {
  id: string;
  field_key: string;
  raw_value: string;
  confidence: number;
  reasoning: string;
  resolved_value: string;
  field_status: string;
}

interface ShipmentDoc {
  id: string;
  file_name: string;
  document_type: string;
  status: string;
}

const FIELD_GROUPS: Record<string, string[]> = {
  "Invoice Information": ["invoice_number", "invoice_date", "po_number", "currency", "incoterm"],
  "Supplier": ["exporter_name", "shipper_name", "supplier_name", "country_origin"],
  "Buyer / Consignee": ["consignee_name", "consignee_address"],
  "Logistics": ["bl_number", "vessel_name", "voyage", "pol", "pod", "container_number"],
  "Values": ["total_value", "gross_weight", "net_weight", "cbm", "package_count"],
};

const TOOLS = [
  { id: "select", icon: MousePointer, label: "Select" },
  { id: "rect", icon: Square, label: "Rect" },
  { id: "text", icon: Type, label: "Text" },
  { id: "table", icon: Table2, label: "Table" },
  { id: "keyval", icon: KeyRound, label: "Key Val" },
  { id: "line", icon: Minus, label: "Line" },
  { id: "mark", icon: Highlighter, label: "Mark" },
  { id: "comment", icon: MessageSquare, label: "Comment" },
  { id: "redact", icon: EyeOff, label: "Redact" },
];

function ConfBadge({ conf }: { conf: number }) {
  const pct = Math.round(conf * 100);
  const cls = pct >= 90 ? "text-success-600 bg-success-100" : pct >= 75 ? "text-warning-600 bg-warning-100" : "text-danger-600 bg-danger-100";
  return <span className={`rounded-full px-1.5 py-0.5 font-mono text-2xs font-semibold flex-shrink-0 ${cls}`}>{pct}%</span>;
}

function fieldLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function IdpStudioPage() {
  const { t } = useTranslation();
  const { documentId } = useParams<{ documentId: string }>();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<DocInfo | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [shipmentDocs, setShipmentDocs] = useState<ShipmentDoc[]>([]);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1.2);
  const [activeTab, setActiveTab] = useState<"fields" | "json" | "confidence">("fields");
  const [activeTool, setActiveTool] = useState("select");
  const [activeField, setActiveField] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant || !documentId) return;
    setIsLoading(true);
    setDoc(null);
    setDownloadUrl(null);
    setFields([]);
    Promise.all([
      apiClient.get(`/tenants/${currentTenant.id}/documents/${documentId}`),
      apiClient.get(`/tenants/${currentTenant.id}/documents/${documentId}/download-url`).catch(() => ({ data: { downloadUrl: null } })),
      apiClient.get(`/tenants/${currentTenant.id}/documents/${documentId}/extracted-fields`).catch(() => ({ data: [] })),
    ]).then(([docRes, urlRes, fieldsRes]) => {
      setDoc(docRes.data);
      setDownloadUrl(urlRes.data.downloadUrl);
      setFields(fieldsRes.data);
      if (docRes.data.shipment_id) {
        apiClient.get(`/tenants/${currentTenant.id}/shipments/${docRes.data.shipment_id}/documents`).then((r) => setShipmentDocs(r.data)).catch(() => {});
      }
    }).finally(() => setIsLoading(false));
  }, [currentTenant, documentId]);

  const conf = fields.length > 0 ? Math.round(fields.reduce((s, f) => s + f.confidence, 0) / fields.length * 100) : 0;

  const groupedFields = Object.entries(FIELD_GROUPS).map(([group, keys]) => ({
    group,
    fields: fields.filter((f) => keys.includes(f.field_key)),
  })).filter((g) => g.fields.length > 0);

  const allGroupedKeys = Object.values(FIELD_GROUPS).flat();
  const ungrouped = fields.filter((f) => !allGroupedKeys.includes(f.field_key));

  return (
    <div className="flex overflow-hidden" style={{ margin: "-24px", height: "calc(100vh - 49px)" }}>
      {/* LEFT */}
      <aside className="flex w-56 flex-col border-r border-navy-800 bg-navy-900 flex-shrink-0">
        <div className="flex items-center gap-2 border-b border-navy-800 px-3 py-2.5">
          <button onClick={() => navigate(-1)} className="text-navy-600 hover:text-white"><ArrowLeft size={14} /></button>
          <span className="text-2xs font-semibold uppercase tracking-wider text-navy-600">IDP Studio</span>
        </div>
        <div className="border-b border-navy-800 px-3 py-2">
          <p className="text-2xs font-semibold uppercase tracking-wider text-navy-600">Documents</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {(shipmentDocs.length > 0 ? shipmentDocs : doc ? [{ id: doc.id, file_name: doc.file_name, document_type: doc.document_type, status: doc.status }] : []).map((sd) => (
            <Link key={sd.id} to={`/idp-studio/${sd.id}`}
              className={`flex items-center gap-2.5 px-3 py-2.5 border-l-2 transition-colors ${sd.id === documentId ? "border-intel-500 bg-navy-800 text-white" : "border-transparent text-navy-600 hover:bg-navy-800 hover:text-white"}`}>
              <FileText size={13} className="flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-2xs">{sd.file_name}</p>
                <p className="text-2xs opacity-50 truncate">{sd.document_type}</p>
              </div>
              {sd.status === "extracted" && <div className="flex-shrink-0 w-4 h-4 rounded-full bg-intel-500 flex items-center justify-center"><Check size={9} strokeWidth={3} className="text-navy-950" /></div>}
              {sd.status === "needs_review" && <AlertTriangle size={12} className="flex-shrink-0 text-warning-600" />}
            </Link>
          ))}
        </div>
        <div className="border-t border-navy-800 p-3">
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-navy-600">Tools</p>
          <div className="grid grid-cols-3 gap-1">
            {TOOLS.map(({ id, icon: Icon, label }) => (
              <button key={id} title={label} onClick={() => setActiveTool(id)}
                className={`flex flex-col items-center gap-0.5 rounded p-1.5 text-2xs transition-colors ${activeTool === id ? "bg-intel-500/20 text-intel-500" : "text-navy-600 hover:bg-navy-800 hover:text-white"}`}>
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
          <button className="mt-2 w-full rounded bg-intel-500 py-1.5 text-2xs font-semibold text-navy-950 hover:bg-intel-400 flex items-center justify-center gap-1">
            <Sparkles size={11} /> AI Auto Capture
          </button>
        </div>
      </aside>

      {/* CENTER */}
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: "#0A1120" }}>
        <div className="flex items-center gap-2 border-b border-navy-800 bg-navy-900 px-3 py-1.5 flex-shrink-0">
          <button onClick={() => setPageNumber((p) => Math.max(1, p - 1))} disabled={pageNumber <= 1} className="rounded p-1 text-navy-600 hover:bg-navy-800 hover:text-white disabled:opacity-30"><ChevronLeft size={14} /></button>
          <span className="text-xs text-white">{pageNumber} / {numPages || "—"}</span>
          <button onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))} disabled={pageNumber >= numPages} className="rounded p-1 text-navy-600 hover:bg-navy-800 hover:text-white disabled:opacity-30"><ChevronRight size={14} /></button>
          <div className="mx-1 h-4 w-px bg-navy-800" />
          <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))} className="rounded p-1 text-navy-600 hover:bg-navy-800 hover:text-white"><ZoomOut size={13} /></button>
          <span className="w-10 text-center text-xs text-white">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.2))} className="rounded p-1 text-navy-600 hover:bg-navy-800 hover:text-white"><ZoomIn size={13} /></button>
          <button onClick={() => setZoom(1.2)} className="rounded p-1 text-navy-600 hover:bg-navy-800 hover:text-white"><RotateCcw size={12} /></button>
          <button className="rounded p-1 text-navy-600 hover:bg-navy-800 hover:text-white"><Maximize2 size={12} /></button>
          <span className="ml-auto text-2xs text-navy-600 truncate max-w-xs">{doc?.file_name}</span>
        </div>

        <div className="flex-1 overflow-auto flex items-start justify-center p-6">
          {isLoading ? (
            <p className="mt-16 text-xs text-navy-600">{t("common.loading")}</p>
          ) : downloadUrl ? (
            <Document file={downloadUrl} onLoadSuccess={({ numPages }) => setNumPages(numPages)}
              loading={<p className="mt-16 text-xs text-navy-600">Loading PDF...</p>}
              error={<p className="mt-16 text-xs text-danger-600">Could not load PDF.</p>}>
              <Page pageNumber={pageNumber} scale={zoom} className="shadow-2xl" renderTextLayer renderAnnotationLayer={false} />
            </Document>
          ) : (
            <div className="mt-16 flex flex-col items-center gap-3 text-navy-700">
              <FileText size={40} strokeWidth={1} />
              <p className="text-sm">{doc?.status === "uploaded" ? "Queued for processing..." : doc?.status === "extracting" ? "Extracting fields..." : "No preview available"}</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-navy-800 bg-navy-900 px-4 py-2 flex-shrink-0">
          <div className="relative flex-shrink-0" style={{ width: 36, height: 36 }}>
            <svg width="36" height="36" viewBox="0 0 36 36" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="18" cy="18" r="14" fill="none" stroke="#1B2A4A" strokeWidth="4" />
              <circle cx="18" cy="18" r="14" fill="none" stroke={conf >= 90 ? "#10B981" : conf >= 75 ? "#F59E0B" : "#6B7280"}
                strokeWidth="4" strokeDasharray={`${2 * Math.PI * 14 * conf / 100} ${2 * Math.PI * 14}`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-mono text-2xs font-bold text-intel-500">{conf}%</div>
          </div>
          <div>
            <p className="text-2xs uppercase tracking-wide font-semibold" style={{ color: "#4B6087" }}>Confidence Score</p>
            <p className="text-xs text-white">Overall {conf}% · {fields.length} fields</p>
          </div>
          <div className="h-5 w-px bg-navy-800" />
          <div>
            <p className="text-2xs uppercase tracking-wide font-semibold" style={{ color: "#4B6087" }}>Document Type</p>
            <span className="rounded-full px-2 py-0.5 text-2xs font-medium" style={{ background: "rgba(14,165,164,.15)", color: "#0EA5A4" }}>{doc?.document_type ?? "UNCLASSIFIED"}</span>
          </div>
          <div className="h-5 w-px bg-navy-800" />
          <div>
            <p className="text-2xs uppercase tracking-wide font-semibold" style={{ color: "#4B6087" }}>Extraction Mode</p>
            <span className="rounded-full px-2 py-0.5 text-2xs font-medium" style={{ background: "rgba(96,165,250,.15)", color: "#60A5FA" }}>AI + Human Review</span>
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <aside className="flex w-80 flex-col border-l border-navy-800 bg-navy-900 flex-shrink-0 overflow-hidden">
        <div className="flex border-b border-navy-800 flex-shrink-0">
          {(["fields", "json", "confidence"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors border-b-2 ${activeTab === tab ? "border-intel-500 text-intel-500" : "border-transparent text-navy-600 hover:text-white"}`}>
              {tab}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between border-b border-navy-800 px-3 py-2 flex-shrink-0">
          <span className="text-xs" style={{ color: "#4B6087" }}>Extracted data</span>
          <button className="flex items-center gap-1 rounded border px-2 py-1 text-2xs transition-colors" style={{ borderColor: "rgba(14,165,164,.5)", color: "#0EA5A4" }}>
            <Check size={10} /> Validate
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === "fields" && (
            fields.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <Sparkles size={28} className="mb-3" style={{ color: "#2A3F5F" }} />
                <p className="text-sm" style={{ color: "#4B6087" }}>
                  {doc?.status === "uploaded" || doc?.status === "extracting" ? "Extracting fields..." : "No fields extracted yet"}
                </p>
              </div>
            ) : (
              <>
                {groupedFields.map(({ group, fields: gFields }) => (
                  <div key={group}>
                    <div className="sticky top-0 border-t border-navy-800 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider" style={{ background: "#101828", color: "#4B6087" }}>
                      {group}
                    </div>
                    {gFields.map((field) => (
                      <div key={field.id} onClick={() => setActiveField(field.field_key === activeField ? null : field.field_key)}
                        className={`flex items-center gap-2 cursor-pointer px-3 py-2 transition-colors ${activeField === field.field_key ? "bg-intel-500/10" : "hover:bg-navy-800"}`}>
                        <span className="w-24 flex-shrink-0 text-2xs leading-tight" style={{ color: "#4B6087" }}>{fieldLabel(field.field_key)}</span>
                        <span className="flex-1 truncate font-mono text-xs text-white" title={field.raw_value}>{field.raw_value}</span>
                        <ConfBadge conf={field.confidence} />
                      </div>
                    ))}
                  </div>
                ))}
                {ungrouped.length > 0 && (
                  <div>
                    <div className="sticky top-0 border-t border-navy-800 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider" style={{ background: "#101828", color: "#4B6087" }}>Other</div>
                    {ungrouped.map((field) => (
                      <div key={field.id} onClick={() => setActiveField(field.field_key === activeField ? null : field.field_key)}
                        className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-navy-800 transition-colors">
                        <span className="w-24 flex-shrink-0 text-2xs" style={{ color: "#4B6087" }}>{fieldLabel(field.field_key)}</span>
                        <span className="flex-1 truncate font-mono text-xs text-white">{field.raw_value}</span>
                        <ConfBadge conf={field.confidence} />
                      </div>
                    ))}
                  </div>
                )}
                {activeField && (
                  <div className="border-t border-navy-800 p-3">
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-wider" style={{ color: "#4B6087" }}>AI Reasoning</p>
                    <p className="text-xs text-white leading-relaxed">{fields.find((f) => f.field_key === activeField)?.reasoning ?? "No reasoning available."}</p>
                  </div>
                )}
              </>
            )
          )}

          {activeTab === "json" && (
            <pre className="p-3 text-2xs leading-relaxed overflow-x-auto" style={{ color: "#4ADE80", fontFamily: "monospace" }}>
              {JSON.stringify(Object.fromEntries(fields.map((f) => [f.field_key, { value: f.raw_value, confidence: Math.round(f.confidence * 100) + "%" }])), null, 2)}
            </pre>
          )}

          {activeTab === "confidence" && (
            <div className="p-3 space-y-2.5">
              {[...fields].sort((a, b) => b.confidence - a.confidence).map((field) => {
                const pct = Math.round(field.confidence * 100);
                return (
                  <div key={field.id}>
                    <div className="flex justify-between text-2xs mb-1">
                      <span style={{ color: "#4B6087" }}>{fieldLabel(field.field_key)}</span>
                      <span className="font-mono text-white">{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#1B2A4A" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? "#10B981" : pct >= 75 ? "#F59E0B" : "#EF4444" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
