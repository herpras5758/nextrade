import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@ungaransari.test");
  const [password, setPassword] = useState("NexTrade2026Admin!");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newPw, setNewPw] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const { requiresNewPassword } = await login(email, password);
      if (requiresNewPassword) { setNewPw(true); setLoading(false); return; }
      navigate("/");
    } catch (err: any) {
      setError(err.message ?? "Login gagal");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#F4F5F7] flex items-center justify-center">
      <div className="w-96 bg-white rounded-xl border border-[#DFE1E6] p-8 shadow-sm">
        <div className="mb-8">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#0EA5A4] flex items-center justify-center text-white font-bold text-sm">SX</div>
            <span className="text-lg font-bold text-[#1B2A4A]">Ship-X</span>
          </div>
          <p className="text-xs text-[#97A0AF]">Shipment Intelligence Platform</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#6B778C] uppercase tracking-wider mb-1.5">Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#6B778C] uppercase tracking-wider mb-1.5">Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {newPw && (
            <div>
              <label className="block text-xs font-semibold text-[#6B778C] uppercase tracking-wider mb-1.5">Password Baru</label>
              <input className="input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
            </div>
          )}
          {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
          <button className="btn btn-primary w-full justify-center" disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : "Masuk"}
          </button>
        </form>
      </div>
    </div>
  );
}
