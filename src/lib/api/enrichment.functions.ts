/**
 * Lead Enrichment API — Phase 2
 *
 * GET  /api/leads/:id/enrichment     → getEnrichment()
 * POST /api/leads/:id/enrich         → enrichLead()
 * POST /api/leads/enrich/bulk        → enrichBulk()
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enrichContact } from "@/lib/enrichment/enricher";
import { aiLogger } from "@/lib/ai/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Schema cache helper — sends NOTIFY pgrst before first table access
// ---------------------------------------------------------------------------
async function reloadSchema(supabase: SupabaseClient) {
  try {
    await supabase.rpc("pg_notify" as never, { channel: "pgrst", payload: "reload schema" });
    await new Promise(r => setTimeout(r, 800));
  } catch { /* best-effort */ }
}

function isSchemaError(msg: string) {
  return msg.includes("schema cache") || msg.includes("does not exist") || msg.includes("PGRST205");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type EnrichmentStatus = "pending" | "processing" | "completed" | "failed" | "skipped";

export interface EnrichmentProfile {
  id: string;
  contact_id: string;
  domain: string | null;
  company_name: string | null;
  website: string | null;
  industry: string | null;
  country: string | null;
  company_description: string | null;
  company_size: string | null;
  logo_url: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  enrichment_status: EnrichmentStatus;
  enriched_at: string | null;
  created_at: string;
  error_message: string | null;
}

// ---------------------------------------------------------------------------
// Upsert helper with schema-cache retry
// ---------------------------------------------------------------------------
async function upsertEnrichment(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from("lead_enrichment").upsert(row, { onConflict: "contact_id" });
  if (error && isSchemaError(error.message)) {
    await reloadSchema(supabase);
    const retry = await supabase.from("lead_enrichment").upsert(row, { onConflict: "contact_id" });
    return retry;
  }
  return { error };
}

// ---------------------------------------------------------------------------
// GET /api/leads/:id/enrichment
// ---------------------------------------------------------------------------
export const getEnrichment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ contactId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    aiLogger.info("enrichment", "Fetching enrichment", { contactId: data.contactId });
    await reloadSchema(supabase);

    const { data: row, error } = await supabase
      .from("lead_enrichment")
      .select("*")
      .eq("contact_id", data.contactId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (isSchemaError(error.message)) return { enrichment: null };
      throw new Error(`Failed to fetch enrichment: ${error.message}`);
    }
    return { enrichment: row as EnrichmentProfile | null };
  });

// ---------------------------------------------------------------------------
// POST /api/leads/:id/enrich
// ---------------------------------------------------------------------------
export const enrichLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    contactId: z.string().uuid(),
    force: z.boolean().optional().default(false),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const start = Date.now();
    aiLogger.info("enrichment", "Enriching lead", { contactId: data.contactId });
    await reloadSchema(supabase);

    // Fetch contact
    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", data.contactId)
      .eq("user_id", userId)
      .single();
    if (contactErr || !contact) throw new Error("Contact not found");

    // Check existing enrichment
    const { data: existing } = await supabase
      .from("lead_enrichment")
      .select("id, enrichment_status")
      .eq("contact_id", data.contactId)
      .maybeSingle();

    if (existing && !data.force &&
      (existing.enrichment_status === "completed" || existing.enrichment_status === "skipped")) {
      aiLogger.info("enrichment", "Already enriched — skipping", { contactId: data.contactId });
      return { status: "already_enriched", contactId: data.contactId, result: null, elapsedMs: 0 };
    }

    // Mark processing
    await upsertEnrichment(supabase, { user_id: userId, contact_id: data.contactId, enrichment_status: "processing" });

    // Run enrichment
    const result = await enrichContact(contact.email, contact.company);

    // Persist
    const upsertRow = {
      user_id: userId, contact_id: data.contactId,
      domain: result.domain, company_name: result.company_name,
      website: result.website, industry: result.industry,
      country: result.country, company_description: result.company_description,
      company_size: result.company_size, logo_url: result.logo_url,
      linkedin_url: result.linkedin_url, twitter_url: result.twitter_url,
      enrichment_status: result.enrichment_status, error_message: result.error_message,
      enriched_at: new Date().toISOString(),
    };
    const { error: upsertErr } = await upsertEnrichment(supabase, upsertRow);

    if (upsertErr) {
      aiLogger.error("enrichment", "Persist failed", { error: upsertErr.message });
      // Return result anyway — data is useful even without DB storage
    }

    // Also update contacts.company if empty
    if (result.enrichment_status === "completed" && result.company_name && !contact.company) {
      await supabase.from("contacts").update({ company: result.company_name }).eq("id", data.contactId);
    }

    const elapsed = Date.now() - start;
    aiLogger.info("enrichment", "Enriched", { contactId: data.contactId, status: result.enrichment_status, elapsed });
    return { status: result.enrichment_status, contactId: data.contactId, result, elapsedMs: elapsed };
  });

// ---------------------------------------------------------------------------
// POST /api/leads/enrich/bulk
// ---------------------------------------------------------------------------
export const enrichBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    force:     z.boolean().optional().default(false),
    onlyHot:   z.boolean().optional().default(false),
    batchSize: z.number().int().min(1).max(50).optional().default(20),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const start = Date.now();
    aiLogger.info("enrichment", "Bulk enrichment start", { userId, onlyHot: data.onlyHot });
    await reloadSchema(supabase);

    // Fetch contacts
    let query = supabase.from("contacts").select("*").eq("user_id", userId);
    if (data.onlyHot) query = query.eq("lead_category", "Hot");
    const { data: allContacts, error: fetchErr } = await query;
    if (fetchErr) throw new Error(`Failed to fetch contacts: ${fetchErr.message}`);

    let toEnrich = allContacts ?? [];

    // Filter already-done unless forced
    if (!data.force) {
      const { data: done } = await supabase
        .from("lead_enrichment")
        .select("contact_id")
        .eq("user_id", userId)
        .in("enrichment_status", ["completed", "skipped"]);
      if (done) {
        const doneIds = new Set(done.map((r) => r.contact_id));
        toEnrich = toEnrich.filter((c) => !doneIds.has(c.id));
      }
    }

    const batch = toEnrich.slice(0, data.batchSize);
    aiLogger.info("enrichment", `Enriching batch of ${batch.length}`, { total: toEnrich.length });

    let completed = 0, failed = 0, skipped = 0;

    // Concurrency limit of 3
    const CONC = 3;
    for (let i = 0; i < batch.length; i += CONC) {
      const chunk = batch.slice(i, i + CONC);
      const settled = await Promise.allSettled(
        chunk.map(async (contact) => {
          const result = await enrichContact(contact.email, contact.company);
          const row = {
            user_id: userId, contact_id: contact.id,
            domain: result.domain, company_name: result.company_name,
            website: result.website, industry: result.industry,
            country: result.country, company_description: result.company_description,
            company_size: result.company_size, logo_url: result.logo_url,
            linkedin_url: result.linkedin_url, twitter_url: result.twitter_url,
            enrichment_status: result.enrichment_status, error_message: result.error_message,
            enriched_at: new Date().toISOString(),
          };
          await upsertEnrichment(supabase, row);
          return result.enrichment_status;
        }),
      );
      for (const r of settled) {
        if (r.status === "fulfilled") {
          if (r.value === "completed") completed++;
          else if (r.value === "skipped") skipped++;
          else failed++;
        } else { failed++; }
      }
      if (i + CONC < batch.length) await new Promise(r => setTimeout(r, 300));
    }

    const elapsed = Date.now() - start;
    aiLogger.info("enrichment", "Bulk done", { completed, failed, skipped, elapsed });
    return { total: batch.length, completed, failed, skipped, remaining: toEnrich.length - batch.length, elapsedMs: elapsed };
  });

// ---------------------------------------------------------------------------
// GET enrichment stats
// ---------------------------------------------------------------------------
export const getEnrichmentStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("lead_enrichment")
      .select("enrichment_status")
      .eq("user_id", userId);

    if (error) return { completed: 0, failed: 0, skipped: 0, pending: 0 };
    const counts = { completed: 0, failed: 0, skipped: 0, pending: 0 };
    for (const row of data ?? []) {
      const s = row.enrichment_status as keyof typeof counts;
      if (s in counts) counts[s]++;
    }
    return counts;
  });
