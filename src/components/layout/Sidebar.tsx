"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useViewMode } from "./ViewModeProvider";
import {
  LayoutDashboard, Users, Kanban, FileText, Receipt,
  HardHat, Package, TrendingUp, BarChart3, Bot,
  Menu, X, MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

/* ──────────────────────────────────────────────────────────────
   NAV ITEMS — simple = les 4 essentiels, advanced = tout
────────────────────────────────────────────────────────────── */
const navItems = [
  { href: "/dashboard", label: "Accueil", icon: LayoutDashboard, simple: true },
  { href: "/leads", label: "Leads", icon: Users, badge: "leads", simple: true },
  { href: "/leads/kanban", label: "Kanban", icon: Kanban, simple: false },
  { href: "/devis", label: "Devis", icon: FileText, simple: true },
  { href: "/factures", label: "Factures", icon: Receipt, badge: "factures", simple: false },
  { href: "/chantiers", label: "Chantiers", icon: HardHat, simple: true },
  { href: "/commandes", label: "Commandes", icon: Package, simple: false },
  { href: "/finances", label: "Finances", icon: TrendingUp, simple: false },
  { href: "/analytics", label: "Analytics", icon: BarChart3, simple: false },
  { href: "/assistant", label: "Assistant IA", icon: Bot, simple: false },
];

/* ──────────────────────────────────────────────────────────── */
function NavLink({
  item,
  counts,
  onClick,
}: {
  item: (typeof navItems)[0];
  counts: Record<string, number>;
  onClick?: () => void;
}) {
  const pathname = usePathname();
  const isActive =
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href));
  const Icon = item.icon;
  const count = item.badge ? counts[item.badge] || 0 : 0;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200",
        isActive
          ? "bg-[#CC0000]/10 text-[#CC0000] font-semibold"
          : "text-gray-500 hover:text-gray-900 hover:bg-gray-100/80"
      )}
    >
      <Icon className={cn("h-[18px] w-[18px] shrink-0", isActive && "text-[#CC0000]")} />
      <span className="flex-1">{item.label}</span>
      {count > 0 && (
        <Badge className="h-5 min-w-5 flex items-center justify-center text-[10px] px-1.5 bg-[#CC0000] text-white border-0 font-semibold">
          {count}
        </Badge>
      )}
    </Link>
  );
}

/* ──────────────────────────────────────────────────────────── */
export default function Sidebar({ counts = {} }: { counts?: Record<string, number> }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { mode, toggle, isSimple } = useViewMode();

  const visibleItems = isSimple
    ? navItems.filter((i) => i.simple)
    : navItems;

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="w-8 h-8 bg-[#CC0000] rounded-[10px] flex items-center justify-center font-bold text-white text-sm shadow-sm">
          C
        </div>
        <span className="font-semibold text-[17px] text-gray-900 tracking-tight">
          Cover<span className="text-[#CC0000]">Swap</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        {visibleItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            counts={counts}
            onClick={() => setMobileOpen(false)}
          />
        ))}
      </nav>

      {/* Toggle Simple/Avance */}
      <div className="px-4 py-4 border-t border-gray-100">
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors group"
        >
          <span className="text-[12px] text-gray-400 font-medium uppercase tracking-wider">
            {isSimple ? "Mode simple" : "Mode avance"}
          </span>
          <div className={cn("toggle-track", !isSimple && "active")}>
            <div className="toggle-thumb" />
          </div>
        </button>
        <p className="text-[11px] text-gray-300 mt-1.5 px-3">
          {isSimple ? "Essentiel uniquement" : "Tous les details"}
        </p>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Mobile header ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200/60 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#CC0000] rounded-lg flex items-center justify-center font-bold text-white text-xs">
            C
          </div>
          <span className="font-semibold text-gray-900">
            Cover<span className="text-[#CC0000]">Swap</span>
          </span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* ── Mobile menu overlay ── */}
      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="lg:hidden fixed top-14 left-0 bottom-0 w-72 bg-white z-50 shadow-2xl overflow-y-auto">
            {sidebarContent}
          </div>
        </>
      )}

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex flex-col h-screen sticky top-0 w-[240px] bg-white/60 backdrop-blur-xl border-r border-gray-200/60">
        {sidebarContent}
      </aside>
    </>
  );
}
