import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  FileScan,
  ClipboardCheck,
  Network,
  ShieldCheck,
  Plug,
  Boxes,
  BarChart3,
  Search,
} from "lucide-react";

// Cmd+K command palette — the single fastest way for a power user to get
// anywhere in the platform without touching the mouse. This pattern
// (Linear, Notion, Jira Cloud, GitHub) signals a mature, fast product to
// anyone evaluating it; it costs little to build and is disproportionately
// noticed in a demo.

const DESTINATIONS = [
  { key: "dashboard", to: "/", icon: LayoutDashboard },
  { key: "documents", to: "/documents", icon: FileScan },
  { key: "bc23", to: "/bc23", icon: ClipboardCheck },
  { key: "tradeIntelligence", to: "/trade-intelligence", icon: Network },
  { key: "compliance", to: "/compliance", icon: ShieldCheck },
  { key: "erp", to: "/erp", icon: Plug },
  { key: "itInventory", to: "/it-inventory", icon: Boxes },
  { key: "analytics", to: "/analytics", icon: BarChart3 },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Palette"
      className="fixed left-1/2 top-[20%] w-[480px] -translate-x-1/2 overflow-hidden rounded border border-surface-border bg-surface-card shadow-card"
    >
      <div className="flex items-center gap-2 border-b border-surface-border px-3 py-2.5">
        <Search size={14} className="text-surface-muted" />
        <Command.Input
          placeholder={t("commandPalette.placeholder", "Ketik perintah atau cari halaman...")}
          className="w-full bg-transparent text-sm outline-none placeholder:text-surface-muted"
        />
        <kbd className="rounded border border-surface-border px-1.5 py-0.5 text-2xs text-surface-muted">
          ESC
        </kbd>
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="py-6 text-center text-sm text-surface-muted">
          {t("common.noData")}
        </Command.Empty>
        <Command.Group
          heading={t("commandPalette.navigate", "Navigasi")}
          className="text-2xs font-semibold uppercase tracking-wide text-surface-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
        >
          {DESTINATIONS.map(({ key, to, icon: Icon }) => (
            <Command.Item
              key={key}
              onSelect={() => {
                navigate(to);
                setOpen(false);
              }}
              className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-2 text-sm text-surface-text aria-selected:bg-intel-50 aria-selected:text-intel-500"
            >
              <Icon size={15} />
              {t(`nav.${key}`)}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
