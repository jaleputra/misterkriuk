import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (user) {
        const email = user.email?.toLowerCase().trim();
        const dest = email === "jaleputra69@gmail.com" ? "/dashboard" : "/transaction";
        throw redirect({ to: dest });
      }
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        const email = userData.user.email?.toLowerCase().trim();
        const dest = email === "jaleputra69@gmail.com" ? "/dashboard" : "/transaction";
        throw redirect({ to: dest });
      }
    } catch (e) {
      if ((e as any)?.to) throw e;
    }
    throw redirect({ to: "/auth" });
  },
  component: () => null,
});
