/**
 * AI Classification Pipeline — Phase 1
 *
 * Classifies contacts and returns scores directly to the client.
 * Also attempts to persist scores to the DB (best-effort).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { classifyBatch, classifyContact, ACTIVE_MODEL } from "./classifier";
import { aiLogger } from "./logger";

type ContactRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  source: string | null;
  raw: Record<string, unknown> | null;
};

export type ScoredContact = {
  id: string;
  ai_score: number;
  lead_category: "Hot" | "Warm" | "Cold";
  confidence_score: number;
  model_version: string;
};

// ---------------------------------------------------------------------------
// classifyAllContacts — classify all, return scores, persist best-effort
// ---------------------------------------------------------------------------
export const classifyAllContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const start = Date.now();

    aiLogger.info("pipeline", "Starting full classification", {
      userId, modelVersion: ACTIVE_MODEL.version,
    });

    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      aiLogger.error("pipeline", "Fetch failed", { error: error.message });
      throw new Error(`Failed to fetch contacts: ${error.message}`);
    }

    const contacts = (data ?? []) as ContactRow[];
    if (contacts.length === 0) {
      return { scores: [] as ScoredContact[], elapsed: 0 };
    }

    // Run classifier
    const results = classifyBatch(contacts, ACTIVE_MODEL);
    const scores: ScoredContact[] = results.map((r, i) => ({
      id:               contacts[i].id,
      ai_score:         r.aiScore,
      lead_category:    r.leadCategory,
      confidence_score: r.confidenceScore,
      model_version:    r.modelVersion,
    }));

    // Persist to DB best-effort (UPDATE contacts columns)
    let persisted = 0;
    const CHUNK = 50;
    for (let i = 0; i < scores.length; i += CHUNK) {
      const chunk = scores.slice(i, i + CHUNK);
      const updates = chunk.map((s) =>
        supabase.from("contacts").update({
          ai_score:         s.ai_score,
          lead_category:    s.lead_category,
          confidence_score: s.confidence_score,
          model_version:    s.model_version,
        }).eq("id", s.id)
      );
      const settled = await Promise.allSettled(updates);
      persisted += settled.filter(
        (r) => r.status === "fulfilled" && !r.value.error
      ).length;
    }

    const elapsed = Date.now() - start;
    aiLogger.info("pipeline", "Classification done", {
      total: scores.length, persisted, elapsed,
    });

    return { scores, elapsed };
  });

// ---------------------------------------------------------------------------
// classifyImportedContacts — called post-import, scores unscored contacts
// ---------------------------------------------------------------------------
export const classifyImportedContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ importLogId: z.string().uuid().optional() }))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Fetch contacts with no score yet
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", userId)
      .is("lead_category", null);

    if (error) {
      aiLogger.warn("pipeline", "Fetch unscored failed (columns may not exist yet)", { error: error.message });
      // Columns don't exist yet — score all contacts instead
      const { data: all } = await supabase
        .from("contacts")
        .select("*")
        .eq("user_id", userId);
      const contacts = (all ?? []) as ContactRow[];
      if (!contacts.length) return { scores: [] as ScoredContact[], elapsed: 0 };
      return runAndPersist(supabase, contacts);
    }

    const contacts = (data ?? []) as ContactRow[];
    if (!contacts.length) return { scores: [] as ScoredContact[], elapsed: 0 };
    return runAndPersist(supabase, contacts);
  });

// ---------------------------------------------------------------------------
// reprocessSingleContact — classify one contact, return score
// ---------------------------------------------------------------------------
export const reprocessSingleContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: contact, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();

    if (error || !contact) throw new Error("Contact not found");

    const result = classifyContact(contact as ContactRow, ACTIVE_MODEL);
    const score: ScoredContact = {
      id:               contact.id,
      ai_score:         result.aiScore,
      lead_category:    result.leadCategory,
      confidence_score: result.confidenceScore,
      model_version:    result.modelVersion,
    };

    // Persist best-effort
    await supabase.from("contacts").update({
      ai_score:         score.ai_score,
      lead_category:    score.lead_category,
      confidence_score: score.confidence_score,
      model_version:    score.model_version,
    }).eq("id", score.id).then(({ error: e }) => {
      if (e) aiLogger.warn("pipeline", "Persist failed (columns may not exist)", { error: e.message });
    });

    return score;
  });

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------
async function runAndPersist(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  contacts: ContactRow[],
): Promise<{ scores: ScoredContact[]; elapsed: number }> {
  const start = Date.now();
  const results = classifyBatch(contacts, ACTIVE_MODEL);
  const scores: ScoredContact[] = results.map((r, i) => ({
    id:               contacts[i].id,
    ai_score:         r.aiScore,
    lead_category:    r.leadCategory,
    confidence_score: r.confidenceScore,
    model_version:    r.modelVersion,
  }));

  // Persist best-effort
  await Promise.allSettled(scores.map((s) =>
    (supabase as ReturnType<typeof import("@supabase/supabase-js").createClient>)
      .from("contacts").update({
        ai_score: s.ai_score,
        lead_category: s.lead_category,
        confidence_score: s.confidence_score,
        model_version: s.model_version,
      }).eq("id", s.id)
  ));

  return { scores, elapsed: Date.now() - start };
}
