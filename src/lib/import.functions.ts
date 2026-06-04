import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { classifyImportedContacts } from "@/lib/ai/pipeline";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RowSchema = z.record(z.string(), z.any());

const ImportInput = z.object({
  fileName: z.string().min(1).max(255),
  fileType: z.string().min(1).max(50),
  rows: z.array(RowSchema).min(1).max(50000),
});

// Map a row's keys (case-insensitive) to a canonical contact shape.
function pick(row: Record<string, unknown>, keys: string[]): string | null {
  const lower: Record<string, unknown> = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase().trim()] = row[k];
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return null;
}

export const importContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ImportInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const totalRows = data.rows.length;

    // Normalize + validate + dedupe within the file
    const seen = new Set<string>();
    let invalid = 0;
    let dupesInFile = 0;

    type Contact = {
      user_id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      company: string | null;
      phone: string | null;
      source: string | null;
      // Stored as jsonb; cast at insert site.
      raw: Record<string, unknown>;
    };

    const normalized: Contact[] = [];

    for (const row of data.rows) {
      const rawEmail = pick(row, ["email", "e-mail", "mail", "email_address"]);
      if (!rawEmail) {
        invalid++;
        continue;
      }
      const email = rawEmail.toLowerCase();
      if (!emailRegex.test(email)) {
        invalid++;
        continue;
      }
      if (seen.has(email)) {
        dupesInFile++;
        continue;
      }
      seen.add(email);

      normalized.push({
        user_id: userId,
        email,
        first_name: pick(row, ["first_name", "firstname", "first name", "given_name"]),
        last_name: pick(row, ["last_name", "lastname", "last name", "surname", "family_name"]),
        company: pick(row, ["company", "organization", "organisation", "employer"]),
        phone: pick(row, ["phone", "phone_number", "mobile", "telephone"]),
        source: pick(row, ["source", "channel", "origin"]),
        raw: row,
      });
    }

    let inserted = 0;
    let dupesInDb = 0;
    let status = "completed";
    let errorMessage: string | null = null;

    if (normalized.length > 0) {
      // Chunk inserts; rely on UNIQUE(user_id,email) for cross-import dedupe.
      const chunkSize = 500;
      for (let i = 0; i < normalized.length; i += chunkSize) {
        const chunk = normalized.slice(i, i + chunkSize);
        const { data: ret, error } = await supabase
          .from("contacts")
          .upsert(chunk as never, { onConflict: "user_id,email", ignoreDuplicates: true })
          .select("id");
        if (error) {
          status = "failed";
          errorMessage = error.message;
          break;
        }
        const insertedHere = ret?.length ?? 0;
        inserted += insertedHere;
        dupesInDb += chunk.length - insertedHere;
      }
    }

    const duplicates = dupesInFile + dupesInDb;

    const { data: log, error: logError } = await supabase
      .from("import_logs")
      .insert({
        user_id: userId,
        file_name: data.fileName,
        file_type: data.fileType,
        total_rows: totalRows,
        inserted_count: inserted,
        duplicate_count: duplicates,
        invalid_count: invalid,
        status,
        error_message: errorMessage,
      })
      .select("id")
      .single();

    if (logError) {
      console.error("Failed to write import log", logError);
    }

    // Trigger AI classification pipeline for newly imported contacts
    if (status === "completed" && inserted > 0) {
      try {
        await classifyImportedContacts({ data: { importLogId: log?.id ?? undefined } });
      } catch (pipelineErr) {
        // Non-fatal — import still succeeded; scoring can be retried from dashboard
        console.error("[AI Pipeline] Post-import classification failed:", pipelineErr);
      }
    }

    return {
      logId: log?.id ?? null,
      totalRows,
      inserted,
      duplicates,
      invalid,
      status,
      errorMessage,
    };
  });
