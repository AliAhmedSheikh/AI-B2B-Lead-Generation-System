import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) {
        await supabase.auth.signOut();
        throw redirect({ to: "/auth" });
      }
      return { user: data.user };
    } catch (err) {
      if (err instanceof Error && err.message === "Redirect") throw err;
      await supabase.auth.signOut().catch(() => {});
      throw redirect({ to: "/auth" });
    }
  },
  component: () => <Outlet />,
});
