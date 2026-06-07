-- Phase 2: Lead Enrichment table
CREATE TABLE IF NOT EXISTS public.lead_enrichment (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id          UUID        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  domain              TEXT,
  company_name        TEXT,
  website             TEXT,
  industry            TEXT,
  country             TEXT,
  company_description TEXT,
  company_size        TEXT,
  logo_url            TEXT,
  linkedin_url        TEXT,
  twitter_url         TEXT,
  enrichment_status   TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (enrichment_status IN ('pending','processing','completed','failed','skipped')),
  enriched_at         TIMESTAMPTZ,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_enrichment_contact_unique UNIQUE (contact_id)
);

CREATE INDEX IF NOT EXISTS lead_enrichment_user_id_idx    ON public.lead_enrichment(user_id);
CREATE INDEX IF NOT EXISTS lead_enrichment_status_idx     ON public.lead_enrichment(user_id, enrichment_status);
CREATE INDEX IF NOT EXISTS lead_enrichment_domain_idx     ON public.lead_enrichment(domain);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_enrichment TO authenticated;
GRANT ALL ON public.lead_enrichment TO service_role;

ALTER TABLE public.lead_enrichment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own enrichment"   ON public.lead_enrichment
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own enrichment" ON public.lead_enrichment
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own enrichment" ON public.lead_enrichment
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own enrichment" ON public.lead_enrichment
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
