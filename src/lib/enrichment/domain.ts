/**
 * Domain extraction and analysis utilities — Phase 2
 */

// Free email domains — skip enrichment for these
const FREE_DOMAINS = new Set([
  "gmail.com","yahoo.com","yahoo.co.uk","yahoo.in","hotmail.com","hotmail.co.uk",
  "outlook.com","outlook.in","live.com","msn.com","icloud.com","me.com","mac.com",
  "aol.com","protonmail.com","proton.me","mail.com","zohomail.com","yandex.com",
  "yandex.ru","qq.com","163.com","126.com","sina.com","gmx.com","gmx.de",
  "web.de","t-online.de","rediffmail.com","inbox.com","fastmail.com","tutanota.com",
]);

export interface DomainInfo {
  domain: string;
  isFree: boolean;
  isValid: boolean;
  website: string;
  companyNameGuess: string;
}

/**
 * Extract and analyse the domain from an email address.
 */
export function extractDomain(email: string): DomainInfo {
  const lower = email.toLowerCase().trim();
  const parts = lower.split("@");
  if (parts.length !== 2 || !parts[1]) {
    return { domain: "", isFree: false, isValid: false, website: "", companyNameGuess: "" };
  }

  const domain = parts[1];
  const isFree = FREE_DOMAINS.has(domain);
  const isValid = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
  const website = isValid ? `https://${domain}` : "";

  // Guess company name from domain (strip TLD, capitalise, handle hyphens)
  const namePart = domain.split(".")[0] ?? "";
  const companyNameGuess = namePart
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return { domain, isFree, isValid, website, companyNameGuess };
}

/**
 * Infer industry from domain name heuristics.
 */
export function inferIndustryFromDomain(domain: string): string | null {
  const d = domain.toLowerCase();

  const map: [RegExp, string][] = [
    [/tech|soft|cloud|saas|app|digital|dev|code|stack|net|sys|data|ai|ml|bot|cyber|infra/, "Technology"],
    [/finance|fintech|bank|capital|invest|fund|money|pay|wealth|credit|loan|trade/, "Finance"],
    [/health|med|pharma|bio|clinic|hospital|care|therapy|dental|wellness/, "Healthcare"],
    [/legal|law|attorney|counsel|juris|court/, "Legal"],
    [/market|agency|brand|creative|media|pr|social|ads|seo|content/, "Marketing"],
    [/consult|advisory|partner|strategy|solution|service|group|corp/, "Consulting"],
    [/logistics|supply|freight|ship|cargo|delivery|transport|fleet/, "Logistics"],
    [/retail|shop|store|commerce|ecom|mall|fashion|wear|apparel/, "Retail"],
    [/energy|solar|power|electric|oil|gas|renew|green|environ/, "Energy"],
    [/edu|school|university|college|academy|learn|train|course/, "Education"],
    [/estate|realty|property|land|home|housing|mortgage/, "Real Estate"],
    [/auto|motor|car|vehicle|drive|fleet|transport/, "Automotive"],
    [/food|restaurant|cafe|kitchen|catering|beverage|drink/, "Food & Beverage"],
    [/travel|hotel|resort|tour|booking|hospitality|stay/, "Travel & Hospitality"],
    [/manu|factory|industrial|produce|product|build|construct/, "Manufacturing"],
  ];

  for (const [regex, industry] of map) {
    if (regex.test(d)) return industry;
  }
  return null;
}

/**
 * Infer country from common country-code TLDs.
 */
export function inferCountryFromTLD(domain: string): string | null {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  const tldMap: Record<string, string> = {
    uk: "United Kingdom", de: "Germany", fr: "France", nl: "Netherlands",
    se: "Sweden", no: "Norway", dk: "Denmark", fi: "Finland", ch: "Switzerland",
    at: "Austria", be: "Belgium", es: "Spain", it: "Italy", pt: "Portugal",
    pl: "Poland", cz: "Czech Republic", ru: "Russia", ua: "Ukraine",
    in: "India", cn: "China", jp: "Japan", kr: "South Korea", au: "Australia",
    nz: "New Zealand", sg: "Singapore", hk: "Hong Kong", ae: "UAE",
    br: "Brazil", mx: "Mexico", ar: "Argentina", ca: "Canada", za: "South Africa",
    ie: "Ireland", il: "Israel", tr: "Turkey", sa: "Saudi Arabia", my: "Malaysia",
    id: "Indonesia", th: "Thailand", vn: "Vietnam", ph: "Philippines",
  };
  return tldMap[tld] ?? null;
}
