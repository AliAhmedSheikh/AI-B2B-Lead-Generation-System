/**
 * Lead API — reads ai_score, lead_category, confidence_score from contacts table directly.
 * No separate lead_scores table needed.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiLogger } from "@/lib/ai/logger";

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
  } | null;
}

// ---------------------------------------------------------------------------
// GET /api/leads
// ---------------------------------------------------------------------------
export const getLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    limit:  z.number().int().min(1).max(500).optional().default(200),
    offset: z.number().int().min(0).optional().default(0),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    aiLogger.info("getLeads", "Fetching", { userId });

    const { data: rows, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (error) {
      aiLogger.error("getLeads", "Query failed", { error: error.message });
      throw new Error(`Failed to fetch leads: ${error.message}`);
    }

    const leads: LeadWithScore[] = (rows ?? []).map((r) => ({
      id:         r.id,
      email:      r.email,
      first_name: r.first_name,
      last_name:  r.last_name,
      company:    r.company,
      source:     r.source,
      created_at: r.created_at,
      score: r.lead_category
        ? {
            ai_score:         r.ai_score as number,
            lead_category:    r.lead_category as LeadCategory,
            confidence_score: r.confidence_score as number,
            model_version:    r.model_version as string,
          }
        : null,
    }));

    aiLogger.info("getLeads", "Done", { count: leads.length });
    return { leads, total: leads.length };
  });
