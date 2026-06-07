import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RowSchema = z.record(z.string(), z.any());

const ImportInput = z.object({
  fileName:   z.string().min(1).max(255),
  fileType:   z.string().min(1).max(50),
  rows:       z.array(RowSchema).min(1).max(5000), // max 5k rows per chunk
  chunkIndex: z.number().int().min(0).optional().default(0),
  totalChunks:z.number().int().min(1).optional().default(1),
  logId:      z.string().uuid().optional(),        // reuse existing log across chunks
});

function pick(row: Record<string, unknown>, keys: string[]): string | null {
  const lower: Record<string, unknown> = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase().trim()] = row[k];
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

// Extended list of email column name aliases found in real-world datasets
const EMAIL_KEYS = [
  "email", "e-mail", "mail", "email_address", "emailaddress",
  "email address",          // ← this dataset uses "Email Address"
  "work_email", "work email", "business_email", "business email",
  "corporate_email", "contact_email", "primary_email",
  "person_email", "user_email", "email1", "email_1", "email 1",
  "electronic_mail", "e_mail", "emailid", "email_id",
  "email id", "email-address", "email (work)", "work e-mail",
];

/**
 * Find the email value in a row.
 * 1. Try all known column name aliases (case-insensitive).
 * 2. Auto-detect: scan all columns for the first value that looks like an email.
 */
function findEmail(row: Record<string, unknown>): string | null {
  // Step 1: named aliases
  const byName = pick(row, EMAIL_KEYS);
  if (byName) return byName;

  // Step 2: auto-detect any column whose value matches email pattern
  for (const v of Object.values(row)) {
    const s = String(v ?? "").trim().toLowerCase();
    if (s && s.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      return s;
    }
  }
  return null;
}

export const importContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ImportInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    type Contact = {
      user_id: string; email: string;
      first_name: string | null; last_name: string | null;
      company: string | null; phone: string | null;
      source: string | null; raw: Record<string, unknown>;
    };

    // Normalise + validate + dedupe within this chunk
    const seen = new Set<string>();
    let invalid = 0, dupesInFile = 0;
    const normalized: Contact[] = [];

    for (const row of data.rows) {
      const rawEmail = findEmail(row);
      if (!rawEmail) { invalid++; continue; }
      const email = rawEmail.toLowerCase();
      if (!emailRegex.test(email)) { invalid++; continue; }
      if (seen.has(email)) { dupesInFile++; continue; }
      seen.add(email);
      normalized.push({
        user_id: userId, email,
        // Name fields — support "Decision Maker Name", "Full Name", "Name", etc.
        first_name: pick(row, [
          "first_name", "firstname", "first name", "given_name", "fname", "first",
          "decision maker name", "decision_maker_name", "contact name", "contact_name",
          "full name", "full_name", "name", "person name", "person_name",
        ]),
        last_name: pick(row, [
          "last_name", "lastname", "last name", "surname", "family_name", "lname", "last",
        ]),
        company: pick(row, [
          "company", "organization", "organisation", "employer", "company_name",
          "account_name", "account", "firm", "business", "business_name",
          "company name", "organisation name", "organization name",
        ]),
        phone: pick(row, [
          "phone", "phone_number", "mobile", "telephone", "tel", "cell",
          "contact_number", "work_phone", "direct_phone", "phone1",
          "phone number", "mobile number",
        ]),
        source: pick(row, [
          "source", "channel", "origin", "lead_source", "referral", "lead source",
        ]),
        raw: row,
      });
    }

    let inserted = 0, dupesInDb = 0;
    let status = "completed";
    let errorMessage: string | null = null;

    if (normalized.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < normalized.length; i += chunkSize) {
        const chunk = normalized.slice(i, i + chunkSize);
        const { data: ret, error } = await supabase
          .from("contacts")
          .upsert(chunk as never, { onConflict: "user_id,email", ignoreDuplicates: true })
          .select("id");
        if (error) { status = "failed"; errorMessage = error.message; break; }
        inserted += ret?.length ?? 0;
        dupesInDb += chunk.length - (ret?.length ?? 0);
      }
    }

    const duplicates = dupesInFile + dupesInDb;
    const isLastChunk = data.chunkIndex === data.totalChunks - 1;

    // Only write / update the import log on the first and last chunk
    let logId = data.logId ?? null;
    if (!logId) {
      // First chunk — create the log
      const { data: log } = await supabase.from("import_logs").insert({
        user_id: userId, file_name: data.fileName, file_type: data.fileType,
        total_rows: 0, inserted_count: inserted,
        duplicate_count: duplicates, invalid_count: invalid,
        status: isLastChunk ? status : "processing",
      }).select("id").single();
      logId = log?.id ?? null;
    } else {
      // Subsequent chunks — increment counters
      await supabase.rpc("increment_import_log" as never, {
        p_log_id:    logId,
        p_inserted:  inserted,
        p_dupes:     duplicates,
        p_invalid:   invalid,
        p_status:    isLastChunk ? status : "processing",
      }).catch(() => {
        // RPC may not exist — do a simple update instead
        supabase.from("import_logs").select("inserted_count,duplicate_count,invalid_count")
          .eq("id", logId!).single().then(({ data: cur }) => {
            if (cur) {
              supabase.from("import_logs").update({
                inserted_count:  (cur.inserted_count  ?? 0) + inserted,
                duplicate_count: (cur.duplicate_count ?? 0) + duplicates,
                invalid_count:   (cur.invalid_count   ?? 0) + invalid,
                status: isLastChunk ? status : "processing",
              }).eq("id", logId!);
            }
          });
      });
    }

    return {
      logId,
      chunkIndex:  data.chunkIndex,
      totalChunks: data.totalChunks,
      inserted,
      duplicates,
      invalid,
      status,
      errorMessage,
      isLastChunk,
    };
  });

// ---------------------------------------------------------------------------
// Delete leads
// ---------------------------------------------------------------------------
export const deleteLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    contactIds: z.array(z.string().uuid()).optional(), // specific IDs
    deleteAll:  z.boolean().optional().default(false), // delete everything
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.deleteAll) {
      const { error } = await supabase
        .from("contacts")
        .delete()
        .eq("user_id", userId);
      if (error) throw new Error(`Delete failed: ${error.message}`);
      return { deleted: -1 }; // -1 = all
    }

    if (!data.contactIds?.length) throw new Error("No contact IDs provided");

    const { data: deleted, error } = await supabase
      .from("contacts")
      .delete()
      .eq("user_id", userId)
      .in("id", data.contactIds)
      .select("id");

    if (error) throw new Error(`Delete failed: ${error.message}`);
    return { deleted: deleted?.length ?? 0 };
  });
