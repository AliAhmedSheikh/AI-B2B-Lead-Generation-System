import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enrichContact } from "@/lib/enrichment/enricher";
import { aiLogger } from "@/lib/ai/logger";

export type EnrichmentStatus = "pending" | "processing" | "completed" | "failed" | "skipped";

export interface EnrichmentProfile {
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
  error_message: string | null;
}

// Read enrichment from contacts.raw._enrichment
function getEnrichmentFromContact(contact: Record<string, unknown>): EnrichmentProfile | null {
  const raw = (contact.raw ?? {}) as Record<string, unknown>;
  const enr = raw._enrichment as Record<string, unknown> | undefined;
  if (!enr?.enrichment_status) return null;
  return {
    contact_id: contact.id as string,
    domain: (enr.domain as string) ?? null,
    company_name: (enr.company_name as string) ?? null,
    website: (enr.website as string) ?? null,
    industry: (enr.industry as string) ?? null,
    country: (enr.country as string) ?? null,
    company_description: (enr.company_description as string) ?? null,
    company_size: (enr.company_size as string) ?? null,
    logo_url: (enr.logo_url as string) ?? null,
    linkedin_url: (enr.linkedin_url as string) ?? null,
    twitter_url: (enr.twitter_url as string) ?? null,
    enrichment_status: enr.enrichment_status as EnrichmentStatus,
    enriched_at: (enr.enriched_at as string) ?? null,
    error_message: (enr.error_message as string) ?? null,
  };
}

export const getEnrichment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ contactId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, raw")
      .eq("id", data.contactId)
      .eq("user_id", userId)
      .maybeSingle();
    return { enrichment: contact ? getEnrichmentFromContact(contact) : null };
  });

export const enrichLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    contactId: z.string().uuid(),
    force: z.boolean().optional().default(false),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const start = Date.now();

    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", data.contactId)
      .eq("user_id", userId)
      .single();
    if (contactErr || !contact) throw new Error("Contact not found");

    // Check existing enrichment
    const existing = getEnrichmentFromContact(contact);
    if (existing && !data.force &&
      (existing.enrichment_status === "completed" || existing.enrichment_status === "skipped")) {
      return { status: "already_enriched", contactId: data.contactId, result: null, elapsedMs: 0 };
    }

    // Mark processing
    const raw = (contact.raw ?? {}) as Record<string, unknown>;
    const updatedRaw = { ...raw, _enrichment: { ...(raw._enrichment as Record<string, unknown> ?? {}), enrichment_status: "processing" } };
    await supabase.from("contacts").update({ raw: updatedRaw }).eq("id", data.contactId);

    // Run enrichment
    const result = await enrichContact(contact.email, contact.company);

    // Persist enrichment to raw._enrichment
    const enrichmentData = {
      domain: result.domain, company_name: result.company_name,
      website: result.website, industry: result.industry,
      country: result.country, company_description: result.company_description,
      company_size: result.company_size, logo_url: result.logo_url,
      linkedin_url: result.linkedin_url, twitter_url: result.twitter_url,
      enrichment_status: result.enrichment_status, error_message: result.error_message,
      enriched_at: new Date().toISOString(),
    };
    const finalRaw = { ...raw, _enrichment: enrichmentData };
    const { error: upsertErr } = await supabase.from("contacts").update({ raw: finalRaw }).eq("id", data.contactId);

    if (upsertErr) {
      aiLogger.error("enrichment", "Persist failed", { error: upsertErr.message });
    }

    if (result.enrichment_status === "completed" && result.company_name && !contact.company) {
      await supabase.from("contacts").update({ company: result.company_name }).eq("id", data.contactId);
    }

    const elapsed = Date.now() - start;
    return { status: result.enrichment_status, contactId: data.contactId, result, elapsedMs: elapsed };
  });

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

    const { data: allContacts, error: fetchErr } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", userId);
    if (fetchErr) throw new Error(`Failed to fetch contacts: ${fetchErr.message}`);

    let toEnrich = allContacts ?? [];

    // Filter hot leads if onlyHot is set
    if (data.onlyHot) {
      toEnrich = toEnrich.filter((c) => {
        const raw = (c.raw ?? {}) as Record<string, unknown>;
        const score = raw._score as Record<string, unknown> | undefined;
        return score?.lead_category === "Hot";
      });
    }

    // Filter already-done unless forced
    if (!data.force) {
      toEnrich = toEnrich.filter((c) => {
        const enr = getEnrichmentFromContact(c);
        return !enr || (enr.enrichment_status !== "completed" && enr.enrichment_status !== "skipped");
      });
    }

    let completed = 0, failed = 0, skipped = 0;
    const CONC = 3;

    // Process all contacts in batches of batchSize
    for (let b = 0; b < toEnrich.length; b += data.batchSize) {
      const batch = toEnrich.slice(b, b + data.batchSize);

      for (let i = 0; i < batch.length; i += CONC) {
        const chunk = batch.slice(i, i + CONC);
        const settled = await Promise.allSettled(
          chunk.map(async (contact) => {
            const result = await enrichContact(contact.email, contact.company);
            const raw = (contact.raw ?? {}) as Record<string, unknown>;
            const enrichmentData = {
              domain: result.domain, company_name: result.company_name,
              website: result.website, industry: result.industry,
              country: result.country, company_description: result.company_description,
              company_size: result.company_size, logo_url: result.logo_url,
              linkedin_url: result.linkedin_url, twitter_url: result.twitter_url,
              enrichment_status: result.enrichment_status, error_message: result.error_message,
              enriched_at: new Date().toISOString(),
            };
            await supabase.from("contacts").update({
              raw: { ...raw, _enrichment: enrichmentData },
            }).eq("id", contact.id);
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

      // Small delay between batches
      if (b + data.batchSize < toEnrich.length) await new Promise(r => setTimeout(r, 500));
    }

    const elapsed = Date.now() - start;
    const total = completed + failed + skipped;
    return { total, completed, failed, skipped, remaining: toEnrich.length - total, elapsedMs: elapsed };
  });

export const getEnrichmentStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("contacts")
      .select("raw")
      .eq("user_id", userId);

    const counts = { completed: 0, failed: 0, skipped: 0, pending: 0 };
    for (const row of data ?? []) {
      const raw = (row.raw ?? {}) as Record<string, unknown>;
      const enr = raw._enrichment as Record<string, unknown> | undefined;
      const s = (enr?.enrichment_status as string) ?? "pending";
      if (s in counts) (counts as Record<string, number>)[s]++;
    }
    return counts;
  });
