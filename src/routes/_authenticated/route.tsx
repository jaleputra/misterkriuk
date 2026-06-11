import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BottomNav } from "@/components/BottomNav";
import { AppHeader } from "@/components/AppHeader";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/menu": "Input Menu",
  "/transaction": "Transaksi",
  "/warehouse": "Gudang",
  "/settings": "Pengaturan",
};

function AuthedLayout() {
  const { role, user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (loading || !role) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">Memuat…</div>
    );
  }

  // Cashier route guard: only /transaction
  if (role === "cashier" && !pathname.startsWith("/transaction")) {
    if (typeof window !== "undefined") window.location.replace("/transaction");
    return null;
  }

  const title = Object.keys(TITLES).find((k) => pathname.startsWith(k));
  return (
    <div className="min-h-screen flex flex-col pb-20">
      <AppHeader title={title ? TITLES[title] : ""} role={role} email={user?.email ?? ""} />
      <main className="flex-1 mx-auto max-w-[1400px] w-full px-3 sm:px-4 py-3 sm:py-4">
        <Outlet />
      </main>
      <BottomNav role={role} />
      <Toaster richColors position="top-center" />
    </div>
  );
}
