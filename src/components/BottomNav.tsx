import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, UtensilsCrossed, ShoppingCart, Warehouse, Settings, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/hooks/useAuth";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: AppRole[];
}

const items: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "cashier"] },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed, roles: ["admin"] },
  { to: "/transaction", label: "Kasir", icon: ShoppingCart, roles: ["admin", "cashier"] },
  { to: "/warehouse", label: "Pengeluaran", icon: Warehouse, roles: ["admin", "cashier"] },
  { to: "/reports", label: "Laporan", icon: FileText, roles: ["admin", "cashier"] },
  { to: "/settings", label: "Setelan", icon: Settings, roles: ["admin", "cashier"] },
];

export function BottomNav({ role }: { role: AppRole }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visible = items.filter((i) => i.roles.includes(role));
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border/80 bg-card/90 backdrop-blur-lg supports-[backdrop-filter]:bg-card/85 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.03)]">
      <div className="mx-auto max-w-4xl px-2 py-1.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0,1fr))` }}>
        {visible.map((item) => {
          const active = pathname.startsWith(item.to) || (item.to === "/dashboard" && role === "cashier" && pathname.startsWith("/income-details"));
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to === "/dashboard" && role === "cashier" ? "/income-details" : item.to}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 py-1.5 px-1 rounded-xl text-[11px] font-medium transition-all duration-200",
                active 
                  ? "text-primary font-semibold bg-primary/10 shadow-xs" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
            >
              <Icon className={cn("h-5 w-5 transition-transform duration-200", active && "scale-110 stroke-[2.25px]")} />
              <span className="leading-tight truncate max-w-full">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
