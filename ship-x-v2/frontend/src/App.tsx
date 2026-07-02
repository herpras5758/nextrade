import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload, FileText, Network, Package, Settings, ChevronRight,
  CheckCircle, AlertCircle, Clock, Loader2, RefreshCw, Eye,
  TrendingUp, BarChart3, Inbox, ArrowRight, Shield, Zap,
  X, Plus, File, Activity, Info, ChevronDown, Check,
} from 'lucide-react';
import axios from 'axios';

// ── Config ────────────────────────────────────────────────────────────────────
const API = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' });
const COGNITO_POOL = import.meta.env.VITE_COGNITO_USER_POOL_ID!;
const COGNITO_CLIENT = import.meta.env.VITE_COGNITO_CLIENT_ID!;
const REGION = import.meta.env.VITE_AWS_REGION ?? 'ap-southeast-3';

API.interceptors.request.use(cfg => {
  const token = localStorage.getItem('id_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function parseJwt(token: string) {
  try { return JSON.parse(atob(token.split('.')[1])); } catch { return null; }
}

function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem('id_token'));
  const user = token ? parseJwt(token) : null;
  const tenantId = user?.['custom:tenant_ids']?.split(',')[0]?.trim();

  const login = async (email: string, password: string) => {
    const r = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
      body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: COGNITO_CLIENT, AuthParameters: { USERNAME: email, PASSWORD: password } }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message ?? 'Login failed');
    const t = data.AuthenticationResult.IdToken;
    localStorage.setItem('id_token', t);
    setToken(t);
    return t;
  };

  const logout = () => { localStorage.removeItem('id_token'); setToken(null); };
  const isExpired = token ? (parseJwt(token)?.exp ?? 0) < Date.now() / 1000 : true;

  return { token, user, tenantId, login, logout, isAuthenticated: !!token && !isExpired };
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const css = `
  :root {
    --bg: #0B0F1A;
    --surface: #131929;
    --surface-2: #1C2438;
    --surface-3: #232D44;
    --border: #2A3554;
    --border-light: #344060;
    --accent: #3D7EFF;
    --accent-dim: rgba(61,126,255,0.15);
    --accent-glow: rgba(61,126,255,0.25);
    --success: #22C55E;
    --warning: #F59E0B;
    --danger: #EF4444;
    --text: #E8EEFF;
    --text-muted: #7A8BAD;
    --text-dim: #4A5678;
    --mono: 'JetBrains Mono', 'Fira Code', monospace;
    --sans: 'Inter', system-ui, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 13px; line-height: 1.5; }
  a { color: inherit; text-decoration: none; }

  .layout { display: flex; height: 100vh; overflow: hidden; }
  .sidebar { width: 220px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
  .sidebar-logo { padding: 20px 16px 16px; border-bottom: 1px solid var(--border); }
  .sidebar-logo .wordmark { font-size: 16px; font-weight: 700; letter-spacing: -0.5px; color: var(--text); }
  .sidebar-logo .sub { font-size: 10px; color: var(--text-dim); margin-top: 2px; letter-spacing: 0.5px; text-transform: uppercase; }
  .sidebar-nav { flex: 1; padding: 8px 0; overflow-y: auto; }
  .nav-item { display: flex; align-items: center; gap: 8px; padding: 8px 16px; cursor: pointer; color: var(--text-muted); font-size: 13px; transition: all 0.12s; border-radius: 0; }
  .nav-item:hover { color: var(--text); background: var(--surface-2); }
  .nav-item.active { color: var(--accent); background: var(--accent-dim); }
  .nav-item svg { flex-shrink: 0; }
  .sidebar-user { padding: 12px 16px; border-top: 1px solid var(--border); font-size: 11px; color: var(--text-dim); }

  .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .topbar { height: 48px; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 20px; gap: 12px; background: var(--surface); flex-shrink: 0; }
  .topbar-title { font-size: 14px; font-weight: 600; color: var(--text); }
  .topbar-sub { font-size: 11px; color: var(--text-muted); }
  .content { flex: 1; overflow-y: auto; padding: 20px; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  .card-header { padding: 14px 16px 10px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
  .card-title { font-size: 13px; font-weight: 600; }
  .card-body { padding: 16px; }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
  .stat-value { font-size: 24px; font-weight: 700; color: var(--text); font-family: var(--mono); }
  .stat-label { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
  .stat-accent { border-left: 3px solid var(--accent); }
  .stat-success { border-left: 3px solid var(--success); }
  .stat-warning { border-left: 3px solid var(--warning); }
  .stat-danger { border-left: 3px solid var(--danger); }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface-2); }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 12px; vertical-align: middle; }
  tr:hover td { background: var(--surface-2); }
  tr:last-child td { border-bottom: none; }

  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
  .badge-blue { background: var(--accent-dim); color: var(--accent); }
  .badge-green { background: rgba(34,197,94,0.15); color: var(--success); }
  .badge-yellow { background: rgba(245,158,11,0.15); color: var(--warning); }
  .badge-red { background: rgba(239,68,68,0.15); color: var(--danger); }
  .badge-gray { background: var(--surface-3); color: var(--text-muted); }

  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.12s; border: 1px solid transparent; white-space: nowrap; }
  .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .btn-primary:hover { background: #5591ff; }
  .btn-ghost { background: transparent; color: var(--text-muted); border-color: var(--border); }
  .btn-ghost:hover { background: var(--surface-2); color: var(--text); }
  .btn-danger { background: transparent; color: var(--danger); border-color: rgba(239,68,68,0.3); }
  .btn-danger:hover { background: rgba(239,68,68,0.1); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .input { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 7px 10px; font-size: 12px; width: 100%; outline: none; font-family: var(--sans); }
  .input:focus { border-color: var(--accent); }
  select.input { cursor: pointer; }

  .drop-zone { border: 2px dashed var(--border); border-radius: 10px; padding: 40px; text-align: center; cursor: pointer; transition: all 0.15s; background: var(--surface); }
  .drop-zone:hover, .drop-zone.drag-over { border-color: var(--accent); background: var(--accent-dim); }
  .drop-zone .dz-icon { color: var(--text-dim); margin-bottom: 12px; }
  .drop-zone .dz-title { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
  .drop-zone .dz-sub { font-size: 12px; color: var(--text-muted); }

  .file-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 7px; background: var(--surface-2); border: 1px solid var(--border); margin-top: 8px; }
  .file-item .fi-name { flex: 1; font-size: 12px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-item .fi-size { font-size: 11px; color: var(--text-dim); font-family: var(--mono); }

  .progress-bar { height: 4px; background: var(--surface-3); border-radius: 2px; overflow: hidden; }
  .progress-bar .progress-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s; }
  .progress-bar.success .progress-fill { background: var(--success); }

  .section { margin-bottom: 24px; }
  .section-title { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }

  .conf-bar { display: flex; align-items: center; gap: 8px; }
  .conf-bar-track { flex: 1; height: 6px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
  .conf-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
  .conf-val { font-size: 11px; font-family: var(--mono); color: var(--text-muted); min-width: 36px; text-align: right; }

  .status-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .dot-blue { background: var(--accent); }
  .dot-green { background: var(--success); }
  .dot-yellow { background: var(--warning); }
  .dot-red { background: var(--danger); }
  .dot-gray { background: var(--text-dim); }
  .dot-pulse { animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

  .empty-state { text-align: center; padding: 48px 24px; color: var(--text-dim); }
  .empty-state .es-icon { margin-bottom: 12px; }
  .empty-state .es-title { font-size: 14px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; }
  .empty-state .es-sub { font-size: 12px; }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  @media (max-width: 768px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }

  .tooltip { position: relative; }
  .tooltip:hover::after { content: attr(data-tip); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: #1a2440; color: var(--text); font-size: 11px; padding: 4px 8px; border-radius: 4px; white-space: nowrap; pointer-events: none; margin-bottom: 4px; border: 1px solid var(--border); }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .fade-in { animation: fadeIn 0.2s ease; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtBytes(b: number) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusBadge(status: string) {
  const map: Record<string, [string, string]> = {
    uploaded: ['badge-gray', 'Uploaded'],
    classifying: ['badge-blue', 'Classifying'],
    classified: ['badge-blue', 'Classified'],
    extracting: ['badge-blue', 'Extracting'],
    extracted: ['badge-blue', 'Extracted'],
    normalizing: ['badge-blue', 'Normalizing'],
    normalized: ['badge-blue', 'Normalized'],
    linked: ['badge-green', 'Linked'],
    split: ['badge-gray', 'Split'],
    error: ['badge-red', 'Error'],
    archived: ['badge-gray', 'Archived'],
    candidate: ['badge-yellow', 'Candidate'],
    partial: ['badge-yellow', 'Partial'],
    matched: ['badge-green', 'Matched'],
    verified: ['badge-green', 'Verified'],
    ready_ceisa: ['badge-blue', 'Ready CEISA'],
    submitted: ['badge-blue', 'Submitted'],
    sppb: ['badge-green', 'SPPB'],
    closed: ['badge-gray', 'Closed'],
  };
  const [cls, label] = map[status] ?? ['badge-gray', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

function confColor(v: number) {
  if (v >= 0.85) return 'var(--success)';
  if (v >= 0.70) return 'var(--warning)';
  return 'var(--danger)';
}

function ConfBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="conf-bar">
      <div className="conf-bar-track">
        <div className="conf-bar-fill" style={{ width: `${pct}%`, background: confColor(value) }} />
      </div>
      <span className="conf-val">{pct}%</span>
    </div>
  );
}

function docTypeBadge(type: string) {
  const colors: Record<string, string> = {
    COMMERCIAL_INVOICE: '#3D7EFF', PACKING_LIST: '#22C55E', PURCHASE_ORDER: '#F59E0B',
    BILL_OF_LADING: '#A855F7', BC_1_1: '#EC4899', BC_2_3: '#EF4444',
    SURAT_JALAN: '#14B8A6', MULTI_DOCUMENT: '#6B7280',
  };
  const color = colors[type] ?? '#6B7280';
  const short = type.replace('COMMERCIAL_', 'CI').replace('BILL_OF_LADING', 'B/L')
    .replace('PACKING_LIST', 'PL').replace('PURCHASE_ORDER', 'PO')
    .replace('SURAT_JALAN', 'SJ').replace('MULTI_DOCUMENT', 'MULTI');
  return (
    <span style={{ background: `${color}22`, color, padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.3px' }}>
      {short}
    </span>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────
function Login({ onLogin }: { onLogin: (email: string, pw: string) => Promise<void> }) {
  const [email, setEmail] = useState('admin@ungaransari.test');
  const [password, setPassword] = useState('NexTrade2026Admin!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try { await onLogin(email, password); }
    catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{css}</style>
      <div style={{ width: 360, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 32 }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.5px' }}>Ship-X</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Enterprise Shipment Intelligence</div>
        </div>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--danger)', marginBottom: 16 }}>{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? <><Loader2 size={13} className="spin" /> Signing in...</> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ tenantId }: { tenantId: string }) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get(`/api/v1/tenants/${tenantId}/admin/summary`)
      .then(r => setSummary(r.data)).finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)' }}><Loader2 size={18} className="spin" /></div>;
  if (!summary) return null;

  const d = summary.documents;
  const r = summary.resolutions;
  const s = summary.shipments;

  return (
    <div className="fade-in">
      <div className="section">
        <div className="section-title">Overview</div>
        <div className="stat-grid">
          <div className="stat stat-accent">
            <div className="stat-value">{d.total}</div>
            <div className="stat-label">Total Documents</div>
          </div>
          <div className="stat" style={{ borderLeft: '3px solid var(--warning)' }}>
            <div className="stat-value">{d.processing}</div>
            <div className="stat-label">Processing Now</div>
          </div>
          <div className="stat stat-success">
            <div className="stat-value">{r.total ?? 0}</div>
            <div className="stat-label">Resolutions</div>
          </div>
          <div className="stat stat-accent">
            <div className="stat-value">{s.total ?? 0}</div>
            <div className="stat-label">Shipments</div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><Activity size={14} style={{ color: 'var(--accent)' }} /><span className="card-title">Documents by Status</span></div>
          <div className="card-body">
            {Object.entries(d.byStatus ?? {}).map(([status, count]: any) => (
              <div key={status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{statusBadge(status)}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><Network size={14} style={{ color: 'var(--accent)' }} /><span className="card-title">Recent Documents</span></div>
          <div style={{ overflow: 'auto' }}>
            <table>
              <tbody>
                {summary.recentDocuments?.slice(0, 8).map((doc: any) => (
                  <tr key={doc.id}>
                    <td>{docTypeBadge(doc.doc_type ?? '?')}</td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</td>
                    <td>{statusBadge(doc.status)}</td>
                    <td style={{ color: 'var(--text-dim)', fontSize: 11 }}>{new Date(doc.uploaded_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Upload Page ───────────────────────────────────────────────────────────────
type FileUploadState = {
  id: string;
  file: File;
  documentId?: string;
  status: 'pending' | 'uploading' | 'confirming' | 'processing' | 'done' | 'error' | 'duplicate';
  progress: number;
  error?: string;
  isDuplicate?: boolean;
  docType?: string;
};

function computeHash(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const buf = e.target!.result as ArrayBuffer;
        const hash = await crypto.subtle.digest('SHA-256', buf);
        resolve(Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join(''));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function UploadPage({ tenantId }: { tenantId: string }) {
  const [files, setFiles] = useState<FileUploadState[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (newFiles: File[]) => {
    const items = newFiles.map(f => ({
      id: crypto.randomUUID(), file: f,
      status: 'pending' as const, progress: 0,
    }));
    setFiles(prev => [...prev, ...items]);
    items.forEach(item => processFile(item, newFiles.find(f => f === item.file)!));
  };

  const processFile = async (item: FileUploadState, file: File) => {
    const update = (patch: Partial<FileUploadState>) =>
      setFiles(prev => prev.map(f => f.id === item.id ? { ...f, ...patch } : f));

    try {
      // 1. Get presigned URL
      update({ status: 'uploading', progress: 10 });
      const { data: { uploadUrl, documentId } } = await API.post(
        `/api/v1/tenants/${tenantId}/upload-url`,
        { fileName: file.name, contentType: file.type || 'application/pdf', fileSizeBytes: file.size }
      );

      // 2. Upload to S3 directly
      update({ progress: 30, documentId });
      await axios.put(uploadUrl, file, {
        headers: { 'Content-Type': file.type || 'application/pdf' },
        onUploadProgress: e => update({ progress: 30 + Math.round((e.loaded / (e.total ?? file.size)) * 50) }),
      });

      // 3. Compute hash and confirm
      update({ status: 'confirming', progress: 85 });
      let fileHash: string | undefined;
      try { fileHash = await computeHash(file); } catch { /* optional */ }

      const { data: confirmData } = await API.post(
        `/api/v1/tenants/${tenantId}/confirm-upload`,
        { documentId, fileHash }
      );

      if (confirmData.isDuplicate) {
        update({ status: 'duplicate', progress: 100, isDuplicate: true });
        return;
      }

      // 4. Processing is async — show processing state
      update({ status: 'processing', progress: 100 });

      // Poll for doc status
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts > 60) { clearInterval(poll); return; }
        try {
          const { data: doc } = await API.get(`/api/v1/tenants/${tenantId}/documents/${documentId}`);
          if (['linked', 'archived'].includes(doc.status)) {
            update({ status: 'done', docType: doc.doc_type });
            clearInterval(poll);
          } else if (doc.status === 'error') {
            update({ status: 'error', error: doc.error_message });
            clearInterval(poll);
          }
        } catch {}
      }, 3000);

    } catch (err: any) {
      update({ status: 'error', error: err.response?.data?.error ?? err.message });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const statusIcon = (s: FileUploadState['status']) => {
    if (s === 'pending') return <Clock size={14} style={{ color: 'var(--text-dim)' }} />;
    if (s === 'uploading' || s === 'confirming') return <Loader2 size={14} className="spin" style={{ color: 'var(--accent)' }} />;
    if (s === 'processing') return <div className="status-dot dot-blue dot-pulse" />;
    if (s === 'done') return <CheckCircle size={14} style={{ color: 'var(--success)' }} />;
    if (s === 'duplicate') return <Info size={14} style={{ color: 'var(--warning)' }} />;
    if (s === 'error') return <AlertCircle size={14} style={{ color: 'var(--danger)' }} />;
  };

  const statusLabel = (f: FileUploadState) => {
    if (f.status === 'uploading') return 'Uploading...';
    if (f.status === 'confirming') return 'Verifying...';
    if (f.status === 'processing') return 'AI Processing...';
    if (f.status === 'done') return f.docType ? `Linked as ${f.docType.replace('_', ' ')}` : 'Done';
    if (f.status === 'duplicate') return 'Duplicate — skipped';
    if (f.status === 'error') return f.error ?? 'Error';
    return 'Pending';
  };

  const clearDone = () => setFiles(prev => prev.filter(f => f.status === 'processing' || f.status === 'uploading' || f.status === 'pending'));

  return (
    <div className="fade-in">
      <div className="section">
        <div
          className={`drop-zone ${dragging ? 'drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <div className="dz-icon"><Upload size={36} /></div>
          <div className="dz-title">Drop trade documents here</div>
          <div className="dz-sub">PDF, PNG, JPG — any combination — any quantity</div>
          <div className="dz-sub" style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: 11 }}>
            AI will classify, extract, and group into shipments automatically
          </div>
          <input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }}
            onChange={e => addFiles(Array.from(e.target.files ?? []))} />
        </div>
      </div>

      {files.length > 0 && (
        <div className="section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="section-title">{files.length} file{files.length !== 1 ? 's' : ''}</div>
            <button className="btn btn-ghost" onClick={clearDone}>Clear completed</button>
          </div>

          {files.map(f => (
            <div key={f.id} className="file-item">
              <File size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <div className="fi-name">{f.file.name}</div>
              <div className="fi-size">{fmtBytes(f.file.size)}</div>
              <div style={{ width: 120 }}>
                <div className={`progress-bar ${f.status === 'done' ? 'success' : ''}`}>
                  <div className="progress-fill" style={{ width: `${f.progress}%` }} />
                </div>
                <div style={{ fontSize: 10, color: f.status === 'error' ? 'var(--danger)' : f.status === 'duplicate' ? 'var(--warning)' : 'var(--text-muted)', marginTop: 3 }}>
                  {statusLabel(f)}
                </div>
              </div>
              <div style={{ width: 18 }}>{statusIcon(f.status)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-header"><Info size={14} style={{ color: 'var(--text-dim)' }} /><span className="card-title">How it works</span></div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { icon: <Upload size={16} />, step: '01', title: 'Upload', desc: 'Drop any trade document — single file or batch' },
            { icon: <Zap size={16} />, step: '02', title: 'AI Extracts', desc: 'Claude reads, classifies, and extracts all fields automatically' },
            { icon: <Network size={16} />, step: '03', title: 'Knowledge Graph', desc: 'Documents linked via shared entities (Invoice No, BL, PO)' },
            { icon: <Package size={16} />, step: '04', title: 'Shipment Formed', desc: 'Resolution engine groups documents into shipment candidates' },
          ].map(({ icon, step, title, desc }) => (
            <div key={step} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ color: 'var(--accent)' }}>{icon}</span>
                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>{step}</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Documents Page ────────────────────────────────────────────────────────────
function DocumentsPage({ tenantId, onNavigate }: { tenantId: string; onNavigate: (page: string, id?: string) => void }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter) params.set('doc_type', typeFilter);
    API.get(`/api/v1/tenants/${tenantId}/documents?${params}&limit=100`)
      .then(r => setDocs(r.data.documents ?? []))
      .finally(() => setLoading(false));
  }, [tenantId, statusFilter, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const docTypes = [...new Set(docs.map(d => d.doc_type).filter(Boolean))];

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="input" style={{ width: 160 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          {['uploaded','classifying','extracted','normalized','linked','split','error'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" style={{ width: 180 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Doc Types</option>
          {docTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn btn-ghost" onClick={load}><RefreshCw size={12} /></button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>{docs.length} documents</span>
      </div>

      <div className="card">
        <div style={{ overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={18} className="spin" style={{ color: 'var(--text-dim)' }} /></div>
          ) : docs.length === 0 ? (
            <div className="empty-state">
              <div className="es-icon"><Inbox size={32} /></div>
              <div className="es-title">No documents yet</div>
              <div className="es-sub">Upload trade documents to get started</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Type</th><th>File Name</th><th>Status</th>
                  <th>Resolution</th><th>Confidence</th><th>Uploaded</th><th></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc: any) => (
                  <tr key={doc.id}>
                    <td>{doc.doc_type ? docTypeBadge(doc.doc_type) : <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>}</td>
                    <td>
                      <div style={{ maxWidth: 260 }}>
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</div>
                        {doc.is_split_child && <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Pages {doc.page_range_start + 1}–{doc.page_range_end + 1}</div>}
                        {doc.child_count > 0 && <div style={{ fontSize: 10, color: 'var(--accent)' }}>{doc.child_count} segments</div>}
                      </div>
                    </td>
                    <td>{statusBadge(doc.status)}</td>
                    <td>
                      {doc.resolution_id
                        ? <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => onNavigate('resolutions', doc.resolution_id)}>
                            View {statusBadge(doc.resolution_status)}
                          </button>
                        : <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ width: 120 }}>
                      {doc.doc_type_confidence
                        ? <ConfBar value={parseFloat(doc.doc_type_confidence)} />
                        : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </td>
                    <td style={{ color: 'var(--text-dim)', fontSize: 11 }}>{fmtDate(doc.uploaded_at)}</td>
                    <td>
                      <button className="btn btn-ghost" style={{ padding: '3px 8px' }} onClick={() => onNavigate('document-detail', doc.id)}>
                        <Eye size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Resolutions Page ──────────────────────────────────────────────────────────
function ResolutionsPage({ tenantId, selectedId, onNavigate }: { tenantId: string; selectedId?: string; onNavigate: (page: string, id?: string) => void }) {
  const [resolutions, setResolutions] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    API.get(`/api/v1/tenants/${tenantId}/resolutions?limit=50`)
      .then(r => setResolutions(r.data.resolutions ?? []))
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  const loadDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const { data } = await API.get(`/api/v1/tenants/${tenantId}/resolutions/${id}`);
      setSelected(data);
    } finally { setDetailLoading(false); }
  };

  const approve = async () => {
    if (!selected) return;
    setApproving(true);
    try {
      await API.patch(`/api/v1/tenants/${tenantId}/resolutions/${selected.resolution.id}/approve`);
      await loadDetail(selected.resolution.id);
    } finally { setApproving(false); }
  };

  return (
    <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, height: 'calc(100vh - 88px)', overflow: 'hidden' }}>
      {/* Left: Resolution list */}
      <div className="card" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div className="card-header">
          <Network size={14} style={{ color: 'var(--accent)' }} />
          <span className="card-title">Resolutions</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>{resolutions.length}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center' }}><Loader2 size={16} className="spin" style={{ color: 'var(--text-dim)' }} /></div>
          ) : resolutions.length === 0 ? (
            <div className="empty-state"><div className="es-icon"><Network size={24} /></div><div className="es-title">No resolutions</div><div className="es-sub">Upload documents to start</div></div>
          ) : resolutions.map((r: any) => (
            <div key={r.id}
              style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected?.resolution?.id === r.id ? 'var(--accent-dim)' : 'transparent', transition: 'background 0.1s' }}
              onClick={() => loadDetail(r.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                {statusBadge(r.status)}
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                  {Math.round((r.confidence_score ?? 0) * 100)}%
                </span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
                {r.invoice_numbers?.length > 0 ? r.invoice_numbers[0] : r.bl_numbers?.length > 0 ? r.bl_numbers[0] : `Resolution ${r.id.slice(0, 8)}`}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {r.found_doc_types?.map((t: string) => docTypeBadge(t))}
              </div>
              {r.missing_doc_types?.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 4 }}>
                  Missing: {r.missing_doc_types.join(', ')}
                </div>
              )}
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
                {r.document_count} doc{r.document_count !== 1 ? 's' : ''}
                {r.shipment_number && <span style={{ marginLeft: 6, color: 'var(--success)' }}>→ {r.shipment_number}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Detail */}
      <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {detailLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
            <Loader2 size={18} className="spin" style={{ color: 'var(--text-dim)' }} />
          </div>
        )}
        {!detailLoading && !selected && (
          <div className="empty-state" style={{ marginTop: 60 }}>
            <div className="es-icon"><Eye size={28} /></div>
            <div className="es-title">Select a resolution</div>
            <div className="es-sub">Click a resolution on the left to view details</div>
          </div>
        )}
        {!detailLoading && selected && (
          <>
            {/* Header */}
            <div className="card">
              <div className="card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      {statusBadge(selected.resolution.status)}
                      {selected.resolution.shipment_number && <span className="badge badge-green">{selected.resolution.shipment_number}</span>}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                      {selected.resolution.invoice_numbers?.[0] ?? selected.resolution.bl_numbers?.[0] ?? 'Unnamed Resolution'}
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
                      <span><strong>{selected.documents.length}</strong> documents</span>
                      <span><strong>{selected.fields.length}</strong> fields extracted</span>
                      <span>Last calculated {selected.resolution.last_calculated_at ? fmtDate(selected.resolution.last_calculated_at) : 'never'}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost" onClick={() => loadDetail(selected.resolution.id)}>
                      <RefreshCw size={12} /> Refresh
                    </button>
                    {selected.resolution.status === 'matched' && !selected.resolution.shipment_id && (
                      <button className="btn btn-primary" onClick={approve} disabled={approving}>
                        {approving ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
                        Approve → Shipment
                      </button>
                    )}
                  </div>
                </div>

                {/* Confidence breakdown */}
                {selected.sharedEntities?.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Shared Entities (why these docs are grouped)</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {selected.sharedEntities.map((e: any) => (
                        <div key={e.entity_type + e.canonical_value} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 11 }}>
                          <span style={{ color: 'var(--text-dim)' }}>{e.entity_type}: </span>
                          <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{e.display_value}</span>
                          <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>×{e.doc_count} docs</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.resolution.missing_doc_types?.length > 0 && (
                  <div style={{ marginTop: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '8px 12px' }}>
                    <span style={{ color: 'var(--warning)', fontSize: 11, fontWeight: 600 }}>Missing: </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{selected.resolution.missing_doc_types.join(' · ')}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Documents */}
            <div className="card">
              <div className="card-header"><FileText size={14} style={{ color: 'var(--text-dim)' }} /><span className="card-title">Documents</span></div>
              <table>
                <thead><tr><th>Type</th><th>File</th><th>Status</th><th>Pages</th></tr></thead>
                <tbody>
                  {selected.documents.map((doc: any) => (
                    <tr key={doc.id}>
                      <td>{doc.doc_type ? docTypeBadge(doc.doc_type) : '—'}</td>
                      <td>
                        <div style={{ fontWeight: 500, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{doc.added_reason}</div>
                      </td>
                      <td>{statusBadge(doc.status)}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                        {doc.is_split_child ? `p.${doc.page_range_start + 1}–${doc.page_range_end + 1}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Fields */}
            <div className="card">
              <div className="card-header"><BarChart3 size={14} style={{ color: 'var(--text-dim)' }} /><span className="card-title">Extracted Fields</span></div>
              <table>
                <thead><tr><th>Field</th><th>Source</th><th>Value</th><th>Confidence</th><th>Status</th></tr></thead>
                <tbody>
                  {selected.fields.map((f: any) => {
                    const val = f.corrected_value ?? f.raw_value ?? '';
                    let display = val;
                    if (f.field_key === 'items' || f.field_key === 'hs_codes') {
                      try {
                        const arr = JSON.parse(val);
                        if (Array.isArray(arr)) display = `${arr.length} items`;
                      } catch {}
                    }
                    return (
                      <tr key={f.field_key + f.doc_type}>
                        <td>
                          <div style={{ fontSize: 11, fontWeight: 500 }}>{f.display_name ?? f.field_key}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>{f.field_key}</div>
                        </td>
                        <td>{f.doc_type ? docTypeBadge(f.doc_type) : '—'}</td>
                        <td style={{ maxWidth: 200 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{display || '—'}</div>
                          {f.corrected_value && <div style={{ fontSize: 10, color: 'var(--warning)' }}>Corrected</div>}
                        </td>
                        <td style={{ width: 100 }}><ConfBar value={parseFloat(f.confidence ?? 0)} /></td>
                        <td>{statusBadge(f.status)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Settings Page ─────────────────────────────────────────────────────────────
function SettingsPage({ tenantId }: { tenantId: string }) {
  const [cfg, setCfg] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    API.get(`/api/v1/tenants/${tenantId}/admin/ai-config`).then(r => {
      setCfg(r.data); setForm(r.data);
    });
  }, [tenantId]);

  const save = async () => {
    setSaving(true);
    try {
      await API.put(`/api/v1/tenants/${tenantId}/admin/ai-config`, form);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  return (
    <div className="fade-in" style={{ maxWidth: 600 }}>
      <div className="card">
        <div className="card-header"><Settings size={14} style={{ color: 'var(--accent)' }} /><span className="card-title">AI Engine Configuration</span></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>AI Provider</label>
            <select className="input" value={form.ai_provider ?? 'anthropic'} onChange={e => setForm({ ...form, ai_provider: e.target.value })}>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          {(form.ai_provider === 'anthropic' || !form.ai_provider) && (
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>
                Anthropic API Key {cfg?.has_anthropic_key && <span className="badge badge-green" style={{ marginLeft: 6 }}>Configured</span>}
              </label>
              <input className="input" type="password" placeholder={cfg?.has_anthropic_key ? '••••••••••••' : 'sk-ant-...'} onChange={e => setForm({ ...form, anthropic_api_key: e.target.value })} />
            </div>
          )}
          {form.ai_provider === 'openai' && (
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>
                OpenAI API Key {cfg?.has_openai_key && <span className="badge badge-green" style={{ marginLeft: 6 }}>Configured</span>}
              </label>
              <input className="input" type="password" placeholder={cfg?.has_openai_key ? '••••••••••••' : 'sk-...'} onChange={e => setForm({ ...form, openai_api_key: e.target.value })} />
            </div>
          )}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Extraction Model</label>
            <input className="input" value={form.extraction_model_id ?? 'claude-sonnet-4-6'} onChange={e => setForm({ ...form, extraction_model_id: e.target.value })} />
          </div>
          <div className="grid-2">
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Auto-approve threshold</label>
              <input className="input" type="number" step="0.05" min="0" max="1" value={form.threshold_auto_approved ?? 0.85} onChange={e => setForm({ ...form, threshold_auto_approved: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>Review threshold</label>
              <input className="input" type="number" step="0.05" min="0" max="1" value={form.threshold_review_required ?? 0.70} onChange={e => setForm({ ...form, threshold_review_required: parseFloat(e.target.value) })} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>CEISA Mode</label>
            <select className="input" value={form.ceisa_mode ?? 'mock'} onChange={e => setForm({ ...form, ceisa_mode: e.target.value })}>
              <option value="mock">Mock (simulate responses)</option>
              <option value="live">Live (CEISA 4.0)</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving} style={{ alignSelf: 'flex-start' }}>
            {saving ? <><Loader2 size={12} className="spin" /> Saving...</> : saved ? <><Check size={12} /> Saved</> : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── App Shell ─────────────────────────────────────────────────────────────────
export default function App() {
  const auth = useAuth();
  const [page, setPage] = useState('dashboard');
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const navigate = (p: string, id?: string) => { setPage(p); setSelectedId(id); };

  if (!auth.isAuthenticated) {
    return <Login onLogin={auth.login} />;
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <TrendingUp size={15} /> },
    { id: 'upload', label: 'Upload', icon: <Upload size={15} /> },
    { id: 'documents', label: 'Documents', icon: <FileText size={15} /> },
    { id: 'resolutions', label: 'Resolutions', icon: <Network size={15} /> },
    { id: 'shipments', label: 'Shipments', icon: <Package size={15} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={15} /> },
  ];

  const pageTitle: Record<string, string> = {
    dashboard: 'Dashboard', upload: 'Upload Documents', documents: 'Document Registry',
    resolutions: 'Shipment Resolutions', shipments: 'Verified Shipments', settings: 'Settings',
  };

  return (
    <>
      <style>{css}</style>
      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="wordmark">Ship-X</div>
            <div className="sub">Shipment Intelligence</div>
          </div>
          <nav className="sidebar-nav">
            {navItems.map(item => (
              <div key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>
                {item.icon}{item.label}
              </div>
            ))}
          </nav>
          <div className="sidebar-user">
            <div style={{ fontWeight: 500, color: 'var(--text-muted)', marginBottom: 2 }}>{auth.user?.given_name}</div>
            <div>{auth.user?.email}</div>
            <button onClick={auth.logout} style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: 0 }}>Sign out</button>
          </div>
        </aside>
        <div className="main">
          <div className="topbar">
            <div className="topbar-title">{pageTitle[page] ?? page}</div>
          </div>
          <div className="content">
            {page === 'dashboard' && <Dashboard tenantId={auth.tenantId!} />}
            {page === 'upload' && <UploadPage tenantId={auth.tenantId!} />}
            {page === 'documents' && <DocumentsPage tenantId={auth.tenantId!} onNavigate={navigate} />}
            {page === 'resolutions' && <ResolutionsPage tenantId={auth.tenantId!} selectedId={selectedId} onNavigate={navigate} />}
            {page === 'settings' && <SettingsPage tenantId={auth.tenantId!} />}
          </div>
        </div>
      </div>
    </>
  );
}
