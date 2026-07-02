import { useTranslation } from "react-i18next";
import { Search, Bell, ChevronDown, Settings, LogOut, User, HelpCircle } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLocation, Link } from "react-router-dom";
import { SUPPORTED_LANGUAGES } from "../../i18n";
import { useTenant } from "../../store/tenantContext";
import { useAuth } from "../../lib/AuthContext";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/upload": "Upload End-to-End",
  "/documents": "Pemrosesan Dokumen",
  "/bc23": "Alur Kerja BC 2.3",
  "/review-queue": "Antrian Tinjauan",
  "/trade-intelligence": "Intelijen Perdagangan",
  "/compliance": "Intelijen Kepatuhan",
  "/evidence-registry": "Registri Bukti",
  "/ceisa-mapping": "Pemetaan CEISA",
  "/erp": "Integrasi ERP",
  "/it-inventory": "IT Inventory BC",
  "/email-intake": "Intake Email",
  "/audit-trail": "Jejak Audit",
  "/analytics": "Analitik & Laporan",
  "/settings": "Pengaturan",
  "/idp-studio": "IDP Studio",
};

const LANGUAGE_LABELS: Record<string, string> = { id: "ID", en: "EN" };

export function Topbar() {
  const { t, i18n } = useTranslation();
  const { currentTenant, availableTenants, switchTenant } = useTenant();
  const { claims, logout } = useAuth();
  const location = useLocation();

  const pathSegments = location.pathname.split("/").filter(Boolean);
  const currentRoute = "/" + (pathSegments[0] ?? "");
  const pageLabel = ROUTE_LABELS[currentRoute] ?? pathSegments[0];
  const userName = claims?.given_name ?? claims?.email?.split("@")[0] ?? "User";
  const userInitials = userName.slice(0, 2).toUpperCase();
  const userGroup = claims?.["cognito:groups"]?.[0] ?? "operator";

  return (
    <header className="flex h-12 flex-shrink-0 items-center border-b border-surface-border bg-white px-4 gap-3">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm flex-1 min-w-0">
        <Link to="/" className="text-surface-muted hover:text-surface-text transition-colors text-xs">
          NexTrade
        </Link>
        {pageLabel && pageLabel !== "Dashboard" && (
          <>
            <span className="text-surface-border">/</span>
            <span className="font-medium text-surface-text text-xs truncate">{pageLabel}</span>
          </>
        )}
        {pathSegments.length > 1 && (
          <>
            <span className="text-surface-border">/</span>
            <span className="text-xs text-surface-muted truncate max-w-[120px]">
              {pathSegments[pathSegments.length - 1]?.slice(0, 8)}...
            </span>
          </>
        )}
      </nav>

      {/* Search */}
      <div className="flex items-center gap-2 rounded-md border border-surface-border bg-surface-page px-2.5 py-1.5 w-56 hover:border-intel-500 transition-colors">
        <Search size={13} className="text-surface-muted flex-shrink-0" />
        <input
          type="text"
          placeholder="Cari..."
          className="w-full bg-transparent text-xs outline-none placeholder:text-surface-muted"
        />
        <kbd className="text-2xs text-surface-muted font-mono hidden sm:block">⌘K</kbd>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-1">
        {/* Language */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="rounded px-2 py-1 text-xs font-semibold text-surface-muted hover:bg-surface-page hover:text-surface-text transition-colors">
              {LANGUAGE_LABELS[i18n.language] ?? i18n.language.toUpperCase()}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="z-50 min-w-[120px] rounded-md border border-surface-border bg-white p-1 shadow-card" sideOffset={6}>
              {SUPPORTED_LANGUAGES.map((lng) => (
                <DropdownMenu.Item key={lng} onSelect={() => i18n.changeLanguage(lng)}
                  className="cursor-pointer rounded px-3 py-1.5 text-xs text-surface-text outline-none hover:bg-surface-page">
                  {lng === "id" ? "🇮🇩 Bahasa Indonesia" : "🇬🇧 English"}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Help */}
        <button className="rounded p-1.5 text-surface-muted hover:bg-surface-page hover:text-surface-text transition-colors">
          <HelpCircle size={16} />
        </button>

        {/* Notifications */}
        <button className="relative rounded p-1.5 text-surface-muted hover:bg-surface-page hover:text-surface-text transition-colors">
          <Bell size={16} />
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-intel-500" />
        </button>

        {/* Tenant switcher */}
        {availableTenants.length >= 1 && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="flex items-center gap-1.5 rounded-md border border-surface-border bg-surface-page px-2.5 py-1.5 text-xs font-medium text-surface-text hover:bg-white hover:border-intel-500 transition-colors ml-1">
                <div className="h-5 w-5 rounded bg-navy-800 flex items-center justify-center text-2xs font-bold text-white flex-shrink-0">
                  {currentTenant?.code?.slice(0, 2) ?? "NT"}
                </div>
                <span className="hidden md:block max-w-[100px] truncate">{currentTenant?.name ?? "Pilih BU"}</span>
                <ChevronDown size={12} className="text-surface-muted flex-shrink-0" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="z-50 min-w-[220px] rounded-md border border-surface-border bg-white p-1 shadow-card" sideOffset={6}>
                <div className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-surface-muted">Business Unit</div>
                {availableTenants.map((tenant) => (
                  <DropdownMenu.Item key={tenant.id} onSelect={() => switchTenant(tenant.id)}
                    className="cursor-pointer flex items-center gap-2 rounded px-3 py-2 text-sm text-surface-text outline-none hover:bg-surface-page">
                    <div className="h-6 w-6 rounded bg-navy-800 flex items-center justify-center text-2xs font-bold text-white">
                      {tenant.code?.slice(0, 2)}
                    </div>
                    <div>
                      <div className="text-xs font-medium">{tenant.name}</div>
                      <div className="text-2xs text-surface-muted">{tenant.code}</div>
                    </div>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}

        {/* User menu */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-page transition-colors ml-1">
              <div className="h-7 w-7 rounded-full bg-navy-800 flex items-center justify-center text-xs font-semibold text-white">
                {userInitials}
              </div>
              <div className="hidden md:block text-left">
                <div className="text-xs font-medium text-surface-text leading-none">{userName}</div>
                <div className="text-2xs text-surface-muted leading-none mt-0.5 capitalize">{userGroup}</div>
              </div>
              <ChevronDown size={12} className="text-surface-muted hidden md:block" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="z-50 min-w-[180px] rounded-md border border-surface-border bg-white p-1 shadow-card" sideOffset={6} align="end">
              <div className="px-3 py-2 border-b border-surface-border mb-1">
                <div className="text-xs font-medium text-surface-text">{claims?.email}</div>
                <div className="text-2xs text-surface-muted capitalize">{userGroup}</div>
              </div>
              <DropdownMenu.Item className="cursor-pointer flex items-center gap-2 rounded px-3 py-1.5 text-xs text-surface-text outline-none hover:bg-surface-page">
                <User size={13} /> Profil saya
              </DropdownMenu.Item>
              <DropdownMenu.Item className="cursor-pointer flex items-center gap-2 rounded px-3 py-1.5 text-xs text-surface-text outline-none hover:bg-surface-page">
                <Settings size={13} /> Pengaturan
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-surface-border" />
              <DropdownMenu.Item onSelect={logout}
                className="cursor-pointer flex items-center gap-2 rounded px-3 py-1.5 text-xs text-danger-600 outline-none hover:bg-danger-100">
                <LogOut size={13} /> Keluar
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
