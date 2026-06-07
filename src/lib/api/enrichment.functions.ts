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
// GET /api/leads/:id/enrichment
// ---------------------------------------------------------------------------
export const getEnrichment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ contactId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    aiLogger.info("enrichment", "Fetching enrichment", { contactId: data.contactId });

    const { data: row, error } = await supabase
      .from("lead_enrichment")
      .select("*")
      .eq("contact_id", data.contactId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      aiLogger.error("enrichment", "Fetch failed", { error: error.message });
      throw new Error(`Failed to fetch enrichment: ${error.message}`);
    }

    return { enrichment: row as EnrichmentProfile | null };
  });

// ---------------------------------------------------------------------------
// POST /api/leads/:id/enrich  — enrich a single lead
// ---------------------------------------------------------------------------
export const enrichLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    contactId: z.string().uuid(),
    force:     z.boolean().optional().default(false), // re-enrich even if already done
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const start = Date.now();

    aiLogger.info("enrichment", "Enriching lead", { contactId: data.contactId });

    // Fetch contact
    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", data.contactId)
      .eq("user_id", userId)
      .single();

    if (contactErr || !contact) {
      throw new Error("Contact not found");
    }

    // Check for existing enrichment (skip if already done and not forced)
    const { data: existing } = await supabase
      .from("lead_enrichment")
      .select("id, enrichment_status")
      .eq("contact_id", data.contactId)
      .maybeSingle();

    if (existing && !data.force &&
      (existing.enrichment_status === "completed" || existing.enrichment_status === "skipped")) {
      aiLogger.info("enrichment", "Already enriched — skipping", { contactId: data.contactId });
      return { status: "already_enriched", contactId: data.contactId };
    }

    // Mark as processing
    await supabase.from("lead_enrichment").upsert({
      user_id:           userId,
      contact_id:        data.contactId,
      enrichment_status: "processing",
    }, { onConflict: "contact_id" });

    // Run enrichment
    const result = await enrichContact(
      contact.email,
      contact.company,
    );

    // Persist result
    const { error: upsertErr } = await supabase
      .from("lead_enrichment")
      .upsert({
        user_id:             userId,
        contact_id:          data.contactId,
        domain:              result.domain,
        company_name:        result.company_name,
        website:             result.website,
        industry:            result.industry,
        country:             result.country,
        company_description: result.company_description,
        company_size:        result.company_size,
        logo_url:            result.logo_url,
        linkedin_url:        result.linkedin_url,
        twitter_url:         result.twitter_url,
        enrichment_status:   result.enrichment_status,
        error_message:       result.error_message,
        enriched_at:         new Date().toISOString(),
      }, { onConflict: "contact_id" });

    if (upsertErr) {
      aiLogger.error("enrichment", "Persist failed", { error: upsertErr.message });
      throw new Error(`Failed to save enrichment: ${upsertErr.message}`);
    }

    // Also update contacts table with enriched company/industry/country
    if (result.enrichment_status === "completed") {
      await supabase.from("contacts").update({
        ...(result.company_name && !contact.company ? { company: result.company_name } : {}),
      }).eq("id", data.contactId);
    }

    const elapsed = Date.now() - start;
    aiLogger.info("enrichment", "Lead enriched", {
      contactId: data.contactId,
      status: result.enrichment_status,
      elapsedMs: elapsed,
    });

    return {
      status:     result.enrichment_status,
      contactId:  data.contactId,
      result,
      elapsedMs:  elapsed,
    };
  });

// ---------------------------------------------------------------------------
// POST /api/leads/enrich/bulk — enrich all unenriched leads
// ---------------------------------------------------------------------------
export const enrichBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    force:      z.boolean().optional().default(false),
    onlyHot:    z.boolean().optional().default(false), // only enrich Hot leads
    batchSize:  z.number().int().min(1).max(50).optional().default(20),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const start = Date.now();

    aiLogger.info("enrichment", "Starting bulk enrichment", {
      userId, force: data.force, onlyHot: data.onlyHot,
    });

    // Fetch contacts to enrich
    let query = supabase
      .from("contacts")
      .select("*")
      .eq("user_id", userId);

    if (data.onlyHot) {
      query = query.eq("lead_category", "Hot");
    }

    const { data: allContacts, error: fetchErr } = await query;
    if (fetchErr) throw new Error(`Failed to fetch contacts: ${fetchErr.message}`);

    const contacts = allContacts ?? [];

    // If not forced, exclude already-enriched contacts
    let toEnrich = contacts;
    if (!data.force) {
      const { data: alreadyDone } = await supabase
        .from("lead_enrichment")
        .select("contact_id")
        .eq("user_id", userId)
        .in("enrichment_status", ["completed", "skipped"]);

      const doneIds = new Set((alreadyDone ?? []).map((r) => r.contact_id));
      toEnrich = contacts.filter((c) => !doneIds.has(c.id));
    }

    // Respect batch size
    const batch = toEnrich.slice(0, data.batchSize);

    aiLogger.info("enrichment", `Enriching ${batch.length} contacts`, {
      total: toEnrich.length, batch: batch.length,
    });

    let completed = 0;
    let failed = 0;
    let skipped = 0;
    const results: Array<{ contactId: string; status: string }> = [];

    // Process with concurrency limit of 3 to avoid rate limits
    const CONCURRENCY = 3;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const chunk = batch.slice(i, i + CONCURRENCY);

      const chunkResults = await Promise.allSettled(
        chunk.map(async (contact) => {
          const result = await enrichContact(contact.email, contact.company);

          await supabase.from("lead_enrichment").upsert({
            user_id:             userId,
            contact_id:          contact.id,
            domain:              result.domain,
            company_name:        result.company_name,
            website:             result.website,
            industry:            result.industry,
            country:             result.country,
            company_description: result.company_description,
            company_size:        result.company_size,
            logo_url:            result.logo_url,
            linkedin_url:        result.linkedin_url,
            twitter_url:         result.twitter_url,
            enrichment_status:   result.enrichment_status,
            error_message:       result.error_message,
            enriched_at:         new Date().toISOString(),
          }, { onConflict: "contact_id" });

          return { contactId: contact.id, status: result.enrichment_status };
        }),
      );

      for (const r of chunkResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
          if (r.value.status === "completed") completed++;
          else if (r.value.status === "skipped") skipped++;
          else failed++;
        } else {
          failed++;
        }
      }

      // Small delay between chunks to avoid overwhelming APIs
      if (i + CONCURRENCY < batch.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    const elapsed = Date.now() - start;
    aiLogger.info("enrichment", "Bulk enrichment done", {
      completed, failed, skipped, elapsedMs: elapsed,
    });

    return {
      total:     batch.length,
      completed,
      failed,
      skipped,
      remaining: toEnrich.length - batch.length,
      elapsedMs: elapsed,
      results,
    };
  });

// ---------------------------------------------------------------------------
// GET enrichment stats for the dashboard
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
