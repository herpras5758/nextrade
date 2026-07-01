import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, CheckCircle, BarChart2, FileCheck, FileText, Send,
  Loader, Sparkles, X, ArrowRight, ChevronRight,
} from "lucide-react";
import { apiClient } from "../../lib/apiClient";
import { useAuth } from "../../lib/AuthContext";
import { useTenant } from "../../store/tenantContext";
import { DryRunPreview, SessionFile } from "./DryRunPreview";

const STEPS = [
  { id: 1, label: "Upload File", icon: Upload },
  { id: 2, label: "Analisis AI", icon: Loader },
  { id: 3, label: "Preview", icon: BarChart2 },
  { id: 4, label: "Review & Validasi", icon: FileCheck },
  { id: 5, label: "Draft BC 2.3", icon: FileText },
  { id: 6, label: "Siap ke CEISA", icon: Send },
];

interface StagedFile {
  fileId: string;
  file: File;
  status: "pending" | "staging" | "staged" | "error";
  progress: number;
}

export function UploadWorkflowPage() {
  const { claims } = useAuth();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [previewData, setPreviewData] = useState<{ files: SessionFile[]; summary: any } | null>(null);
  const [shipmentType, setShipmentType] = useState("Import");
  const inputRef = useRef<HTMLInputElement>(null);

  const totalStaged = stagedFiles.length;
  const doneStaged = stagedFiles.filter(f => f.status === "staged").length;
  const stagingProgress = totalStaged > 0 ? Math.round((doneStaged / totalStaged) * 100) : 0;

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const newFiles: StagedFile[] = Array.from(fileList).map(f => ({
      fileId: crypto.randomUUID(), file: f, status: "pending", progress: 0,
    }));
    setStagedFiles(prev => [...prev, ...newFiles]);
  }

  async function startUpload() {
    if (!currentTenant || stagedFiles.length === 0) return;
    setStep(2);

    // 1. Create session
    const { data: session } = await apiClient.post(
      `/tenants/${currentTenant.id}/upload-sessions`,
      { userId: claims?.sub }
    );
    setSessionId(session.id);

    // 2. Stage each file
    for (const sf of stagedFiles) {
      setStagedFiles(prev => prev.map(f => f.fileId === sf.fileId ? { ...f, status: "staging", progress: 10 } : f));
      try {
        const { data } = await apiClient.post(
          `/tenants/${currentTenant.id}/upload-sessions/${session.id}/stage-file`,
          { fileName: sf.file.name, contentType: sf.file.type || "application/octet-stream", fileSizeBytes: sf.file.size }
        );
        setStagedFiles(prev => prev.map(f => f.fileId === sf.fileId ? { ...f, progress: 40 } : f));

        await fetch(data.uploadUrl, {
          method: "PUT", body: sf.file,
          headers: { "Content-Type": sf.file.type || "application/octet-stream" },
        });
        setStagedFiles(prev => prev.map(f => f.fileId === sf.fileId ? { ...f, status: "staged", progress: 100, fileId: data.fileId } : f));
      } catch {
        setStagedFiles(prev => prev.map(f => f.fileId === sf.fileId ? { ...f, status: "error" } : f));
      }
    }

    // 3. Trigger analysis
    setIsAnalyzing(true);
    await apiClient.post(`/tenants/${currentTenant.id}/upload-sessions/${session.id}/analyze`);

    // 4. Poll for preview result
    let retries = 0;
    const poll = setInterval(async () => {
      retries++;
      if (retries > 60) { clearInterval(poll); setIsAnalyzing(false); return; }
      try {
        const { data } = await apiClient.get(
          `/tenants/${currentTenant.id}/upload-sessions/${session.id}/preview`
        );
        if (data.session.status === 'PREVIEWED') {
          clearInterval(poll);
          setIsAnalyzing(false);
          setPreviewData({ files: data.files, summary: data.session.summary });
          setStep(3);
        }
      } catch {}
    }, 3000);
  }

  async function handleResolveConflict(fileId: string, action: string, shipmentId?: string) {
    if (!currentTenant || !sessionId) return;
    const { data } = await apiClient.patch(
      `/tenants/${currentTenant.id}/upload-sessions/${sessionId}/files/${fileId}`,
      { action, matchedShipmentId: shipmentId }
    );
    // Refresh preview
    const { data: preview } = await apiClient.get(
      `/tenants/${currentTenant.id}/upload-sessions/${sessionId}/preview`
    );
    setPreviewData({ files: preview.files, summary: preview.session.summary });
  }

  async function handleCommit() {
    if (!currentTenant || !sessionId) return;
    setIsCommitting(true);
    try {
      const { data } = await apiClient.post(`/tenants/${currentTenant.id}/upload-sessions/${sessionId}/commit`);
      if (data.shipmentIds && data.shipmentIds.length > 1) {
        // Multi shipment → ke BC 2.3 list
        navigate('/bc23');
      } else if (data.shipmentId) {
        // Single shipment → langsung ke shipment detail
        navigate(`/bc23/${data.shipmentId}`);
      } else {
        setStep(4);
      }
    } catch (e) {
      console.error("Commit failed", e);
    } finally {
      setIsCommitting(false);
    }
  }

  async function handleCancel() {
    if (sessionId && currentTenant) {
      await apiClient.delete(`/tenants/${currentTenant.id}/upload-sessions/${sessionId}`).catch(() => {});
    }
    setStagedFiles([]);
    setSessionId(null);
    setPreviewData(null);
    setStep(1);
  }

  return (
    <div className="page-container max-w-none">
      <div className="mb-4">
        <h1 className="page-title">Upload & Proses Dokumen</h1>
        <p className="page-subtitle">End-to-end: dari upload hingga siap kirim ke CEISA</p>
      </div>

      {/* Step indicator */}
      <div className="mb-6 flex items-center">
        {STEPS.map((s, idx) => {
          const done = s.id < step;
          const active = s.id === step;
          const Icon = s.icon;
          return (
            <div key={s.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs transition-all ${
                  done ? "border-success-600 bg-success-600 text-white" :
                  active ? "border-[#1B4FD8] bg-[#1B4FD8] text-white" :
                  "border-surface-border bg-white text-surface-muted"
                }`}>
                  {done ? <CheckCircle size={14} /> : <Icon size={13} />}
                </div>
                <span className={`text-2xs font-medium whitespace-nowrap hidden sm:block ${
                  active ? "text-[#1B4FD8]" : done ? "text-success-600" : "text-surface-muted"
                }`}>{s.label}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mb-4 ${done ? "bg-success-600" : "bg-surface-border"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── STEP 1: UPLOAD ── */}
      {step === 1 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 card">
            <div className="card-header">
              <span className="section-title">Upload Dokumen</span>
            </div>
            <div className="p-4">
              {/* Tabs */}
              <div className="flex border-b border-surface-border mb-4">
                {["Upload File", "Upload per File", "1 Shipment dalam 1 Dokumen"].map((t, i) => (
                  <button key={t} className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${i === 0 ? "border-[#1B4FD8] text-[#1B4FD8]" : "border-transparent text-surface-muted hover:text-surface-text"}`}>
                    {t}
                  </button>
                ))}
              </div>

              {/* Dropzone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                onClick={() => inputRef.current?.click()}
                className={`mb-4 flex flex-col items-center justify-center rounded-md border-2 border-dashed py-12 cursor-pointer transition-all ${
                  dragOver ? "border-[#1B4FD8] bg-blue-50" : "border-surface-border hover:border-[#1B4FD8] hover:bg-blue-50"
                }`}
              >
                <Upload size={22} className={`mb-2 ${dragOver ? "text-[#1B4FD8]" : "text-surface-muted"}`} />
                <p className="text-sm font-medium text-surface-text">Drag & drop file di sini</p>
                <p className="text-2xs text-surface-muted mt-0.5">atau</p>
                <button className="mt-2 btn-primary text-xs">Pilih File</button>
                <p className="text-2xs text-surface-muted mt-3 text-center">
                  Mendukung PDF, JPG, PNG, TIF (Maks 100MB/file · 500 file per upload)
                </p>
                <input ref={inputRef} type="file" multiple className="hidden"
                  onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
              </div>

              {/* File list */}
              {stagedFiles.length > 0 && (
                <div>
                  <div className="text-2xs font-semibold text-surface-muted mb-1.5">
                    File yang dipilih ({stagedFiles.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded border border-surface-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-surface-page border-b border-surface-border">
                          <th className="px-3 py-2 text-left text-2xs font-semibold uppercase text-surface-muted">Nama File</th>
                          <th className="px-3 py-2 text-left text-2xs font-semibold uppercase text-surface-muted">Ukuran</th>
                          <th className="px-3 py-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-border">
                        {stagedFiles.map(f => (
                          <tr key={f.fileId} className="hover:bg-surface-page">
                            <td className="px-3 py-2">
                              <span className="flex items-center gap-1.5">
                                <FileText size={11} className="text-surface-muted flex-shrink-0" />
                                <span className="truncate max-w-xs">{f.file.name}</span>
                              </span>
                            </td>
                            <td className="px-3 py-2 text-surface-muted">{(f.file.size / 1024 / 1024).toFixed(1)} MB</td>
                            <td className="px-3 py-2">
                              <button onClick={() => setStagedFiles(prev => prev.filter(x => x.fileId !== f.fileId))}
                                className="text-surface-muted hover:text-danger-600">
                                <X size={12} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="mt-4 flex gap-2 justify-end">
                <button onClick={() => setStagedFiles([])} className="btn-secondary text-xs">Reset</button>
                <button onClick={startUpload} disabled={stagedFiles.length === 0}
                  className="btn-primary text-xs gap-1 disabled:opacity-50">
                  <Sparkles size={13} /> Mulai Upload & Analisis
                </button>
              </div>
            </div>
          </div>

          {/* Config panel */}
          <div className="card">
            <div className="card-header"><span className="section-title">Opsi Upload</span></div>
            <div className="p-4 space-y-3">
              <div>
                <label className="input-label">Tipe Shipment</label>
                <select value={shipmentType} onChange={e => setShipmentType(e.target.value)} className="input text-xs">
                  <option>Import</option>
                  <option>Export</option>
                  <option>BC 2.3 (TPB)</option>
                  <option>BC 2.6.1</option>
                </select>
              </div>
              <div>
                <label className="input-label">Tanggal Shipment</label>
                <input type="date" className="input text-xs" defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
              <div>
                <label className="input-label">Catatan</label>
                <textarea className="input text-xs h-20 resize-none" placeholder="Catatan opsional untuk batch ini..." />
              </div>
              <div className="rounded-md bg-intel-50 border border-intel-100 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Sparkles size={12} className="text-intel-500" />
                  <span className="text-2xs font-semibold text-intel-500">AI Dry Run</span>
                </div>
                <p className="text-2xs text-intel-500">
                  Semua file dianalisis terlebih dahulu sebelum masuk database.
                  Tidak ada data yang berubah sampai Anda menyetujui hasil analisis.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: STAGING & ANALYZING ── */}
      {step === 2 && (
        <div className="card max-w-2xl mx-auto">
          <div className="card-header">
            <span className="section-title">Upload & Analisis AI</span>
            <span className="badge-intel badge text-2xs">
              <Loader size={10} className="animate-spin mr-1" />
              {isAnalyzing ? "AI sedang menganalisis..." : "Mengupload..."}
            </span>
          </div>
          <div className="p-4">
            {/* Overall progress */}
            <div className="mb-4 rounded-md border border-surface-border bg-surface-page p-3">
              <div className="flex justify-between text-2xs mb-1.5">
                <span className="text-surface-muted">Progress Keseluruhan</span>
                <span className="font-semibold text-[#1B4FD8]">
                  {isAnalyzing ? "Menganalisis..." : `${stagingProgress}%`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-border overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${isAnalyzing ? "bg-intel-500 animate-pulse" : "bg-[#1B4FD8]"}`}
                  style={{ width: isAnalyzing ? "100%" : `${stagingProgress}%` }} />
              </div>
              <p className="text-2xs text-surface-muted mt-1.5">
                {isAnalyzing
                  ? "AI mengidentifikasi tipe dokumen dan mencocokkan dengan shipment existing..."
                  : `Mengupload ${doneStaged} dari ${totalStaged} file`}
              </p>
            </div>

            {/* Per-file status */}
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {stagedFiles.map(f => {
                const statusCfg = {
                  pending: { label: "Antrian", bar: "bg-surface-border w-0", text: "text-surface-muted" },
                  staging: { label: "Mengupload...", bar: "bg-[#1B4FD8]", text: "text-[#1B4FD8]" },
                  staged: { label: "Selesai", bar: "bg-success-600", text: "text-success-600" },
                  error: { label: "Error", bar: "bg-danger-600", text: "text-danger-600" },
                }[f.status];
                return (
                  <div key={f.fileId} className="flex items-center gap-2 rounded px-2 py-1.5 bg-surface-page">
                    <FileText size={12} className="text-surface-muted flex-shrink-0" />
                    <span className="flex-1 text-2xs truncate">{f.file.name}</span>
                    <span className={`text-2xs font-medium min-w-[80px] text-right ${statusCfg.text}`}>{statusCfg.label}</span>
                    <div className="w-20 h-1 rounded-full bg-surface-border overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${statusCfg.bar}`}
                        style={{ width: `${f.progress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {isAnalyzing && (
              <div className="mt-3 flex items-start gap-2 rounded border border-intel-100 bg-intel-50 p-2.5">
                <Sparkles size={13} className="text-intel-500 flex-shrink-0 mt-0.5" />
                <p className="text-2xs text-intel-500">
                  AI sedang menganalisis semua dokumen. Tidak ada yang tersimpan ke database sebelum Anda menyetujui hasilnya.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 3: DRY RUN PREVIEW ── */}
      {step === 3 && previewData && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="section-title text-base">Hasil Analisis AI — {previewData.summary.totalFiles} File</h2>
              <p className="text-sm text-surface-muted">Review sebelum commit. Tidak ada yang berubah sampai Anda klik Commit.</p>
            </div>
          </div>
          <DryRunPreview
            sessionId={sessionId!}
            files={previewData.files}
            summary={previewData.summary}
            onResolveConflict={handleResolveConflict}
            onCommit={handleCommit}
            onCancel={handleCancel}
            isCommitting={isCommitting}
          />
        </div>
      )}

      {/* ── STEP 4+: Post-commit ── */}
      {step >= 4 && (
        <div className="card max-w-xl mx-auto text-center py-12">
          <div className="flex justify-center mb-4">
            <div className="h-14 w-14 rounded-full bg-success-100 flex items-center justify-center">
              <CheckCircle size={28} className="text-success-600" />
            </div>
          </div>
          <h2 className="section-title text-base mb-1">Dokumen berhasil diproses!</h2>
          <p className="text-sm text-surface-muted mb-6">
            Semua file telah masuk ke sistem dan pipeline ekstraksi berjalan secara otomatis.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => { setStagedFiles([]); setPreviewData(null); setSessionId(null); setStep(1); }}
              className="btn-secondary gap-1">
              <Upload size={13} /> Upload Lagi
            </button>
            <button onClick={() => window.location.href = '/documents'} className="btn-primary gap-1">
              Lihat Dokumen <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
