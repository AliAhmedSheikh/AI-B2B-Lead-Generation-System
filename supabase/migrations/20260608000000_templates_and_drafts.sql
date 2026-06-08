-- Phase 3: Email Templates & Drafts

-- ── templates ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.templates (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  template_type TEXT        NOT NULL
                  CHECK (template_type IN (
                    'cold_outreach','warm_followup','hot_conversion',
                    'product_intro','service_intro','meeting_request',
                    'demo_request','followup_reminder','reengagement',
                    'custom'
                  )),
  subject_template TEXT    NOT NULL DEFAULT '',
  body_template    TEXT    NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS templates_user_id_idx ON public.templates(user_id);
CREATE INDEX IF NOT EXISTS templates_type_idx    ON public.templates(template_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.templates TO authenticated;
GRANT ALL ON public.templates TO service_role;

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own templates"   ON public.templates
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own templates" ON public.templates
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own templates" ON public.templates
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own templates" ON public.templates
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── email_drafts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_drafts (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id      UUID        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  template_id     UUID        NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
  subject         TEXT        NOT NULL DEFAULT '',
  email_body      TEXT        NOT NULL DEFAULT '',
  generation_status TEXT      NOT NULL DEFAULT 'pending'
                    CHECK (generation_status IN ('pending','processing','completed','failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message   TEXT,
  metadata        JSONB
);

CREATE INDEX IF NOT EXISTS drafts_user_id_idx    ON public.email_drafts(user_id);
CREATE INDEX IF NOT EXISTS drafts_contact_id_idx ON public.email_drafts(contact_id);
CREATE INDEX IF NOT EXISTS drafts_status_idx     ON public.email_drafts(generation_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_drafts TO authenticated;
GRANT ALL ON public.email_drafts TO service_role;

ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own drafts"   ON public.email_drafts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own drafts" ON public.email_drafts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own drafts" ON public.email_drafts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own drafts" ON public.email_drafts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Seed default templates
INSERT INTO public.templates (user_id, name, template_type, subject_template, body_template)
SELECT
  u.id,
  t.name,
  t.template_type,
  t.subject_template,
  t.body_template
FROM auth.users u
CROSS JOIN (VALUES
  ('Cold Outreach', 'cold_outreach',
   'Quick question, {{first_name}}',
   'Hi {{first_name}},\n\nI came across {{company_name}} and noticed you''re in the {{industry}} space. We help companies like yours streamline their lead management.\n\nWould you be open to a quick chat this week?\n\nBest,\n{{sender_name}}'),

  ('Warm Lead Follow-up', 'warm_followup',
   'Following up, {{first_name}}',
   'Hi {{first_name}},\n\nIt was great learning about {{company_name}} — your work in {{industry}} is impressive.\n\nI wanted to share how we''ve helped similar companies improve their outbound pipeline. Let me know if you''d like to see a quick overview.\n\nCheers,\n{{sender_name}}'),

  ('Hot Lead Conversion', 'hot_conversion',
   'Perfect timing, {{first_name}}',
   'Hi {{first_name}},\n\nGiven {{company_name}}''s growth in {{industry}}, I think now is the perfect time to explore how we can help accelerate your pipeline.\n\nCan we set up a 15-minute call this week?\n\nBest,\n{{sender_name}}'),

  ('Product Introduction', 'product_intro',
   'Introducing our platform, {{first_name}}',
   'Hi {{first_name}},\n\nAt B2B System, we help businesses like {{company_name}} automate their lead enrichment and outbound workflows.\n\nHere''s what we offer:\n• AI-powered lead scoring\n• Automated enrichment\n• Personalized email generation\n\nWould you be interested in a walkthrough?\n\nBest,\n{{sender_name}}'),

  ('Service Introduction', 'service_intro',
   'How we can help {{company_name}}',
   'Hi {{first_name}},\n\n{{company_name}} operates in {{industry}}, and we specialize in helping companies in this space optimize their sales development.\n\nOur platform handles everything from lead import to enrichment to AI-driven outreach.\n\nWould love to show you around.\n\nBest,\n{{sender_name}}'),

  ('Meeting Request', 'meeting_request',
   'Meeting request — {{first_name}}',
   'Hi {{first_name}},\n\nI''d love to schedule a quick 15-minute call to discuss how B2B System can support {{company_name}}''s growth.\n\nAre you available Tuesday or Thursday?\n\nBest,\n{{sender_name}}'),

  ('Demo Request', 'demo_request',
   'Live demo for {{company_name}}',
   'Hi {{first_name}},\n\nWould you like to see a personalized demo of our platform for {{company_name}}?\n\nWe can walk through lead import, AI scoring, enrichment, and email generation in under 20 minutes.\n\nLet me know what time works for you.\n\nBest,\n{{sender_name}}'),

  ('Follow-up Reminder', 'followup_reminder',
   'Checking in, {{first_name}}',
   'Hi {{first_name}},\n\nJust following up on my previous note — I''d love to connect with you at {{company_name}}.\n\nLet me know if you have any questions.\n\nBest,\n{{sender_name}}'),

  ('Re-engagement', 'reengagement',
   'Long time, {{first_name}}',
   'Hi {{first_name}},\n\nIt''s been a while since we last connected. Since then, we''ve launched several new features that I think would be valuable for {{company_name}}.\n\nWould you be open to a quick catch-up?\n\nBest,\n{{sender_name}}'),

  ('Custom Template', 'custom',
   'Hello {{first_name}}',
   'Hi {{first_name}},\n\nI wanted to reach out regarding {{company_name}}.\n\nLet me know if you''re interested.\n\nBest,\n{{sender_name}}')
) AS t(name, template_type, subject_template, body_template)
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
