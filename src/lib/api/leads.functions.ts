/**
 * Lead API Server Functions — Phase 1
 *
 * GET  /api/leads              → getLeads()         all leads + scores
 * GET  /api/leads/{id}         → getLead()          single lead + score
 * POST /api/leads/{id}/reprocess → reprocessLead()  re-run AI for one contact
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { classifyContact, ACTIVE_MODEL } from "@/lib/ai/classifier";
import { aiLogger } from "@/lib/ai/logger";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export type LeadCategory = "Hot" | "Warm" | "Cold";

export interface LeadWithScore {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  source: string | null;
  created_at: string;
  score: {
    ai_score: number;
    lead_category: LeadCategory;
    confidence_score: number;
    model_version: string;
    scored_at: string;
  } | null;
}

// ---------------------------------------------------------------------------
// GET /api/leads
// ---------------------------------------------------------------------------
export const getLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      category: z.enum(["Hot", "Warm", "Cold"]).optional(),
      limit:    z.number().int().min(1).max(500).optional().default(100),
      offset:   z.number().int().min(0).optional().default(0),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    aiLogger.info("getLeads", "Fetching leads", { userId, ...data });

    let query = supabase
      .from("contacts")
      .select(
        `id, email, first_name, last_name, company, source, created_at,
         lead_scores!left(ai_score, lead_category, confidence_score, model_version, created_at)`,
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    const { data: rows, error } = await query;

    if (error) {
      aiLogger.error("getLeads", "DB query failed", { error: error.message });
      throw new Error(`Failed to fetch leads: ${error.message}`);
    }

    const leads: LeadWithScore[] = (rows ?? []).map((r: Record<string, unknown>) => {
      const scoreArr = r["lead_scores"] as Record<string, unknown>[] | null;
      const s = Array.isArray(scoreArr) ? scoreArr[0] : null;
      return {
        id:         r["id"] as string,
        email:      r["email"] as string,
        first_name: r["first_name"] as string | null,
        last_name:  r["last_name"] as string | null,
        company:    r["company"] as string | null,
        source:     r["source"] as string | null,
        created_at: r["created_at"] as string,
        score: s
          ? {
              ai_score:         s["ai_score"] as number,
              lead_category:    s["lead_category"] as LeadCategory,
              confidence_score: s["confidence_score"] as number,
              model_version:    s["model_version"] as string,
              scored_at:        s["created_at"] as string,
            }
          : null,
      };
    });

    // Client-side category filter (after join)
    const filtered = data.category
      ? leads.filter((l) => l.score?.lead_category === data.category)
      : leads;

    aiLogger.info("getLeads", "Leads fetched", { count: filtered.length });

    return { leads: filtered, total: filtered.length };
  });

// ---------------------------------------------------------------------------
// GET /api/leads/{id}
// ---------------------------------------------------------------------------
export const getLead = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    aiLogger.info("getLead", "Fetching lead", { contactId: data.id, userId });

    const { data: row, error } = await supabase
      .from("contacts")
      .select(
        `id, email, first_name, last_name, company, source, phone, raw, created_at,
         lead_scores!left(ai_score, lead_category, confidence_score, model_version, features, created_at)`,
      )
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();

    if (error || !row) {
      aiLogger.warn("getLead", "Lead not found", { contactId: data.id });
      throw new Error("Lead not found");
    }

    const r = row as Record<string, unknown>;
    const scoreArr = r["lead_scores"] as Record<string, unknown>[] | null;
    const s = Array.isArray(scoreArr) ? scoreArr[0] : null;

    return {
      lead: {
        id:         r["id"] as string,
        email:      r["email"] as string,
        first_name: r["first_name"] as string | null,
        last_name:  r["last_name"] as string | null,
        company:    r["company"] as string | null,
        phone:      r["phone"] as string | null,
        source:     r["source"] as string | null,
        raw:        r["raw"] as Record<string, unknown> | null,
        created_at: r["created_at"] as string,
        score: s
          ? {
              ai_score:         s["ai_score"] as number,
              lead_category:    s["lead_category"] as LeadCategory,
              confidence_score: s["confidence_score"] as number,
              model_version:    s["model_version"] as string,
              features:         s["features"] as Record<string, unknown>,
              scored_at:        s["created_at"] as string,
            }
          : null,
      },
    };
  });

// ---------------------------------------------------------------------------
// POST /api/leads/{id}/reprocess
// ---------------------------------------------------------------------------
export const reprocessLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const start = Date.now();

    aiLogger.info("reprocessLead", "Starting reprocess", {
      contactId: data.id,
      modelVersion: ACTIVE_MODEL.version,
    });

    // 1. Fetch the contact
    const { data: contact, error: fetchErr } = await supabase
      .from("contacts")
      .select("id, email, first_name, last_name, company, source, raw")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();

    if (fetchErr || !contact) {
      aiLogger.error("reprocessLead", "Contact not found", { contactId: data.id });
      throw new Error("Contact not found");
    }

    // 2. Run classifier
    const result = classifyContact(
      {
        email:      contact.email,
        first_name: contact.first_name,
        last_name:  contact.last_name,
        company:    contact.company,
        source:     contact.source,
        raw:        contact.raw as Record<string, unknown> | null,
      },
      ACTIVE_MODEL,
    );

    aiLogger.info("reprocessLead", "Classification complete", {
      contactId: data.id,
      aiScore: result.aiScore,
      leadCategory: result.leadCategory,
      confidence: result.confidenceScore,
    });

    // 3. Upsert into lead_scores
    const { error: upsertErr } = await supabase
      .from("lead_scores")
      .upsert(
        {
          user_id:          userId,
          contact_id:       data.id,
          ai_score:         result.aiScore,
          lead_category:    result.leadCategory,
          confidence_score: result.confidenceScore,
          model_version:    result.modelVersion,
          features:         result.features as never,
        },
        { onConflict: "contact_id" },
      );

    if (upsertErr) {
      aiLogger.error("reprocessLead", "Score upsert failed", { error: upsertErr.message });
      throw new Error(`Failed to store score: ${upsertErr.message}`);
    }

    const elapsed = Date.now() - start;
    aiLogger.info("reprocessLead", "Reprocess done", { contactId: data.id, elapsedMs: elapsed });

    return {
      contactId:       data.id,
      aiScore:         result.aiScore,
      leadCategory:    result.leadCategory,
      confidenceScore: result.confidenceScore,
      modelVersion:    result.modelVersion,
      processingMs:    elapsed,
    };
  });
