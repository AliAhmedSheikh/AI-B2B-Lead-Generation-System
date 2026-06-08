-- Add AI scoring columns to contacts table
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS ai_score           NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS lead_category      TEXT,
  ADD COLUMN IF NOT EXISTS confidence_score   NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS model_version      TEXT;

-- Index for lead_category queries
CREATE INDEX IF NOT EXISTS contacts_lead_category_idx ON public.contacts(user_id, lead_category);

NOTIFY pgrst, 'reload schema';
