import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

export function AppHeader({
  title,
  role,
  email,
  branchName,
}: {
  title: string;
  role: string;
  email?: string;
  branchName?: string | null;
}) {
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const isCashier = role === "cashier";

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-card/85 backdrop-blur-md transition-all shadow-xs">
      <div className="mx-auto max-w-[1400px] w-full flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-primary/5 border border-border flex items-center justify-center p-1 shadow-xs shrink-0">
            <img 
              src="/logo.png" 
              alt="Logo Mr Kriuk Ami" 
              className="h-full w-full object-contain" 
            />
          </div>
          <div className="min-w-0 flex flex-col justify-center">
            <div className="text-xs sm:text-sm font-bold text-foreground leading-tight tracking-tight truncate flex items-center gap-1.5">
              <span>Mr Kriuk Ami</span>
            </div>
            <div className="text-[11px] sm:text-xs text-muted-foreground font-medium leading-tight truncate">
              {title}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex flex-col items-end text-right min-w-0">
            <span className="text-[11px] sm:text-xs font-semibold text-foreground truncate max-w-[110px] min-[400px]:max-w-[160px] sm:max-w-none">
              {email}
            </span>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider mt-0.5 ${
              isCashier 
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20" 
                : "bg-primary/10 text-primary border border-primary/20"
            }`}>
              <span>{role}</span>
              {branchName && (
                <>
                  <span className="opacity-40">•</span>
                  <span className="truncate max-w-[90px] sm:max-w-[140px] lowercase capitalize">{branchName}</span>
                </>
              )}
            </span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            title="Keluar"
            aria-label="Logout"
            className="shrink-0 h-8 w-8 sm:h-9 sm:w-9 rounded-lg hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
