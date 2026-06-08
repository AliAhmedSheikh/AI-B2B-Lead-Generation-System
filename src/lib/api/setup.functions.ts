/**
 * Database setup utilities.
 * Checks lead_scores table and triggers PostgREST schema cache reload.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiLogger } from "@/lib/ai/logger";

// Send NOTIFY pgrst, 'reload schema' — forces PostgREST to reload immediately
async function notifySchemaReload(supabase: SupabaseClient) {
  try {
    // This works because the user's JWT client can call pg_notify via RPC
    await (supabase as unknown as SupabaseClient)
      .rpc("pg_notify" as never, { channel: "pgrst", payload: "reload schema" } as never);
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
    await notifySchemaReload(supabase as unknown as SupabaseClient);

    // Small wait for PostgREST to process the notification
    await new Promise(r => setTimeout(r, 1500));

    // Now check if the table is accessible
    const { error } = await (supabase as unknown as SupabaseClient)
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
    await notifySchemaReload(supabase as unknown as SupabaseClient);
    await new Promise(r => setTimeout(r, 2000));
    return { ok: true };
  });
