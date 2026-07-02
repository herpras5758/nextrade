import { useTranslation } from "react-i18next";
import { ChevronDown, LogOut, User } from "lucide-react";
import { useTenant } from "../../store/tenantContext";
import { useAuth } from "../../lib/AuthContext";
import { useLocation } from "react-router-dom";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard", "/upload": "Upload", "/documents": "Documents",
  "/resolutions": "Resolutions", "/shipments": "Shipments",
  "/analytics": "Analytics", "/settings": "Settings",
};

const SUPPORTED_LANGUAGES = [
  { code: "id", label: "ID" },
  { code: "en", label: "EN" },
];

export function Topbar() {
  const { i18n } = useTranslation();
  const { currentTenant, availableTenants, switchTenant } = useTenant();
  const { claims, logout } = useAuth();
  const location = useLocation();
  const pageLabel = ROUTE_LABELS["/" + location.pathname.split("/")[1]] ?? "";
  const userName = claims?.given_name ?? claims?.email?.split("@")[0] ?? "User";

  return (
    <header className="flex h-12 flex-shrink-0 items-center border-b border-[#DFE1E6] bg-white px-4 gap-3">
      <nav className="flex items-center gap-1.5 text-xs flex-1">
        <span className="text-[#97A0AF]">Ship-X</span>
        {pageLabel && <><span className="text-[#DFE1E6]">/</span><span className="font-medium text-[#1B2A4A]">{pageLabel}</span></>}
      </nav>

      {/* BU Selector */}
      {availableTenants.length > 0 && (
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-[#DFE1E6] rounded-md text-xs font-medium text-[#1B2A4A] hover:border-[#0EA5A4]">
            <span className="w-2 h-2 rounded-full bg-[#0EA5A4]" />
            {currentTenant?.name ?? "Pilih BU"}
            <ChevronDown size={12} />
          </button>
          <div className="hidden group-hover:block absolute right-0 top-full mt-1 bg-white border border-[#DFE1E6] rounded-lg shadow-lg z-50 min-w-[200px]">
            {availableTenants.map(t => (
              <button key={t.id}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-[#F4F5F7] ${currentTenant?.id === t.id ? 'text-[#0EA5A4] font-semibold' : 'text-[#1B2A4A]'}`}
                onClick={() => switchTenant(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Language */}
      <div className="flex gap-1">
        {SUPPORTED_LANGUAGES.map(l => (
          <button key={l.code}
            className={`px-2 py-1 text-[10px] rounded font-medium transition-colors ${i18n.language === l.code ? 'bg-[#0EA5A4] text-white' : 'text-[#97A0AF] hover:text-[#1B2A4A]'}`}
            onClick={() => i18n.changeLanguage(l.code)}
          >{l.label}</button>
        ))}
      </div>

      {/* User */}
      <div className="relative group">
        <button className="flex items-center gap-2 text-xs text-[#6B778C] hover:text-[#1B2A4A]">
          <div className="w-7 h-7 rounded-full bg-[#0EA5A4] flex items-center justify-center text-white text-[10px] font-bold">
            {userName.slice(0,2).toUpperCase()}
          </div>
          <span className="hidden sm:block">{userName}</span>
          <ChevronDown size={12} />
        </button>
        <div className="hidden group-hover:block absolute right-0 top-full mt-1 bg-white border border-[#DFE1E6] rounded-lg shadow-lg z-50 min-w-[160px]">
          <div className="px-3 py-2 border-b border-[#DFE1E6]">
            <div className="text-xs font-medium text-[#1B2A4A]">{userName}</div>
            <div className="text-[10px] text-[#97A0AF]">{claims?.email}</div>
          </div>
          <button onClick={logout} className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-2">
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
