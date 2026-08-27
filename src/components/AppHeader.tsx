import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

export function AppHeader({ title, role, email }: { title: string; role: string; email?: string }) {
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto max-w-[1400px] w-full flex items-center justify-between px-3 sm:px-4 py-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <img 
            src="/logo.png" 
            alt="Logo" 
            className="h-9 w-9 sm:h-10 sm:w-10 object-contain shrink-0" 
          />
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-bold leading-tight truncate">Mr Kriuk Ami</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground leading-tight truncate">{title}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex flex-col items-end text-right min-w-0">
            <span className="text-[10px] sm:text-xs font-medium truncate max-w-[90px] min-[400px]:max-w-[140px] sm:max-w-none">{email}</span>
            <span className="text-[8px] sm:text-[10px] uppercase tracking-wider text-muted-foreground leading-none mt-0.5">{role}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Logout" className="shrink-0 h-8 w-8 sm:h-9 sm:w-9">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

