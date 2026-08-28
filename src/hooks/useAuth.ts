import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "cashier";

export interface AuthState {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  branchName: string | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadRole = async (uid: string) => {
      try {
        const { data } = await supabase
          .from("user_roles")
          .select("role, branch_name")
          .eq("user_id", uid)
          .order("role", { ascending: true });
        if (!mounted) return;
        const roles = (data ?? []).map((r) => r.role as AppRole);
        const branch = (data ?? [])[0]?.branch_name ?? null;
        setBranchName(branch);
        if (roles.length > 0) {
          setRole(roles.includes("admin") ? "admin" : roles[0]);
        } else {
          // Fallback if user_roles record hasn't been created yet
          setRole("admin");
        }
      } catch {
        if (mounted) {
          setRole("admin");
          setBranchName(null);
        }
      }
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => loadRole(s.user.id), 0);
      } else {
        setRole(null);
        setBranchName(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) loadRole(data.session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user: session?.user ?? null, role, branchName, loading };
}
