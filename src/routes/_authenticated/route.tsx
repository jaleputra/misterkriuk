import { createFileRoute, Outlet, redirect, useRouterState, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BottomNav } from "@/components/BottomNav";
import { AppHeader } from "@/components/AppHeader";
import { Toaster } from "@/components/ui/sonner";
import { hasCashierCheckedInToday, hasCashierClockedOutToday } from "@/lib/attendance";
import { useEffect, useState } from "react";
import { Coffee } from "lucide-react";

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
  "/attendance": "Absen Kasir",
};

function AuthedLayout() {
  const navigate = useNavigate();
  const { role, user, branchName, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Re-check status when attendance updates occur
  const [attRevision, setAttRevision] = useState(0);
  useEffect(() => {
    const handleUpdate = () => setAttRevision((v) => v + 1);
    window.addEventListener("attendance_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("attendance_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

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
  const isAllowed = allowedCashierRoutes.some((route) => pathname.startsWith(route));
  const hasCheckedIn = effectiveRole === "cashier" ? hasCashierCheckedInToday(user?.id, user?.email) : true;
  const hasClockedOut = effectiveRole === "cashier" ? hasCashierClockedOutToday(user?.id, user?.email) : false;

  // Route protection effect using router navigation instead of window.location.replace
  useEffect(() => {
    if (loading) return;
    if (effectiveRole === "cashier") {
      if (hasClockedOut) {
        supabase.auth.signOut().then(() => {
          navigate({ to: "/auth", replace: true });
        });
        return;
      }
      if (!hasCheckedIn && !pathname.startsWith("/attendance")) {
        navigate({ to: "/attendance", replace: true });
        return;
      }
      if (!isAllowed) {
        navigate({ to: "/transaction", replace: true });
        return;
      }
    }
  }, [effectiveRole, hasClockedOut, hasCheckedIn, pathname, isAllowed, loading, navigate, attRevision]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">Memuat…</div>
    );
  }

  // Guard loading placeholder for cashiers who have already clocked out today
  if (effectiveRole === "cashier" && hasClockedOut) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center bg-background">
        <div className="h-12 w-12 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center mb-3 border border-amber-500/20 shadow-xs">
          <Coffee className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-bold text-foreground mb-1">Shift Hari Ini Telah Selesai</h2>
        <p className="text-sm font-medium text-muted-foreground">istirahatlah, besok mulai bekerja lagi</p>
      </div>
    );
  }

  // Guard loading placeholder for cashiers who have not checked in yet
  if (effectiveRole === "cashier" && !hasCheckedIn && !pathname.startsWith("/attendance")) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center bg-background">
        <div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full mb-3" />
        <p className="text-sm font-medium text-muted-foreground">Mengarahkan ke halaman absensi kasir...</p>
      </div>
    );
  }

  // Guard loading placeholder for disallowed routes
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
