import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  LayoutDashboard, Upload, FileText, Network, Package,
  Settings, ChevronLeft, ChevronRight, BarChart3,
} from "lucide-react";
import clsx from "clsx";

const NAV_GROUPS = [
  {
    key: "operations",
    items: [
      { key: "dashboard",    to: "/",            icon: LayoutDashboard },
      { key: "upload",       to: "/upload",       icon: Upload          },
      { key: "documents",    to: "/documents",    icon: FileText        },
      { key: "resolutions",  to: "/resolutions",  icon: Network         },
      { key: "shipments",    to: "/shipments",    icon: Package         },
    ],
  },
  {
    key: "system",
    items: [
      { key: "analytics",    to: "/analytics",    icon: BarChart3       },
      { key: "settings",     to: "/settings",     icon: Settings        },
    ],
  },
];

const SIDEBAR_BG     = "#1C1C1E";
const SIDEBAR_BORDER = "#2C2C2E";
const GROUP_LABEL    = "#636366";
const ITEM_DEFAULT   = "#AEAEB2";
const ITEM_HOVER_BG  = "#2C2C2E";
const ITEM_ACTIVE_BG = "#0EA5A4";
const ITEM_ACTIVE_FG = "#FFFFFF";
const LOGO_BG        = "#0EA5A4";

const NAV_LABELS: Record<string, string> = {
  dashboard: "Dashboard", upload: "Upload", documents: "Documents",
  resolutions: "Resolutions", shipments: "Shipments",
  analytics: "Analytics", settings: "Settings",
  operations: "Operations", system: "System",
};

export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      style={{ background: SIDEBAR_BG }}
      className={clsx("relative flex flex-col flex-shrink-0 transition-all duration-200", collapsed ? "w-14" : "w-56")}
    >
      {/* Logo */}
      <div style={{ borderBottomColor: SIDEBAR_BORDER }} className={clsx("flex h-12 items-center border-b flex-shrink-0", collapsed ? "justify-center" : "gap-2.5 px-4")}>
        <div style={{ background: LOGO_BG }} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold text-white">
          SX
        </div>
        {!collapsed && (
          <div>
            <div className="text-sm font-bold text-white tracking-tight">Ship-X</div>
            <div className="text-[10px]" style={{ color: GROUP_LABEL }}>Shipment Intelligence</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {NAV_GROUPS.map(group => (
          <div key={group.key} className="mb-2">
            {!collapsed && (
              <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: GROUP_LABEL }}>
                {NAV_LABELS[group.key] ?? group.key}
              </div>
            )}
            {group.items.map(item => (
              <NavLink
                key={item.key} to={item.to} end={item.to === "/"}
                className={({ isActive }) => clsx(
                  "flex items-center gap-3 mx-1 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  collapsed ? "justify-center" : "",
                  isActive
                    ? `text-[${ITEM_ACTIVE_FG}]`
                    : `text-[${ITEM_DEFAULT}] hover:bg-[${ITEM_HOVER_BG}]`
                )}
                style={({ isActive }) => isActive ? { background: ITEM_ACTIVE_BG, color: ITEM_ACTIVE_FG } : {}}
              >
                <item.icon size={16} className="flex-shrink-0" />
                {!collapsed && <span>{NAV_LABELS[item.key] ?? item.key}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Collapse button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{ borderTopColor: SIDEBAR_BORDER, color: GROUP_LABEL }}
        className="flex h-10 items-center justify-center border-t hover:opacity-80 transition-opacity"
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  );
}
