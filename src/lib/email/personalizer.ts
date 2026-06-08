import { aiLogger } from "@/lib/ai/logger";

export interface PersonalizationInput {
  firstName: string;
  lastName: string;
  companyName: string;
  industry: string;
  country: string;
  leadScore: string;
  leadCategory: string;
  subjectTemplate: string;
  bodyTemplate: string;
  companyDescription: string;
}

export interface PersonalizationResult {
  subject: string;
  body: string;
  personalized: boolean;
}

const TONE_ADJUSTMENTS: Record<string, { greeting: string; closing: string; intensity: string }> = {
  Hot:  { greeting: "Great to connect", closing: "Looking forward to speaking soon", intensity: "high" },
  Warm: { greeting: "Nice to meet you", closing: "Hope to hear from you",           intensity: "medium" },
  Cold: { greeting: "Hope you're well", closing: "Looking forward to connecting",   intensity: "low" },
};

export function personalizeEmail(input: PersonalizationInput): PersonalizationResult {
  const tone = TONE_ADJUSTMENTS[input.leadCategory] ?? TONE_ADJUSTMENTS.Cold;

  let subject = input.subjectTemplate;
  let body = input.bodyTemplate;

  // Replace standard template variables
  const vars: Record<string, string> = {
    first_name:   input.firstName || "there",
    last_name:    input.lastName || "",
    company_name: input.companyName || "your company",
    industry:     input.industry || "technology",
    country:      input.country || "",
    lead_score:   input.leadScore || "N/A",
    lead_category: input.leadCategory || "N/A",
  };
  for (const [key, val] of Object.entries(vars)) {
    subject = subject.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
    body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), val);
  }

  // AI personalization: enhance with tone, company context, industry references
  body = enhanceTone(body, tone);
  body = addCompanyContext(body, input);
  body = addIndustryReference(body, input);

  // Add a personalized closing
  body = body.replace(/Best,\s*$/m, `${tone.closing},`);
  body = body.replace(/Cheers,\s*$/m, `${tone.closing},`);
  body = body.replace(/Looking forward to.*$/m, "");
  body = body.trim() + `\n\n${tone.closing},\n${vars.sender_name ?? "The B2B System Team"}`;

  aiLogger.info("personalizer", "Email personalized", {
    leadCategory: input.leadCategory,
    subjectPreview: subject.substring(0, 60),
  });

  return { subject, body, personalized: true };
}

function enhanceTone(body: string, tone: { greeting: string; closing: string; intensity: string }): string {
  let enhanced = body;

  if (tone.intensity === "high") {
    enhanced = enhanced
      .replace(/\b(would you be (interested|open))\b/gi, "I'd love to")
      .replace(/\b(if you('re| are) interested)\b/gi, "when you're ready")
      .replace(/\b(quick chat)\b/gi, "call");
  } else if (tone.intensity === "low") {
    enhanced = enhanced
      .replace(/\b(I'd love to)\b/gi, "I was wondering if you'd be open to");
  }

  return enhanced;
}

function addCompanyContext(body: string, input: PersonalizationInput): string {
  if (!input.companyDescription || input.companyDescription.length < 10) return body;

  const ref = `I was particularly impressed by ${input.companyName}'s work in the ${input.industry} space — ${input.companyDescription.split(".")[0]}.`;
  const markers = [
    "I came across", "noticed you", "stumbled upon",
    "learn about", "heard about",
  ];
  for (const m of markers) {
    if (body.includes(m)) {
      body = body.replace(m, `${m} ${input.companyName}`);
      body = body.replace(/— .*?\./, "");
      body = body.replace(/\n\nBest,/, `\n\n${ref}\n\nBest,`);
      break;
    }
  }
  return body;
}

function addIndustryReference(body: string, input: PersonalizationInput): string {
  const industry = input.industry?.toLowerCase() ?? "";
  if (!industry || industry === "technology" || industry.length < 3) return body;

  const ref = `Companies in the ${industry} industry face unique challenges when it comes to scaling their outbound — that's exactly where we help.`;
  if (body.includes(ref.split("—")[0].trim())) return body;

  const insertAfter = [
    "Here's what we offer", "We help companies",
    "We specialize", "Here's how we can help",
    "We've helped similar companies",
  ];
  for (const marker of insertAfter) {
    if (body.includes(marker)) {
      body = body.replace(marker, `${marker}\n\n${ref}`);
      break;
    }
  }
  return body;
}
