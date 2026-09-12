import { createFileRoute, Outlet, redirect, useRouterState, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BottomNav } from "@/components/BottomNav";
import { AppHeader } from "@/components/AppHeader";
import { Toaster } from "@/components/ui/sonner";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    let currentUser: any = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        currentUser = sessionData.session.user;
      } else {
        const { data: userData, error } = await supabase.auth.getUser();
        if (!error && userData?.user) {
          currentUser = userData.user;
        }
      }
    } catch {
      // Ignored
    }

    if (!currentUser) {
      throw redirect({ to: "/auth" });
    }

    return { user: currentUser };
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
  "/attendance": "Absen Kasir",
};

function AuthedLayout() {
  const navigate = useNavigate();
  const { role, user, branchName, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isExplicitKasir = user?.email?.toLowerCase().trim() === "kasir@gmail.com" || user?.email?.toLowerCase().includes("kasir");
  const effectiveRole: "admin" | "cashier" = isExplicitKasir
    ? "cashier"
    : role || (user?.email?.toLowerCase().trim() === "jaleputra69@gmail.com" ? "admin" : "cashier");

  const allowedCashierRoutes = [
    "/attendance",
    "/transaction",
    "/warehouse",
    "/expense-details",
    "/settings",
    "/dashboard",
    "/income-details",
    "/reports",
    "/sold-products"
  ];
  const isAllowed = effectiveRole === "admin" || allowedCashierRoutes.some((route) => pathname.startsWith(route));

  // Route protection effect using router navigation
  useEffect(() => {
    if (loading) return;
    if (effectiveRole === "cashier" && !isAllowed) {
      navigate({ to: "/transaction", replace: true });
    }
  }, [effectiveRole, pathname, isAllowed, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center bg-background">
        <div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full mb-3" />
        <p className="text-sm font-medium text-muted-foreground">Memuat aplikasi...</p>
      </div>
    );
  }

  if (effectiveRole === "cashier" && !isAllowed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center bg-background">
        <div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full mb-3" />
        <p className="text-sm font-medium text-muted-foreground">Mengarahkan ke halaman kasir...</p>
      </div>
    );
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
