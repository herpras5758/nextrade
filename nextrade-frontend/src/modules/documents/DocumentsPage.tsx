import { useTranslation } from "react-i18next";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { UploadCloud, ExternalLink, AlertTriangle, CheckCircle, Clock, Loader } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { apiClient } from "../../lib/apiClient";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../store/tenantContext";
import { EnterpriseDataTable } from "../../components/ui/EnterpriseDataTable";

interface ApiDocument {
  id: string;
  file_name: string;
  document_type: string;
  status: string;
  intake_source: string;
  uploaded_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: typeof CheckCircle }> = {
  pending_upload: { label: "Uploading", className: "badge-neutral", icon: Loader },
  uploaded: { label: "Queued", className: "badge-neutral", icon: Clock },
  extracting: { label: "Extracting", className: "badge bg-warning-100 text-warning-600", icon: Loader },
  extracted: { label: "Extracted", className: "badge-success", icon: CheckCircle },
  needs_review: { label: "Needs Review", className: "badge-warning", icon: AlertTriangle },
};

export function DocumentsPage() {
  const { t } = useTranslation();
  const { claims } = useAuth();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();

  const [documents, setDocuments] = useState<ApiDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const uploadQueue = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(() => {
    if (!currentTenant) return;
    apiClient.get(`/tenants/${currentTenant.id}/documents`)
      .then((res) => setDocuments(res.data))
      .finally(() => setIsLoading(false));
  }, [currentTenant]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  useEffect(() => {
    const inProgress = documents.some((d) => ["pending_upload", "uploaded", "extracting"].includes(d.status));
    if (!inProgress) return;
    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  async function uploadOneFile(file: File) {
    if (!currentTenant) return;
    uploadQueue.current += 1;
    setIsUploading(true);
    try {
      const { data } = await apiClient.post(`/tenants/${currentTenant.id}/documents/upload-url`, {
        fileName: file.name, contentType: file.type || "application/octet-stream", uploadedBy: claims?.sub,
      });
      await fetch(data.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      await apiClient.patch(`/tenants/${currentTenant.id}/documents/${data.documentId}/confirm-upload`);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      uploadQueue.current -= 1;
      if (uploadQueue.current === 0) setIsUploading(false);
      fetchDocuments();
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(uploadOneFile);
  }

  const columns = useMemo<ColumnDef<ApiDocument, any>[]>(() => [
    {
      accessorKey: "file_name",
      header: "Nama file",
      cell: (info) => (
        <button onClick={() => navigate(`/idp-studio/${info.row.original.id}`)}
          className="text-xs font-medium text-intel-500 hover:underline text-left max-w-[240px] truncate block">
          {info.getValue() as string}
        </button>
      ),
    },
    {
      accessorKey: "document_type",
      header: "Tipe dokumen",
      cell: (info) => <span className="badge-neutral badge">{info.getValue() as string || "—"}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: (info) => {
        const cfg = STATUS_CONFIG[info.getValue() as string] ?? { label: info.getValue() as string, className: "badge-neutral", icon: Clock };
        const Icon = cfg.icon;
        return (
          <span className={`badge ${cfg.className} gap-1`}>
            <Icon size={10} />
            {cfg.label}
          </span>
        );
      },
    },
    {
      accessorKey: "intake_source",
      header: "Sumber",
      cell: (info) => <span className="badge-neutral badge capitalize">{(info.getValue() as string)?.replace(/_/g, " ") || "—"}</span>,
    },
    {
      accessorKey: "uploaded_at",
      header: "Diunggah",
      cell: (info) => (
        <span className="text-surface-muted">
          {new Date(info.getValue() as string).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: (info) => (
        <button onClick={(e) => { e.stopPropagation(); navigate(`/idp-studio/${info.row.original.id}`); }}
          className="flex items-center gap-1 text-2xs text-intel-500 hover:text-intel-400 transition-colors">
          <ExternalLink size={11} /> IDP Studio
        </button>
      ),
    },
  ], [navigate]);

  return (
    <div className="page-container">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="page-title">Pemrosesan Dokumen</h1>
          <p className="page-subtitle">Upload, track, dan review semua dokumen shipment</p>
        </div>
        <button onClick={() => inputRef.current?.click()} className="btn-primary">
          <UploadCloud size={14} /> Upload dokumen
        </button>
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`mb-5 flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed py-10 transition-all ${
          dragOver ? "border-intel-500 bg-intel-50" : "border-surface-border bg-surface-page hover:border-intel-500 hover:bg-intel-50"
        }`}
      >
        <UploadCloud size={24} className={`mb-2 transition-colors ${dragOver ? "text-intel-500" : "text-surface-muted"}`} />
        <p className="text-sm font-medium text-surface-text">
          {isUploading ? "Mengupload..." : "Seret file ke sini atau klik untuk memilih"}
        </p>
        <p className="text-xs text-surface-muted mt-0.5">PDF, JPG, PNG, TIFF — maksimal 50MB per file</p>
        {isUploading && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-intel-500">
            <Loader size={12} className="animate-spin" />
            Mengupload dan memproses...
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="card p-8 text-center text-sm text-surface-muted">Memuat dokumen...</div>
      ) : (
        <EnterpriseDataTable
          data={documents}
          columns={columns}
          searchPlaceholder="Cari dokumen..."
          emptyMessage="Belum ada dokumen. Mulai dengan mengupload file."
        />
      )}
    </div>
  );
}
