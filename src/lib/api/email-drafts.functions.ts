import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { replaceTemplateVars, buildTemplateVars } from "@/lib/email/template-engine";
import { personalizeEmail, type PersonalizationInput } from "@/lib/email/personalizer";
import { aiLogger } from "@/lib/ai/logger";

export interface DraftRecord {
  id: string;
  user_id: string;
  contact_id: string;
  template_id: string;
  subject: string;
  email_body: string;
  generation_status: string;
  created_at: string;
  error_message: string | null;
  metadata: Record<string, string | boolean | number> | null;
}

const SCHEMA_ERR = "Could not find the table";

async function query<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes(SCHEMA_ERR)) {
      aiLogger.info("email-drafts", `Schema stale on "${label}", waiting 5s then retrying`);
      await new Promise(r => setTimeout(r, 5000));
      return await fn();
    }
    throw err;
  }
}

export const generateEmailDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    contactId: z.string().uuid(),
    templateId: z.string().uuid(),
    senderName: z.string().optional(),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const start = Date.now();

    // Fetch contact (contacts table works fine — no retry needed)
    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", data.contactId)
      .eq("user_id", userId)
      .single();
    if (contactErr || !contact) throw new Error("Contact not found");

    // Fetch template with retry
    const template = await query("fetchTemplate", async () => {
      const { data: t, error: e } = await supabase
        .from("templates")
        .select("*")
        .eq("id", data.templateId)
        .eq("user_id", userId)
        .single();
      if (e || !t) throw new Error("Template not found");
      return t;
    });

    const raw = (contact.raw ?? {}) as Record<string, unknown>;
    const score = raw._score as Record<string, unknown> | undefined;
    const enrichment = raw._enrichment as Record<string, unknown> | undefined;

    const vars = buildTemplateVars(
      contact,
      enrichment ? {
        industry: enrichment.industry as string,
        country: enrichment.country as string,
        company_name: enrichment.company_name as string,
      } : null,
      score ? {
        ai_score: score.ai_score as number,
        lead_category: score.lead_category as string,
      } : null,
      data.senderName,
    );
    const leadCategory = score?.lead_category as string ?? "Cold";

    const personalizationInput: PersonalizationInput = {
      firstName: vars.first_name,
      lastName: vars.last_name,
      companyName: vars.company_name,
      industry: vars.industry,
      country: vars.country,
      leadScore: vars.lead_score,
      leadCategory,
      subjectTemplate: template.subject_template ?? "",
      bodyTemplate: template.body_template ?? "",
      companyDescription: (enrichment?.company_description as string) ?? "",
    };

    let subject: string;
    let emailBody: string;
    let personalized = false;
    try {
      const result = personalizeEmail(personalizationInput);
      subject = result.subject;
      emailBody = result.body;
      personalized = result.personalized;
    } catch {
      subject = replaceTemplateVars(template.subject_template ?? "", vars);
      emailBody = replaceTemplateVars(template.body_template ?? "", vars);
    }

    // Insert draft with retry
    const draft = await query("insertDraft", async () => {
      const { data: d, error: e } = await supabase
        .from("email_drafts")
        .insert({
          user_id: userId,
          contact_id: data.contactId,
          template_id: data.templateId,
          subject,
          email_body: emailBody,
          generation_status: "completed",
          metadata: { personalized, lead_category: leadCategory, template_type: template.template_type },
        } as never)
        .select()
        .single();
      if (e) {
        aiLogger.error("email-drafts", "Insert failed", { error: e.message });
        throw new Error(e.message);
      }
      return d as DraftRecord;
    });

    const elapsed = Date.now() - start;
    aiLogger.info("email-drafts", "Draft generated", {
      contactId: data.contactId, templateId: data.templateId, personalized, elapsedMs: elapsed,
    });
    return { draft, personalized, elapsedMs: elapsed };
  });

export const generateBulkDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    contactIds: z.array(z.string().uuid()).min(1).max(100),
    templateId: z.string().uuid(),
    senderName: z.string().optional(),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const start = Date.now();

    const { data: contacts, error: fetchErr } = await supabase
      .from("contacts")
      .select("*")
      .in("id", data.contactIds)
      .eq("user_id", userId);
    if (fetchErr) throw new Error("Failed to fetch contacts");

    const template = await query("fetchBulkTemplate", async () => {
      const { data: t, error: e } = await supabase
        .from("templates")
        .select("*")
        .eq("id", data.templateId)
        .eq("user_id", userId)
        .single();
      if (e || !t) throw new Error("Template not found");
      return t;
    });

    let completed = 0, failed = 0;
    const drafts: DraftRecord[] = [];
    const CONC = 5;

    for (let i = 0; i < (contacts?.length ?? 0); i += CONC) {
      const chunk = (contacts ?? []).slice(i, i + CONC);
      const settled = await Promise.allSettled(
        chunk.map(async (contact) => {
          const raw = (contact.raw ?? {}) as Record<string, unknown>;
          const score = raw._score as Record<string, unknown> | undefined;
          const enrichment = raw._enrichment as Record<string, unknown> | undefined;

          const vars = buildTemplateVars(contact, enrichment ? {
            industry: enrichment.industry as string,
            country: enrichment.country as string,
            company_name: enrichment.company_name as string,
          } : null, score ? {
            ai_score: score.ai_score as number,
            lead_category: score.lead_category as string,
          } : null, data.senderName);

          const leadCategory = score?.lead_category as string ?? "Cold";
          const input: PersonalizationInput = {
            firstName: vars.first_name, lastName: vars.last_name,
            companyName: vars.company_name, industry: vars.industry,
            country: vars.country, leadScore: vars.lead_score,
            leadCategory, subjectTemplate: template.subject_template ?? "",
            bodyTemplate: template.body_template ?? "",
            companyDescription: (enrichment?.company_description as string) ?? "",
          };
          const result = personalizeEmail(input);

          const { data: draft } = await supabase
            .from("email_drafts")
            .insert({
              user_id: userId, contact_id: contact.id,
              template_id: data.templateId, subject: result.subject,
              email_body: result.body, generation_status: "completed",
              metadata: { personalized: true, lead_category: leadCategory, template_type: template.template_type },
            } as never)
            .select()
            .single();

          return draft as DraftRecord;
        }),
      );
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) { completed++; drafts.push(r.value); }
        else failed++;
      }
    }

    const elapsed = Date.now() - start;
    aiLogger.info("email-drafts", "Bulk generation done", {
      completed, failed, elapsedMs: elapsed,
    });
    return { drafts, completed, failed, elapsedMs: elapsed };
  });

export const getDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    limit: z.number().int().min(1).max(100).optional().default(50),
    offset: z.number().int().min(0).optional().default(0),
    contactId: z.string().uuid().optional(),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return query("getDrafts", async () => {
      let q = supabase
        .from("email_drafts")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(data.offset, data.offset + data.limit - 1);
      if (data.contactId) q = q.eq("contact_id", data.contactId);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      return { drafts: rows as DraftRecord[], total: (rows ?? []).length };
    });
  });

export const getDraftById = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return query("getDraftById", async () => {
      const { data: row, error } = await supabase
        .from("email_drafts")
        .select("*")
        .eq("id", data.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { draft: row as DraftRecord | null };
    });
  });

export const deleteDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return query("deleteDraft", async () => {
      const { error } = await supabase
        .from("email_drafts")
        .delete()
        .eq("id", data.id)
        .eq("user_id", userId);
      if (error) {
        aiLogger.error("email-drafts", "Delete failed", { error: error.message });
        throw new Error(error.message);
      }
      return { success: true };
    });
  });
