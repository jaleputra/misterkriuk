import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, Drumstick } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

export function AppHeader({ title, role, email }: { title: string; role: string; email?: string }) {
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto max-w-5xl flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-sm">
            <Drumstick className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">AMI Fried Chicken</div>
            <div className="text-xs text-muted-foreground leading-tight">{title}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end text-right">
            <span className="text-xs font-medium">{email}</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{role}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
