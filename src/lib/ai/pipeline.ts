/**
 * AI Classification Pipeline — Phase 1
 *
 * Processing flow:
 *   Leads → Feature Engineering → AI Model → Scoring → Classification → DB
 *
 * Can be called:
 *   1. After a CSV import (classifyImportedContacts)
 *   2. On-demand for a single contact (via reprocessLead API)
 *   3. In bulk for all unscored contacts (classifyAllUnscored)
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { classifyBatch, ACTIVE_MODEL } from "./classifier";
import { aiLogger } from "./logger";

const CHUNK_SIZE = 200;

// ---------------------------------------------------------------------------
// Internal helper: classify + persist a batch of contacts for a user
// ---------------------------------------------------------------------------
async function processContacts(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  userId: string,
  contacts: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    source: string | null;
    raw: Record<string, unknown> | null;
  }[],
): Promise<{ scored: number; failed: number }> {
  let scored = 0;
  let failed = 0;

  for (let i = 0; i < contacts.length; i += CHUNK_SIZE) {
    const chunk = contacts.slice(i, i + CHUNK_SIZE);

    aiLogger.info("pipeline", `Classifying chunk ${Math.floor(i / CHUNK_SIZE) + 1}`, {
      chunkSize: chunk.length,
      modelVersion: ACTIVE_MODEL.version,
    });

    const results = classifyBatch(chunk, ACTIVE_MODEL);

    const rows = results.map((r, idx) => ({
      user_id:          userId,
      contact_id:       chunk[idx].id,
      ai_score:         r.aiScore,
      lead_category:    r.leadCategory,
      confidence_score: r.confidenceScore,
      model_version:    r.modelVersion,
      features:         r.features as never,
    }));

    const { error } = await (supabase as unknown as {
      from: (t: string) => {
        upsert: (rows: unknown[], opts: unknown) => Promise<{ error: unknown }>;
      };
    })
      .from("lead_scores")
      .upsert(rows, { onConflict: "contact_id" });

    if (error) {
      aiLogger.error("pipeline", "Chunk upsert failed", {
        chunk: i,
        error: String(error),
      });
      failed += chunk.length;
    } else {
      scored += chunk.length;
      aiLogger.info("pipeline", "Chunk persisted", { scored });
    }
  }

  return { scored, failed };
}

// ---------------------------------------------------------------------------
// classifyImportedContacts — called after an import to score new contacts
// ---------------------------------------------------------------------------
export const classifyImportedContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ importLogId: z.string().uuid().optional() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const start = Date.now();

    aiLogger.info("pipeline", "Starting post-import classification", {
      userId,
      importLogId: data.importLogId,
      modelVersion: ACTIVE_MODEL.version,
    });

    // Fetch contacts that don't yet have a score
    const { data: unscored, error } = await supabase
      .from("contacts")
      .select("id, email, first_name, last_name, company, source, raw")
      .eq("user_id", userId)
      .not(
        "id",
        "in",
        `(select contact_id from lead_scores where user_id = '${userId}')`,
      );

    if (error) {
      aiLogger.error("pipeline", "Failed to fetch unscored contacts", { error: error.message });
      throw new Error(`Pipeline error: ${error.message}`);
    }

    const contacts = (unscored ?? []) as {
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      company: string | null;
      source: string | null;
      raw: Record<string, unknown> | null;
    }[];

    if (contacts.length === 0) {
      aiLogger.info("pipeline", "No unscored contacts found");
      return { scored: 0, failed: 0, elapsedMs: 0 };
    }

    aiLogger.info("pipeline", `Found ${contacts.length} unscored contacts`);
    const { scored, failed } = await processContacts(supabase as never, userId, contacts);
    const elapsed = Date.now() - start;

    aiLogger.info("pipeline", "Classification pipeline complete", {
      scored,
      failed,
      elapsedMs: elapsed,
      modelVersion: ACTIVE_MODEL.version,
    });

    return { scored, failed, elapsedMs: elapsed };
  });

// ---------------------------------------------------------------------------
// classifyAllContacts — re-score every contact for the current user
// ---------------------------------------------------------------------------
export const classifyAllContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const start = Date.now();

    aiLogger.info("pipeline", "Starting full re-classification", {
      userId,
      modelVersion: ACTIVE_MODEL.version,
    });

    const { data: allContacts, error } = await supabase
      .from("contacts")
      .select("id, email, first_name, last_name, company, source, raw")
      .eq("user_id", userId);

    if (error) {
      aiLogger.error("pipeline", "Failed to fetch contacts", { error: error.message });
      throw new Error(`Pipeline error: ${error.message}`);
    }

    const contacts = (allContacts ?? []) as {
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      company: string | null;
      source: string | null;
      raw: Record<string, unknown> | null;
    }[];

    if (contacts.length === 0) {
      return { scored: 0, failed: 0, elapsedMs: 0 };
    }

    const { scored, failed } = await processContacts(supabase as never, userId, contacts);
    const elapsed = Date.now() - start;

    aiLogger.info("pipeline", "Full re-classification complete", {
      scored,
      failed,
      elapsedMs: elapsed,
    });

    return { scored, failed, elapsedMs: elapsed };
  });
