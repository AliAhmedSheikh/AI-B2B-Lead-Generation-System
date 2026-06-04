/**
 * Feature Engineering — Phase 1: AI Classification Engine
 *
 * Extracts structured, weighted signals from a contact record.
 * Each feature returns a normalised score [0, 1] so the classifier
 * can combine them in a single weighted sum.
 */

// ---------------------------------------------------------------------------
// Free / consumer email domains (reduces business-signal weight)
// ---------------------------------------------------------------------------
const FREE_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "yahoo.co.uk", "yahoo.in", "hotmail.com",
  "hotmail.co.uk", "outlook.com", "outlook.in", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "protonmail.com",
  "proton.me", "mail.com", "zohomail.com", "yandex.com", "yandex.ru",
  "qq.com", "163.com", "126.com", "sina.com", "gmx.com", "gmx.de",
  "web.de", "t-online.de",
]);

// ---------------------------------------------------------------------------
// Senior-level title keywords
// ---------------------------------------------------------------------------
const SENIOR_TITLES = [
  "ceo", "cto", "cfo", "coo", "cmo", "ciso", "cpo", "cso",
  "chief", "president", "founder", "co-founder", "owner", "principal",
  "director", "vp", "vice president", "head of", "general manager",
  "partner", "managing director", "md", "svp", "evp", "executive",
];

const MID_TITLES = [
  "manager", "lead", "senior", "sr.", "sr ", "architect", "engineer",
  "specialist", "analyst", "consultant", "advisor", "supervisor",
  "coordinator", "team lead",
];

// ---------------------------------------------------------------------------
// High-value B2B industry keywords
// ---------------------------------------------------------------------------
const HIGH_VALUE_INDUSTRIES = [
  "software", "technology", "tech", "saas", "fintech", "finance",
  "banking", "insurance", "investment", "healthcare", "pharma",
  "biotech", "medical", "consulting", "professional services",
  "enterprise", "cloud", "cybersecurity", "security", "ai",
  "artificial intelligence", "machine learning", "data", "analytics",
  "ecommerce", "e-commerce", "retail", "logistics", "supply chain",
  "telecom", "telecommunications", "aerospace", "defence", "defense",
  "manufacturing", "automotive", "energy", "oil", "gas", "legal",
  "accounting", "real estate", "marketing", "advertising", "media",
];

// ---------------------------------------------------------------------------
// High-value geography (tier-1 business markets)
// ---------------------------------------------------------------------------
const TIER1_GEO = new Set([
  "us", "usa", "united states", "uk", "united kingdom", "gb", "canada",
  "ca", "australia", "au", "germany", "de", "france", "fr",
  "netherlands", "nl", "switzerland", "ch", "sweden", "se",
  "singapore", "sg", "japan", "jp", "uae", "dubai",
]);

const TIER2_GEO = new Set([
  "india", "in", "brazil", "br", "mexico", "mx", "spain", "es",
  "italy", "it", "poland", "pl", "israel", "il", "south korea", "kr",
  "new zealand", "nz", "hong kong", "hk", "ireland", "ie",
  "denmark", "dk", "norway", "no", "finland", "fi", "belgium", "be",
]);

// ---------------------------------------------------------------------------
// Contact shape expected by the engine
// ---------------------------------------------------------------------------
export interface RawContact {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  source?: string | null;
  raw?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Extracted feature vector
// ---------------------------------------------------------------------------
export interface FeatureVector {
  // Email signals
  isBusinessEmail: boolean;          // not a free-domain address
  emailDomain: string;
  hasCorporateTld: boolean;          // .com, .io, .co, .ai, .net, .org, .gov, .edu

  // Identity completeness
  hasFirstName: boolean;
  hasLastName: boolean;
  hasCompany: boolean;
  hasPhone: boolean;
  completenessScore: number;         // [0,1] fraction of key fields present

  // Job title signals
  titleSeniority: "senior" | "mid" | "unknown";
  titleSeniorityScore: number;       // senior=1, mid=0.5, unknown=0

  // Company signals
  companyLength: number;             // proxy for whether company field is detailed
  hasIndustryKeyword: boolean;
  industryScore: number;             // [0,1]

  // Source / channel signals
  sourceQualityScore: number;        // [0,1]

  // Geography signals
  geoTier: 0 | 1 | 2;              // 0=unknown, 1=tier1, 2=tier2
  geoScore: number;                  // tier1=1, tier2=0.5, 0=0

  // Raw extra fields (proxies for data richness)
  rawFieldCount: number;
  rawRichnessScore: number;          // [0,1]
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------
export function extractFeatures(contact: RawContact): FeatureVector {
  const email = (contact.email ?? "").toLowerCase().trim();
  const emailDomain = email.split("@")[1] ?? "";
  const isBusinessEmail = emailDomain !== "" && !FREE_DOMAINS.has(emailDomain);
  const hasCorporateTld = /\.(com|io|co|ai|net|org|gov|edu|biz|info)$/.test(emailDomain);

  const hasFirstName = Boolean(contact.first_name?.trim());
  const hasLastName = Boolean(contact.last_name?.trim());
  const hasCompany = Boolean(contact.company?.trim());
  const hasPhone = Boolean(
    (contact.raw as Record<string, unknown> | null)?.[
      Object.keys(contact.raw ?? {}).find((k) =>
        ["phone", "phone_number", "mobile", "telephone"].includes(k.toLowerCase()),
      ) ?? ""
    ],
  );

  const keyFields = [hasFirstName, hasLastName, hasCompany, Boolean(email)];
  const completenessScore = keyFields.filter(Boolean).length / keyFields.length;

  // Title seniority — look in raw fields for job_title, title, position etc.
  const rawObj = (contact.raw ?? {}) as Record<string, unknown>;
  const titleRaw =
    String(
      rawObj["title"] ??
      rawObj["job_title"] ??
      rawObj["position"] ??
      rawObj["role"] ??
      rawObj["designation"] ??
      "",
    ).toLowerCase();

  let titleSeniority: FeatureVector["titleSeniority"] = "unknown";
  let titleSeniorityScore = 0;
  if (SENIOR_TITLES.some((t) => titleRaw.includes(t))) {
    titleSeniority = "senior";
    titleSeniorityScore = 1;
  } else if (MID_TITLES.some((t) => titleRaw.includes(t))) {
    titleSeniority = "mid";
    titleSeniorityScore = 0.5;
  }

  // Industry — check company name + raw industry field
  const industryText = [
    contact.company ?? "",
    String(rawObj["industry"] ?? ""),
    String(rawObj["sector"] ?? ""),
    emailDomain,
  ]
    .join(" ")
    .toLowerCase();
  const hasIndustryKeyword = HIGH_VALUE_INDUSTRIES.some((kw) =>
    industryText.includes(kw),
  );
  const industryScore = hasIndustryKeyword ? 1 : 0;

  // Source quality
  const sourceText = (contact.source ?? "").toLowerCase();
  let sourceQualityScore = 0.3; // default / unknown
  if (["linkedin", "conference", "referral", "partner"].some((s) => sourceText.includes(s))) {
    sourceQualityScore = 1;
  } else if (["website", "webinar", "inbound", "content"].some((s) => sourceText.includes(s))) {
    sourceQualityScore = 0.7;
  } else if (["cold", "bulk", "list", "purchased"].some((s) => sourceText.includes(s))) {
    sourceQualityScore = 0.1;
  }

  // Geography — look in raw fields
  const geoText = [
    String(rawObj["country"] ?? ""),
    String(rawObj["location"] ?? ""),
    String(rawObj["region"] ?? ""),
    String(rawObj["city"] ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  let geoTier: 0 | 1 | 2 = 0;
  let geoScore = 0;
  if ([...TIER1_GEO].some((g) => geoText.includes(g))) {
    geoTier = 1;
    geoScore = 1;
  } else if ([...TIER2_GEO].some((g) => geoText.includes(g))) {
    geoTier = 2;
    geoScore = 0.5;
  }

  // Data richness
  const rawFieldCount = Object.keys(rawObj).filter(
    (k) => rawObj[k] !== null && rawObj[k] !== undefined && String(rawObj[k]).trim() !== "",
  ).length;
  const rawRichnessScore = Math.min(rawFieldCount / 10, 1); // saturates at 10 non-empty fields

  return {
    isBusinessEmail,
    emailDomain,
    hasCorporateTld,
    hasFirstName,
    hasLastName,
    hasCompany,
    hasPhone,
    completenessScore,
    titleSeniority,
    titleSeniorityScore,
    companyLength: (contact.company ?? "").length,
    hasIndustryKeyword,
    industryScore,
    sourceQualityScore,
    geoTier,
    geoScore,
    rawFieldCount,
    rawRichnessScore,
  };
}
