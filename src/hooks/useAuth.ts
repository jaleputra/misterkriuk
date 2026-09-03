import { useSyncExternalStore } from "react";
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

export function inferRoleFromEmail(email?: string | null): AppRole {
  if (!email) return "cashier";
  const normalized = email.trim().toLowerCase();
  if (normalized === "jaleputra69@gmail.com") return "admin";
  if (normalized.includes("kasir")) return "cashier";
  return "cashier";
}

export function inferBranchFromEmail(email?: string | null): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (normalized === "kasir@gmail.com" || normalized === "kasir1@gmail.com") return "Cabang 1";
  if (normalized === "kasir2@gmail.com") return "Cabang 2";
  return null;
}

let currentState: AuthState = {
  session: null,
  user: null,
  role: null,
  branchName: null,
  loading: true,
};

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function setAuthState(partial: Partial<AuthState>) {
  currentState = { ...currentState, ...partial };
  notify();
}

let initialized = false;

async function loadRoleForUser(user: User) {
  const uid = user.id;
  const email = user.email || "";
  const inferredRole = inferRoleFromEmail(email);
  const isKasirEmail = email.toLowerCase().trim() === "kasir@gmail.com" || email.toLowerCase().includes("kasir");

  // Immediate optimistic assignment for known roles to prevent any admin UI flash
  if (isKasirEmail && currentState.role !== "cashier") {
    setAuthState({ role: "cashier" });
  }

  try {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role, branch_name, created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("loadRole user_roles query warning:", error);
    }

    const records = data ?? [];
    if (records.length > 0) {
      const latest = records[0];
      let assignedRole = (latest.role as AppRole) || inferredRole;
      let assignedBranch = latest.branch_name ?? inferBranchFromEmail(email) ?? null;

      // Ensure kasir@gmail.com is strictly cashier
      if (isKasirEmail && assignedRole !== "cashier") {
        assignedRole = "cashier";
        try {
          await supabase.from("user_roles").update({ role: "cashier" }).eq("user_id", uid);
        } catch (updateErr) {
          console.warn("Gagal update role kasir di DB:", updateErr);
        }
      }

      setAuthState({
        role: assignedRole,
        branchName: assignedBranch,
        loading: false,
      });

      if (typeof window !== "undefined") {
        localStorage.setItem(`app_user_role_${uid}`, assignedRole);
        if (assignedBranch) localStorage.setItem(`app_user_branch_${uid}`, assignedBranch);
      }
      return;
    }

    // If no record exists in user_roles table yet
    const fallbackRole = inferredRole;
    const fallbackBranch = inferBranchFromEmail(email);
    setAuthState({
      role: fallbackRole,
      branchName: fallbackBranch,
      loading: false,
    });

    if (typeof window !== "undefined") {
      localStorage.setItem(`app_user_role_${uid}`, fallbackRole);
      if (fallbackBranch) localStorage.setItem(`app_user_branch_${uid}`, fallbackBranch);
    }

    try {
      await supabase.from("user_roles").insert({
        user_id: uid,
        role: fallbackRole,
        branch_name: fallbackBranch,
      });
    } catch (insertErr) {
      console.warn("Auto-insert user_roles fallback:", insertErr);
    }
  } catch (err) {
    console.error("Gagal memuat role pengguna:", err);
    setAuthState({
      role: inferredRole,
      branchName: inferBranchFromEmail(email),
      loading: false,
    });
  }
}

export function refreshAuthRole() {
  if (currentState.user) {
    return loadRoleForUser(currentState.user);
  }
  return Promise.resolve();
}

function initAuth() {
  if (initialized) return;
  initialized = true;

  supabase.auth.getSession().then(({ data }) => {
    const session = data?.session ?? null;
    const user = session?.user ?? null;
    if (user) {
      const cachedRole = typeof window !== "undefined" ? localStorage.getItem(`app_user_role_${user.id}`) as AppRole | null : null;
      const cachedBranch = typeof window !== "undefined" ? localStorage.getItem(`app_user_branch_${user.id}`) : null;
      const fallbackRole = cachedRole || inferRoleFromEmail(user.email);
      const fallbackBranch = cachedBranch || inferBranchFromEmail(user.email);
      setAuthState({
        session,
        user,
        role: fallbackRole,
        branchName: fallbackBranch,
        loading: !cachedRole,
      });
      loadRoleForUser(user);
    } else {
      setAuthState({ session: null, user: null, role: null, branchName: null, loading: false });
    }
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null;
    if (user) {
      const cachedRole = typeof window !== "undefined" ? localStorage.getItem(`app_user_role_${user.id}`) as AppRole | null : null;
      const cachedBranch = typeof window !== "undefined" ? localStorage.getItem(`app_user_branch_${user.id}`) : null;
      const fallbackRole = cachedRole || inferRoleFromEmail(user.email);
      const fallbackBranch = cachedBranch || inferBranchFromEmail(user.email);
      setAuthState({
        session,
        user,
        role: fallbackRole,
        branchName: fallbackBranch,
        loading: false,
      });
      loadRoleForUser(user);
    } else {
      setAuthState({ session: null, user: null, role: null, branchName: null, loading: false });
    }
  });
}

export function useAuth(): AuthState {
  initAuth();

  const state = useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    () => currentState,
    () => currentState
  );

  return state;
}
