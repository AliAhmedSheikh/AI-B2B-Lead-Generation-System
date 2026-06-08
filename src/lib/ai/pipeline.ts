import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { classifyBatch, classifyContact, ACTIVE_MODEL } from "./classifier";
import { aiLogger } from "./logger";
import type { SupabaseClient } from "@supabase/supabase-js";

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

function buildScorePayload(s: ScoredContact) {
  return {
    ai_score: s.ai_score,
    lead_category: s.lead_category,
    confidence_score: s.confidence_score,
    model_version: s.model_version,
  };
}

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

    const results = classifyBatch(contacts, ACTIVE_MODEL);
    const scores: ScoredContact[] = results.map((r, i) => ({
      id:               contacts[i].id,
      ai_score:         r.aiScore,
      lead_category:    r.leadCategory,
      confidence_score: r.confidenceScore,
      model_version:    r.modelVersion,
    }));

    // Persist scores to contacts.raw JSONB column
    let persisted = 0;
    const CHUNK = 50;
    for (let i = 0; i < scores.length; i += CHUNK) {
      const chunk = scores.slice(i, i + CHUNK);
      const updates = chunk.map((s) => {
        const contact = contacts.find((c) => c.id === s.id);
        const existingRaw = (contact?.raw ?? {}) as Record<string, unknown>;
        return (supabase as unknown as SupabaseClient)
          .from("contacts")
          .update({ raw: { ...existingRaw, _score: buildScorePayload(s) } } as never)
          .eq("id", s.id);
      });
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

export const classifyImportedContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ importLogId: z.string().uuid().optional() }))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: allContacts, error: fetchErr } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", userId);

    if (fetchErr) {
      aiLogger.warn("pipeline", "Fetch contacts failed", { error: fetchErr.message });
      return { scores: [] as ScoredContact[], elapsed: 0 };
    }

    // Find unscored contacts (no _score in raw JSONB)
    const unscored = ((allContacts ?? []) as ContactRow[]).filter((c) => {
      const raw = (c.raw ?? {}) as Record<string, unknown>;
      return !raw._score;
    });

    if (!unscored.length) return { scores: [] as ScoredContact[], elapsed: 0 };
    return runAndPersist(supabase, unscored, userId);
  });

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

    // Persist
    const existingRaw = (contact.raw ?? {}) as Record<string, unknown>;
    await (supabase as unknown as SupabaseClient).from("contacts").update({
      raw: { ...existingRaw, _score: buildScorePayload(score) },
    } as never).eq("id", score.id);

    return score;
  });

async function runAndPersist(
  supabase: SupabaseClient,
  contacts: ContactRow[],
  userId: string,
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

  await Promise.allSettled(scores.map((s) => {
    const contact = contacts.find((c) => c.id === s.id);
    const existingRaw = (contact?.raw ?? {}) as Record<string, unknown>;
    return (supabase as unknown as SupabaseClient)
      .from("contacts")
      .update({ raw: { ...existingRaw, _score: buildScorePayload(s) } } as never)
      .eq("id", s.id);
  }));

  return { scores, elapsed: Date.now() - start };
}
