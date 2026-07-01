import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  LayoutDashboard, FileScan, ClipboardCheck, Network,
  ShieldCheck, Plug, Boxes, BarChart3, ListChecks,
  Archive, FileCheck2, Mail, ScrollText, Settings,
  ChevronRight, ChevronLeft, Upload, Zap,
} from "lucide-react";
import clsx from "clsx";

const NAV_GROUPS = [
  {
    key: "operations",
    items: [
      { key: "dashboard",   to: "/",             icon: LayoutDashboard },
      { key: "upload",      to: "/upload",        icon: Upload          },
      { key: "documents",   to: "/documents",     icon: FileScan        },
      { key: "bc23",        to: "/bc23",          icon: ClipboardCheck  },
      { key: "reviewQueue", to: "/review-queue",  icon: ListChecks      },
    ],
  },
  {
    key: "intelligence",
    items: [
      { key: "tradeIntelligence", to: "/trade-intelligence", icon: Network    },
      { key: "compliance",        to: "/compliance",          icon: ShieldCheck },
      { key: "evidenceRegistry",  to: "/evidence-registry",  icon: Archive    },
    ],
  },
  {
    key: "enterprise",
    items: [
      { key: "ceisaMapping", to: "/ceisa-mapping",    icon: FileCheck2 },
      { key: "erp",          to: "/erp",              icon: Plug       },
      { key: "itInventory",  to: "/it-inventory",     icon: Boxes      },
      { key: "emailIntake",  to: "/email-intake",     icon: Mail       },
      { key: "auditTrail",   to: "/evidence-timeline",icon: ScrollText },
      { key: "analytics",    to: "/analytics",        icon: BarChart3  },
      { key: "settings",     to: "/settings",         icon: Settings   },
    ],
  },
];

// Opsi C — Charcoal Salesforce/SAP style
const SIDEBAR_BG     = "#1C1C1E";
const SIDEBAR_BORDER = "#2C2C2E";
const GROUP_LABEL    = "#636366";
const ITEM_DEFAULT   = "#AEAEB2";
const ITEM_HOVER_BG  = "#2C2C2E";
const ITEM_ACTIVE_BG = "#0EA5A4";   // teal solid
const ITEM_ACTIVE_FG = "#FFFFFF";
const LOGO_BG        = "#0EA5A4";
const FOOTER_TEXT    = "#48484A";

export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <aside
      style={{ background: SIDEBAR_BG }}
      className={clsx(
        "relative flex flex-col flex-shrink-0 transition-all duration-200",
        collapsed ? "w-14" : "w-56"
      )}
    >
      {/* Logo */}
      <div
        style={{ borderBottomColor: SIDEBAR_BORDER }}
        className={clsx(
          "flex h-12 items-center border-b flex-shrink-0",
          collapsed ? "justify-center px-0" : "gap-2.5 px-4"
        )}
      >
        <div
          style={{ background: LOGO_BG }}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold text-white"
        >
          NT
        </div>
        {!collapsed && (
          <div>
            <div className="text-xs font-semibold text-white leading-tight">NexTrade</div>
            <div className="text-[10px] leading-tight" style={{ color: GROUP_LABEL }}>
              Trade Intelligence
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="mb-1">
            {!collapsed ? (
              <div
                className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: GROUP_LABEL }}
              >
                {t(`nav.${group.key}`)}
              </div>
            ) : (
              <div className="my-1 mx-2 h-px" style={{ background: SIDEBAR_BORDER }} />
            )}
            <ul className="space-y-px px-1.5">
              {group.items.map(({ key, to, icon: Icon, badge = undefined }: {
                key: string; to: string; icon: any; badge?: number
              }) => {
                const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
                return (
                  <li key={key}>
                    <NavLink
                      to={to}
                      end={to === "/"}
                      title={collapsed ? t(`nav.${key}`) : undefined}
                      style={isActive
                        ? { background: ITEM_ACTIVE_BG, color: ITEM_ACTIVE_FG }
                        : { color: ITEM_DEFAULT }
                      }
                      className={clsx(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-all group",
                        collapsed && "justify-center",
                        !isActive && "hover:bg-[#2C2C2E] hover:text-white"
                      )}
                    >
                      <Icon
                        size={15}
                        strokeWidth={isActive ? 2.25 : 1.75}
                        className="flex-shrink-0"
                      />
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate">{t(`nav.${key}`)}</span>
                          {badge !== undefined && badge > 0 && (
                            <span className="rounded-full bg-[#0EA5A4] px-1.5 py-0.5 font-mono text-[9px] leading-none text-white font-bold">
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

      {/* AI branding footer */}
      {!collapsed && (
        <div
          style={{ borderTopColor: SIDEBAR_BORDER }}
          className="border-t px-3 py-3"
        >
          <div className="flex items-center gap-1.5">
            <Zap size={11} style={{ color: ITEM_ACTIVE_BG }} />
            <p className="text-[10px] leading-relaxed" style={{ color: FOOTER_TEXT }}>
              Documents → Knowledge → Intelligence → Automation
            </p>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute -right-3 top-16 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[#DFE1E6] bg-white text-[#6B778C] shadow-sm hover:text-[#0EA5A4] transition-colors"
        title={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  );
}
