import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../lib/AuthContext";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, completeNewPassword, claims, isLoading } = useAuth();

  // Already authenticated — go to dashboard
  useEffect(() => {
    if (!isLoading && claims) navigate("/", { replace: true });
  }, [isLoading, claims, navigate]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [stage, setStage] = useState<"login" | "new_password">("login");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.requiresNewPassword) {
        setStage("new_password");
      } else {
        navigate("/");
      }
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await completeNewPassword(newPassword);
      navigate("/");
    } catch (err: any) {
      setError(err.message ?? "Failed to set new password");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-navy-950">
      <div className="w-full max-w-sm rounded border border-navy-800 bg-navy-900 p-8 shadow-card">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-intel-500 font-mono text-sm font-bold text-navy-950">
            NT
          </div>
          <span className="text-base font-semibold text-white">NexTrade</span>
        </div>

        {stage === "login" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <h1 className="text-lg font-semibold text-white">{t("auth.login", "Sign In")}</h1>
            <div>
              <label className="mb-1 block text-2xs font-medium text-navy-600">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-navy-700 bg-navy-800 px-3 py-2 text-sm text-white outline-none focus-visible:border-intel-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-2xs font-medium text-navy-600">
                {t("auth.password", "Password")}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-navy-700 bg-navy-800 px-3 py-2 text-sm text-white outline-none focus-visible:border-intel-500"
              />
            </div>
            {error && <p className="text-2xs text-danger-600">{error}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded bg-intel-500 py-2 text-sm font-medium text-navy-950 hover:bg-intel-400 disabled:opacity-50"
            >
              {isSubmitting ? t("common.loading") : t("auth.login", "Sign In")}
            </button>
          </form>
        ) : (
          <form onSubmit={handleNewPassword} className="space-y-4">
            <h1 className="text-lg font-semibold text-white">
              {t("auth.setNewPassword", "Buat Password Baru")}
            </h1>
            <p className="text-2xs text-navy-600">
              {t("auth.firstLoginNote", "Ini login pertama Anda - buat kata sandi permanen.")}
            </p>
            <div>
              <label className="mb-1 block text-2xs font-medium text-navy-600">
                {t("auth.newPassword", "Password Baru")}
              </label>
              <input
                type="password"
                required
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded border border-navy-700 bg-navy-800 px-3 py-2 text-sm text-white outline-none focus-visible:border-intel-500"
              />
            </div>
            {error && <p className="text-2xs text-danger-600">{error}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded bg-intel-500 py-2 text-sm font-medium text-navy-950 hover:bg-intel-400 disabled:opacity-50"
            >
              {isSubmitting ? t("common.loading") : t("auth.setNewPassword", "Buat Password Baru")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
