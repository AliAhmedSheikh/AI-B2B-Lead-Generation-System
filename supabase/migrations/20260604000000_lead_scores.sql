-- lead_scores: stores AI classification results per contact
CREATE TABLE public.lead_scores (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id     UUID        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  ai_score       NUMERIC(5,2) NOT NULL CHECK (ai_score >= 0 AND ai_score <= 100),
  lead_category  TEXT        NOT NULL CHECK (lead_category IN ('Hot', 'Warm', 'Cold')),
  confidence_score NUMERIC(5,4) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  model_version  TEXT        NOT NULL DEFAULT '1.0.0',
  features       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- one score row per contact (latest wins via upsert)
  CONSTRAINT lead_scores_contact_unique UNIQUE (contact_id)
);

CREATE INDEX lead_scores_user_id_idx       ON public.lead_scores(user_id);
CREATE INDEX lead_scores_lead_category_idx ON public.lead_scores(user_id, lead_category);
CREATE INDEX lead_scores_ai_score_idx      ON public.lead_scores(user_id, ai_score DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_scores TO authenticated;
GRANT ALL ON public.lead_scores TO service_role;

ALTER TABLE public.lead_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own scores"   ON public.lead_scores
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own scores" ON public.lead_scores
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own scores" ON public.lead_scores
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own scores" ON public.lead_scores
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
