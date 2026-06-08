import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TEMPLATE_TYPES, type TemplateType } from "@/lib/email/template-engine";
import { aiLogger } from "@/lib/ai/logger";

export interface TemplateRecord {
  id: string;
  user_id: string;
  name: string;
  template_type: string;
  subject_template: string;
  body_template: string;
  created_at: string;
  updated_at: string;
}

const templateSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  template_type: z.string().refine((v) => TEMPLATE_TYPES.some(t => t.value === v), {
    message: "Invalid template type",
  }),
  subject_template: z.string().default(""),
  body_template: z.string().default(""),
});

const SCHEMA_ERR = "Could not find the table";

async function query<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes(SCHEMA_ERR)) {
      aiLogger.info("templates", `Schema stale on "${label}", waiting 5s then retrying`);
      await new Promise(r => setTimeout(r, 5000));
      return await fn();
    }
    throw err;
  }
}

export const getTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ type: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return query("getTemplates", async () => {
      let q = supabase
        .from("templates")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (data.type) q = q.eq("template_type", data.type);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      return { templates: rows as TemplateRecord[] };
    });
  });

export const getTemplateById = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return query("getTemplateById", async () => {
      const { data: row, error } = await supabase
        .from("templates")
        .select("*")
        .eq("id", data.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { template: row as TemplateRecord | null };
    });
  });

export const createTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(templateSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return query("createTemplate", async () => {
      const { data: row, error } = await supabase
        .from("templates")
        .insert({ ...data, user_id: userId } as never)
        .select()
        .single();
      if (error) {
        aiLogger.error("templates", "Create failed", { error: error.message });
        throw new Error(error.message);
      }
      return { template: row as TemplateRecord };
    });
  });

export const updateTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    id: z.string().uuid(),
    data: templateSchema.partial(),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return query("updateTemplate", async () => {
      const { data: row, error } = await supabase
        .from("templates")
        .update({ ...data.data, updated_at: new Date().toISOString() } as never)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("Template not found");
      return { template: row as TemplateRecord };
    });
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return query("deleteTemplate", async () => {
      const { error } = await supabase
        .from("templates")
        .delete()
        .eq("id", data.id)
        .eq("user_id", userId);
      if (error) {
        aiLogger.error("templates", "Delete failed", { error: error.message });
        throw new Error(error.message);
      }
      return { success: true };
    });
  });

export const duplicateTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return query("duplicateTemplate", async () => {
      const { data: original, error: fetchErr } = await supabase
        .from("templates")
        .select("*")
        .eq("id", data.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (fetchErr || !original) throw new Error("Template not found");
      const now = new Date().toISOString();
      const { data: row, error } = await supabase
        .from("templates")
        .insert({
          user_id: userId,
          name: `${original.name} (Copy)`,
          template_type: original.template_type,
          subject_template: original.subject_template,
          body_template: original.body_template,
          created_at: now,
          updated_at: now,
        } as never)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { template: row as TemplateRecord };
    });
  });
