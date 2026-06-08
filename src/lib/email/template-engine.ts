export type TemplateType =
  | "cold_outreach" | "warm_followup" | "hot_conversion"
  | "product_intro" | "service_intro" | "meeting_request"
  | "demo_request"  | "followup_reminder" | "reengagement"
  | "custom";

export type LeadCategory = "Hot" | "Warm" | "Cold";

export const TEMPLATE_TYPES: { value: TemplateType; label: string; description: string }[] = [
  { value: "cold_outreach",    label: "Cold Outreach",       description: "First contact with a cold lead" },
  { value: "warm_followup",    label: "Warm Lead Follow-up", description: "Follow up with a warm lead" },
  { value: "hot_conversion",   label: "Hot Lead Conversion", description: "Convert a hot lead" },
  { value: "product_intro",    label: "Product Introduction", description: "Introduce your product" },
  { value: "service_intro",    label: "Service Introduction", description: "Introduce a service" },
  { value: "meeting_request",  label: "Meeting Request",     description: "Request a meeting" },
  { value: "demo_request",     label: "Demo Request",        description: "Request a demo" },
  { value: "followup_reminder",label: "Follow-up Reminder",  description: "Gentle follow-up reminder" },
  { value: "reengagement",     label: "Re-engagement",       description: "Re-engage a dormant lead" },
  { value: "custom",           label: "Custom Template",     description: "Your own template" },
];

export const TEMPLATE_TYPE_LABEL: Record<TemplateType, string> = Object.fromEntries(
  TEMPLATE_TYPES.map(t => [t.value, t.label])
) as Record<TemplateType, string>;

export const LEAD_TO_TEMPLATE: Record<LeadCategory, TemplateType[]> = {
  Hot:  ["hot_conversion", "demo_request", "meeting_request"],
  Warm: ["warm_followup", "product_intro", "service_intro"],
  Cold: ["cold_outreach", "service_intro", "followup_reminder", "reengagement"],
};

export function recommendTemplates(category: LeadCategory | null | undefined): TemplateType[] {
  return category ? LEAD_TO_TEMPLATE[category] ?? [] : [];
}

export interface TemplateVars {
  first_name: string;
  last_name: string;
  company_name: string;
  industry: string;
  country: string;
  lead_score: string;
  lead_category: string;
  sender_name: string;
  [key: string]: string;
}

export function replaceTemplateVars(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

export function buildTemplateVars(
  contact: { first_name?: string | null; last_name?: string | null; company?: string | null },
  enrichment: { industry?: string | null; country?: string | null; company_name?: string | null } | null,
  score: { ai_score?: number; lead_category?: string } | null,
  senderName?: string,
): TemplateVars {
  const companyName = enrichment?.company_name ?? contact.company ?? "your company";
  return {
    first_name:   contact.first_name ?? "there",
    last_name:    contact.last_name ?? "",
    company_name: companyName,
    industry:     enrichment?.industry ?? "technology",
    country:      enrichment?.country ?? "",
    lead_score:   score?.ai_score != null ? Math.round(score.ai_score).toString() : "N/A",
    lead_category: score?.lead_category ?? "N/A",
    sender_name:  senderName ?? "The B2B System Team",
  };
}
