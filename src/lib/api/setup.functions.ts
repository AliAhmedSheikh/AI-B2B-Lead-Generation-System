/**
 * Database setup utilities.
 * Checks lead_scores table and triggers PostgREST schema cache reload.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiLogger } from "@/lib/ai/logger";

// Send NOTIFY pgrst, 'reload schema' — forces PostgREST to reload immediately
async function notifySchemaReload(supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>) {
  try {
    // This works because the user's JWT client can call pg_notify via RPC
    await (supabase as ReturnType<typeof import("@supabase/supabase-js").createClient>)
      .rpc("pg_notify" as never, { channel: "pgrst", payload: "reload schema" });
  } catch {
    // pg_notify may not be exposed as RPC — that's fine
  }
}

export const checkLeadScoresTable = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({}))
  .handler(async ({ context }) => {
    const { supabase } = context;

    // Send a schema reload notification first
    await notifySchemaReload(supabase);

    // Small wait for PostgREST to process the notification
    await new Promise(r => setTimeout(r, 1500));

    // Now check if the table is accessible
    const { error } = await supabase
      .from("lead_scores" as never)
      .select("id", { count: "exact", head: true } as never);

    const exists = !error;
    aiLogger.info("setup", "lead_scores table check", { exists, error: error?.message });
    return { exists };
  });

export const reloadSchemaCache = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({}))
  .handler(async ({ context }) => {
    const { supabase } = context;
    await notifySchemaReload(supabase);
    await new Promise(r => setTimeout(r, 2000));
    return { ok: true };
  });
