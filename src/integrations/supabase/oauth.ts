import { supabase } from "./client";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

export const auth = {
  signInWithOAuth: async (
    provider: "google" | "apple" | "microsoft",
    opts?: SignInOptions,
  ) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider as never,
      options: {
        redirectTo: opts?.redirect_uri ?? window.location.origin,
        queryParams: opts?.extraParams,
      },
    });
    if (error) return { error };
    return { error: null };
  },
};
