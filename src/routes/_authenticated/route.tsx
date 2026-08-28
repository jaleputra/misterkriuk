import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BottomNav } from "@/components/BottomNav";
import { AppHeader } from "@/components/AppHeader";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.user) {
      return { user: sessionData.session.user };
    }
    const { data: userData, error } = await supabase.auth.getUser();
    if (error || !userData?.user) {
      throw redirect({ to: "/auth" });
    }
    return { user: userData.user };
  },
  component: AuthedLayout,
});

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/menu": "Input Menu",
  "/transaction": "Transaksi",
  "/warehouse": "Pengeluaran",
  "/income-details": "Detail Pemasukan",
  "/expense-details": "Detail Pengeluaran",
  "/sold-products": "Detail Produk Terjual",
  "/settings": "Pengaturan",
  "/reports": "Laporan Harian",
};

function AuthedLayout() {
  const { role, user, branchName, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">Memuat…</div>
    );
  }

  const effectiveRole = role || "admin";

  // Cashier route guard: allow transaction, warehouse, expense-details, settings, dashboard, income-details, reports
  const allowedCashierRoutes = [
    "/transaction",
    "/warehouse",
    "/expense-details",
    "/settings",
    "/dashboard",
    "/income-details",
    "/reports"
  ];
  const isAllowed = allowedCashierRoutes.some((route) => pathname.startsWith(route));
  if (effectiveRole === "cashier" && !isAllowed) {
    if (typeof window !== "undefined") window.location.replace("/transaction");
    return null;
  }

  const title = Object.keys(TITLES).find((k) => pathname.startsWith(k));
  return (
    <div className="min-h-screen flex flex-col pb-20">
      <AppHeader
        title={title ? TITLES[title] : ""}
        role={effectiveRole}
        email={user?.email ?? ""}
        branchName={branchName}
      />
      <main className="flex-1 mx-auto max-w-[1400px] w-full px-3 sm:px-4 py-3 sm:py-4">
        <Outlet />
      </main>
      <BottomNav role={effectiveRole} />
      <Toaster richColors position="top-center" />
    </div>
  );
}
