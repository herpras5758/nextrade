import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  LayoutDashboard, FileScan, ClipboardCheck, Network,
  ShieldCheck, Plug, Boxes, BarChart3, ListChecks,
  Archive, FileCheck2, Mail, ScrollText, Settings,
  ChevronRight, ChevronLeft, Upload,
} from "lucide-react";
import clsx from "clsx";

const NAV_GROUPS = [
  {
    key: "operations",
    items: [
      { key: "dashboard", to: "/", icon: LayoutDashboard },
      { key: "upload", to: "/upload", icon: Upload },
      { key: "documents", to: "/documents", icon: FileScan },
      { key: "bc23", to: "/bc23", icon: ClipboardCheck },
      { key: "reviewQueue", to: "/review-queue", icon: ListChecks },
    ],
  },
  {
    key: "intelligence",
    items: [
      { key: "tradeIntelligence", to: "/trade-intelligence", icon: Network },
      { key: "compliance", to: "/compliance", icon: ShieldCheck },
      { key: "evidenceRegistry", to: "/evidence-registry", icon: Archive },
    ],
  },
  {
    key: "enterprise",
    items: [
      { key: "ceisaMapping", to: "/ceisa-mapping", icon: FileCheck2 },
      { key: "erp", to: "/erp", icon: Plug },
      { key: "itInventory", to: "/it-inventory", icon: Boxes },
      { key: "emailIntake", to: "/email-intake", icon: Mail },
      { key: "auditTrail", to: "/evidence-timeline", icon: ScrollText },
      { key: "analytics", to: "/analytics", icon: BarChart3 },
      { key: "settings", to: "/settings", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <aside className={clsx(
      "relative flex flex-col bg-navy-900 transition-all duration-200 flex-shrink-0",
      collapsed ? "w-14" : "w-56"
    )}>
      {/* Logo */}
      <div className={clsx(
        "flex h-12 items-center border-b border-navy-800 flex-shrink-0",
        collapsed ? "justify-center px-0" : "gap-2.5 px-4"
      )}>
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-intel-500 font-mono text-xs font-bold text-navy-950">
          NT
        </div>
        {!collapsed && (
          <div>
            <div className="text-xs font-semibold text-white leading-tight">NexTrade</div>
            <div className="text-2xs text-navy-600 leading-tight">Trade Intelligence</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="mb-1">
            {!collapsed && (
              <div className="px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-widest text-navy-600">
                {t(`nav.${group.key}`)}
              </div>
            )}
            {collapsed && <div className="my-1 mx-2 h-px bg-navy-800" />}
            <ul className="space-y-px px-1.5">
              {group.items.map(({ key, to, icon: Icon, badge = undefined }: { key: string; to: string; icon: any; badge?: number }) => {
                const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
                return (
                  <li key={key}>
                    <NavLink
                      to={to}
                      end={to === "/"}
                      title={collapsed ? t(`nav.${key}`) : undefined}
                      className={clsx(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-all",
                        isActive
                          ? "bg-white/10 text-white font-medium"
                          : "text-navy-500 hover:bg-white/5 hover:text-white",
                        collapsed && "justify-center"
                      )}
                    >
                      <Icon size={15} strokeWidth={isActive ? 2 : 1.75} className="flex-shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate">{t(`nav.${key}`)}</span>
                          {badge !== undefined && badge > 0 && (
                            <span className="rounded-full bg-intel-500 px-1.5 py-0.5 font-mono text-2xs leading-none text-navy-950">
                              {badge}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="border-t border-navy-800 px-3 py-2.5">
          <p className="text-2xs leading-relaxed text-navy-700">
            Documents → Knowledge → Intelligence → Automation
          </p>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute -right-3 top-16 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-surface-border bg-white text-surface-muted shadow-card hover:text-intel-500 transition-colors"
        title={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  );
}
