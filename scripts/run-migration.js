/**
 * Run the lead_scores migration against the hosted Supabase project.
 * Usage: node scripts/run-migration.js <SERVICE_ROLE_KEY>
 *
 * Get your service role key from:
 * https://supabase.com/dashboard/project/pndsnffumgihndnofyzy/settings/api-keys
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const SUPABASE_URL = "https://pndsnffumgihndnofyzy.supabase.co";
const SERVICE_ROLE_KEY = process.argv[2];

if (!SERVICE_ROLE_KEY) {
  console.error("Usage: node scripts/run-migration.js <SERVICE_ROLE_KEY>");
  console.error("\nGet your service role key from:");
  console.error("https://supabase.com/dashboard/project/pndsnffumgihndnofyzy/settings/api-keys");
  process.exit(1);
}

const sql = `
CREATE TABLE IF NOT EXISTS public.lead_scores (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id     UUID        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  ai_score       NUMERIC(5,2) NOT NULL CHECK (ai_score >= 0 AND ai_score <= 100),
  lead_category  TEXT        NOT NULL CHECK (lead_category IN ('Hot', 'Warm', 'Cold')),
  confidence_score NUMERIC(5,4) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  model_version  TEXT        NOT NULL DEFAULT '1.0.0',
  features       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_scores_contact_unique UNIQUE (contact_id)
);

CREATE INDEX IF NOT EXISTS lead_scores_user_id_idx       ON public.lead_scores(user_id);
CREATE INDEX IF NOT EXISTS lead_scores_lead_category_idx ON public.lead_scores(user_id, lead_category);
CREATE INDEX IF NOT EXISTS lead_scores_ai_score_idx      ON public.lead_scores(user_id, ai_score DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_scores TO authenticated;
GRANT ALL ON public.lead_scores TO service_role;

ALTER TABLE public.lead_scores ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_scores' AND policyname='Users view own scores') THEN
    CREATE POLICY "Users view own scores" ON public.lead_scores FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_scores' AND policyname='Users insert own scores') THEN
    CREATE POLICY "Users insert own scores" ON public.lead_scores FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_scores' AND policyname='Users update own scores') THEN
    CREATE POLICY "Users update own scores" ON public.lead_scores FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_scores' AND policyname='Users delete own scores') THEN
    CREATE POLICY "Users delete own scores" ON public.lead_scores FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;
`;

async function runMigration() {
  console.log("Running lead_scores migration...");

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "apikey": SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    // Try the pg endpoint instead
    const res2 = await fetch(`${SUPABASE_URL}/pg/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "apikey": SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!res2.ok) {
      console.error("Both endpoints failed. Please run the SQL manually in Supabase SQL Editor.");
      console.log("\n--- SQL to run ---\n");
      console.log(sql);
      return;
    }
  }

  console.log("✓ Migration completed successfully!");
}

runMigration().catch((err) => {
  console.error("Migration failed:", err.message);
  console.log("\n--- Run this SQL manually in Supabase SQL Editor ---");
  console.log(`https://supabase.com/dashboard/project/pndsnffumgihndnofyzy/sql/new`);
  console.log("\n" + sql);
});
