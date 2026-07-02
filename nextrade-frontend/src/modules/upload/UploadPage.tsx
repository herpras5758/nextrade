import { useState, useRef, useCallback } from 'react';
import { Upload, File, CheckCircle, AlertCircle, Loader2, Info, X, Zap, Network, Package } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { useTenant } from '../../store/tenantContext';
import axios from 'axios';

type FileStatus = 'pending' | 'uploading' | 'confirming' | 'processing' | 'done' | 'error' | 'duplicate';

interface FileItem {
  id: string;
  file: File;
  documentId?: string;
  status: FileStatus;
  progress: number;
  error?: string;
  docType?: string;
  isDuplicate?: boolean;
}

function fmtBytes(b: number) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

async function computeHash(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function UploadPage() {
  const { currentTenant } = useTenant();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = useCallback((id: string, patch: Partial<FileItem>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const processFile = useCallback(async (item: FileItem, file: File) => {
    if (!currentTenant) return;
    try {
      // 1. Get presigned URL
      update(item.id, { status: 'uploading', progress: 10 });
      const { data } = await apiClient.post(`/tenants/${currentTenant.id}/upload-url`, {
        fileName: file.name,
        contentType: file.type || 'application/pdf',
        fileSizeBytes: file.size,
      });

      // 2. PUT to S3
      update(item.id, { progress: 25, documentId: data.documentId });
      await axios.put(data.uploadUrl, file, {
        headers: { 'Content-Type': file.type || 'application/pdf' },
        onUploadProgress: e => update(item.id, {
          progress: 25 + Math.round((e.loaded / (e.total ?? file.size)) * 55),
        }),
      });

      // 3. Compute hash + confirm
      update(item.id, { status: 'confirming', progress: 85 });
      let fileHash: string | undefined;
      try { fileHash = await computeHash(file); } catch {}

      const { data: confirm } = await apiClient.post(`/tenants/${currentTenant.id}/confirm-upload`, {
        documentId: data.documentId, fileHash,
      });

      if (confirm.isDuplicate) {
        update(item.id, { status: 'duplicate', progress: 100 });
        return;
      }

      // 4. Poll for completion
      update(item.id, { status: 'processing', progress: 100 });
      let attempts = 0;
      const poll = setInterval(async () => {
        if (++attempts > 40) { clearInterval(poll); return; }
        try {
          const { data: doc } = await apiClient.get(`/tenants/${currentTenant.id}/documents/${data.documentId}`);
          if (['linked', 'archived'].includes(doc.status)) {
            update(item.id, { status: 'done', docType: doc.doc_type });
            clearInterval(poll);
          } else if (doc.status === 'error') {
            update(item.id, { status: 'error', error: doc.error_message });
            clearInterval(poll);
          }
        } catch {}
      }, 4000);

    } catch (err: any) {
      update(item.id, { status: 'error', error: err.response?.data?.error ?? err.message });
    }
  }, [currentTenant, update]);

  const addFiles = useCallback((newFiles: File[]) => {
    const items: FileItem[] = newFiles.map(f => ({
      id: crypto.randomUUID(), file: f, status: 'pending', progress: 0,
    }));
    setFiles(prev => [...prev, ...items]);
    items.forEach(item => processFile(item, newFiles.find(f => f === item.file)!));
  }, [processFile]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const statusBadge = (f: FileItem) => {
    const map: Record<FileStatus, [string, string]> = {
      pending:     ['badge badge-gray', 'Menunggu'],
      uploading:   ['badge badge-blue', 'Mengunggah'],
      confirming:  ['badge badge-blue', 'Memverifikasi'],
      processing:  ['badge badge-yellow', 'Diproses AI'],
      done:        ['badge badge-green', f.docType?.replace(/_/g, ' ') ?? 'Selesai'],
      error:       ['badge badge-red', 'Error'],
      duplicate:   ['badge badge-gray', 'Duplikat'],
    };
    const [cls, label] = map[f.status];
    return <span className={cls}>{label}</span>;
  };

  const statusIcon = (status: FileStatus) => {
    if (status === 'uploading' || status === 'confirming')
      return <Loader2 size={14} className="animate-spin text-[#0EA5A4]" />;
    if (status === 'processing')
      return <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />;
    if (status === 'done')
      return <CheckCircle size={14} className="text-green-500" />;
    if (status === 'error')
      return <AlertCircle size={14} className="text-red-400" />;
    if (status === 'duplicate')
      return <Info size={14} className="text-yellow-400" />;
    return null;
  };

  const done = files.filter(f => ['done', 'error', 'duplicate'].includes(f.status)).length;
  const processing = files.filter(f => ['uploading', 'confirming', 'processing'].includes(f.status)).length;

  if (!currentTenant) {
    return (
      <div className="page-container">
        <div className="card flex items-center gap-3 p-6 text-[#6B778C] text-sm">
          <Info size={16} /> Pilih Business Unit terlebih dahulu
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-5">
        <h1 className="page-title">Upload Dokumen</h1>
        <p className="page-subtitle">
          Upload satu atau banyak file sekaligus — AI akan mengklasifikasi, mengekstrak, dan mengelompokkan ke shipment secara otomatis
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all mb-6 ${
          dragging ? 'border-[#0EA5A4] bg-[#0EA5A4]/5' : 'border-[#DFE1E6] hover:border-[#0EA5A4] hover:bg-gray-50'
        }`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={36} className="mx-auto mb-3 text-[#6B778C]" />
        <p className="text-base font-semibold text-[#1B2A4A] mb-1">Drop file di sini atau klik untuk pilih</p>
        <p className="text-sm text-[#6B778C] mb-1">PDF, PNG, JPG — berapa saja file sekaligus</p>
        <p className="text-xs text-[#97A0AF]">
          AI akan mendeteksi tipe dokumen otomatis: Invoice, Packing List, B/L, PO, BC 1.1, Surat Jalan
        </p>
        <input
          ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={e => addFiles(Array.from(e.target.files ?? []))}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="card mb-6">
          <div className="flex items-center justify-between p-4 border-b border-[#DFE1E6]">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-[#1B2A4A] text-sm">{files.length} file</span>
              {processing > 0 && <span className="badge badge-yellow">{processing} diproses</span>}
              {done > 0 && <span className="badge badge-green">{done} selesai</span>}
            </div>
            <button
              className="text-xs text-[#6B778C] hover:text-[#1B2A4A] flex items-center gap-1"
              onClick={() => setFiles(prev => prev.filter(f => ['uploading','confirming','processing','pending'].includes(f.status)))}
            >
              <X size={12} /> Hapus selesai
            </button>
          </div>
          <div className="divide-y divide-[#DFE1E6]">
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-3 p-3">
                <File size={16} className="text-[#6B778C] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-[#1B2A4A] truncate">{f.file.name}</span>
                    <span className="text-xs text-[#97A0AF] flex-shrink-0">{fmtBytes(f.file.size)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-[#F4F5F7] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          f.status === 'done' ? 'bg-green-500' :
                          f.status === 'error' ? 'bg-red-400' :
                          f.status === 'duplicate' ? 'bg-gray-400' : 'bg-[#0EA5A4]'
                        }`}
                        style={{ width: `${f.progress}%` }}
                      />
                    </div>
                    {statusBadge(f)}
                  </div>
                  {f.error && <p className="text-xs text-red-400 mt-1">{f.error}</p>}
                </div>
                <div className="flex-shrink-0">{statusIcon(f.status)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-[#1B2A4A] mb-4">Cara kerja Ship-X</h3>
        <div className="grid grid-cols-4 gap-4">
          {[
            { icon: <Upload size={18} />, step: '01', title: 'Upload', desc: 'Drop file apa saja — satu atau banyak' },
            { icon: <Zap size={18} />, step: '02', title: 'AI Ekstrak', desc: 'Claude mengklasifikasi & mengekstrak semua field otomatis' },
            { icon: <Network size={18} />, step: '03', title: 'Knowledge Graph', desc: 'Dokumen dihubungkan via entitas bersama (Invoice No, B/L, PO)' },
            { icon: <Package size={18} />, step: '04', title: 'Resolusi Shipment', desc: 'Engine mengelompokkan dokumen ke shipment kandidat' },
          ].map(({ icon, step, title, desc }) => (
            <div key={step} className="bg-[#F4F5F7] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[#0EA5A4]">{icon}</span>
                <span className="text-xs font-mono text-[#97A0AF]">{step}</span>
              </div>
              <p className="text-sm font-semibold text-[#1B2A4A] mb-1">{title}</p>
              <p className="text-xs text-[#6B778C]">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
