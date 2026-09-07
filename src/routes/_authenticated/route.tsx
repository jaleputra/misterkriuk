import { createFileRoute, Outlet, redirect, useRouterState, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BottomNav } from "@/components/BottomNav";
import { AppHeader } from "@/components/AppHeader";
import { Toaster } from "@/components/ui/sonner";
import { hasCashierCheckedInToday, syncTodayAttendanceFromCloud } from "@/lib/attendance";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    let currentUser: any = null;
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.user) {
      currentUser = sessionData.session.user;
    } else {
      const { data: userData, error } = await supabase.auth.getUser();
      if (error || !userData?.user) {
        throw redirect({ to: "/auth" });
      }
      currentUser = userData.user;
    }

    if (currentUser?.id) {
      try {
        await syncTodayAttendanceFromCloud(currentUser.id, currentUser.email);
      } catch {}
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

  // Status sinkronisasi absensi dari cloud untuk multi-perangkat
  const [attSynced, setAttSynced] = useState(false);
  const [attRevision, setAttRevision] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const handleUpdate = () => setAttRevision((v) => v + 1);
    window.addEventListener("attendance_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    // Sinkronkan data absensi hari ini dari Supabase Cloud
    if (user?.id) {
      syncTodayAttendanceFromCloud(user.id, user.email)
        .catch(() => null)
        .finally(() => {
          if (isMounted) {
            setAttSynced(true);
            setAttRevision((v) => v + 1);
          }
        });
    } else {
      setAttSynced(true);
    }

    // Pasang Realtime Listener Supabase untuk menerima update absensi dari perangkat lain
    const channel = supabase
      .channel("attendance_realtime_sync_layout")
      .on("broadcast", { event: "cashier_attendance_updated" }, (payload) => {
        if (user) {
          syncTodayAttendanceFromCloud(user.id, user.email).then(() => {
            if (isMounted) setAttRevision((v) => v + 1);
          });
        }
      })
      .subscribe();

    return () => {
      isMounted = false;
      window.removeEventListener("attendance_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
      supabase.removeChannel(channel);
    };
  }, [user?.id, user?.email]);

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

  // Route protection effect using router navigation
  useEffect(() => {
    if (loading) return;
    // Tunggu sinkronisasi cloud absensi selesai sebelum mengambil keputusan pengalihan untuk kasir
    if (effectiveRole === "cashier" && !attSynced) return;

    if (effectiveRole === "cashier") {
      if (!hasCheckedIn && !pathname.startsWith("/attendance")) {
        navigate({ to: "/attendance", replace: true });
        return;
      }
      if (!isAllowed) {
        navigate({ to: "/transaction", replace: true });
        return;
      }
    }
  }, [effectiveRole, hasCheckedIn, pathname, isAllowed, loading, attSynced, navigate, attRevision]);

  if (loading || (effectiveRole === "cashier" && !attSynced)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center bg-background">
        <div className="animate-spin h-7 w-7 border-2 border-primary border-t-transparent rounded-full mb-3" />
        <p className="text-sm font-medium text-muted-foreground">Menyelaraskan data sesi & absensi...</p>
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
