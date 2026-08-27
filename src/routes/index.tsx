import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session) throw redirect({ to: "/transaction" });
    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) throw redirect({ to: "/transaction" });
    throw redirect({ to: "/auth" });
  },
  component: () => null,
});
