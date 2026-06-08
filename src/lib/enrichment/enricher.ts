/**
 * Lead Enrichment Engine — Phase 2
 *
 * Enriches a contact by:
 * 1. Extracting and validating their email domain
 * 2. Fetching company data from free public sources
 * 3. Inferring industry, country, and size from domain signals
 * 4. Returning a structured enrichment profile
 *
 * Data sources (all free, no API keys):
 * - Clearbit Autocomplete API  (company name, domain, logo)
 * - Wikipedia summary API      (company description)
 * - Domain heuristics          (industry, country from TLD)
 */

import { extractDomain, inferIndustryFromDomain, inferCountryFromTLD } from "./domain";
import { aiLogger } from "@/lib/ai/logger";

export interface EnrichmentResult {
  domain:              string;
  company_name:        string | null;
  website:             string | null;
  industry:            string | null;
  country:             string | null;
  company_description: string | null;
  company_size:        string | null;
  logo_url:            string | null;
  linkedin_url:        string | null;
  twitter_url:         string | null;
  enrichment_status:   "completed" | "failed" | "skipped";
  error_message:       string | null;
}

// Clearbit Autocomplete — free, no auth, returns company info by domain
async function fetchClearbit(domain: string): Promise<{
  name?: string;
  logo?: string;
  domain?: string;
} | null> {
  try {
    const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(domain)}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "B2B-Lead-System/2.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as Array<{ name?: string; logo?: string; domain?: string }>;
    // Find best match — prefer exact domain match
    const exact = data.find((c) => c.domain === domain);
    return exact ?? data[0] ?? null;
  } catch {
    return null;
  }
}

// Wikipedia summary — free, find company description by name
async function fetchWikipediaSummary(companyName: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(companyName.replace(/\s+/g, "_"));
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${query}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { type?: string; extract?: string };
    if (data.type === "disambiguation" || !data.extract) return null;
    // Return first sentence only
    const first = data.extract.split(". ")[0];
    return first && first.length > 20 ? first + "." : null;
  } catch {
    return null;
  }
}

// Infer company size from domain signals
function inferCompanySize(domain: string, companyName: string): string | null {
  const text = `${domain} ${companyName}`.toLowerCase();

  // Well-known large companies by domain pattern
  const large = ["enterprise", "corp", "corporation", "global", "international", "worldwide", "inc"];
  const medium = ["solutions", "technologies", "systems", "services", "consulting", "partners", "group"];
  const startup = ["io", "ai", "labs", "hq", "studio", "works", "ninja", "ly"];

  const domainParts = domain.split(".");
  const tld = domainParts[domainParts.length - 1] ?? "";

  if (large.some((kw) => text.includes(kw))) return "201-1000 employees";
  if (medium.some((kw) => text.includes(kw))) return "51-200 employees";
  if (startup.includes(tld)) return "1-50 employees";
  return "11-50 employees"; // default for unknown businesses
}

/**
 * Enrich a single contact by email.
 */
export async function enrichContact(email: string | null | undefined, existingCompany?: string | null): Promise<EnrichmentResult> {
  if (!email) {
    return {
      domain: "", company_name: null, website: null, industry: null, country: null,
      company_description: null, company_size: null, logo_url: null, linkedin_url: null, twitter_url: null,
      enrichment_status: "skipped", error_message: "No email address",
    };
  }
  const domainInfo = extractDomain(email);

  // Skip free/personal email domains
  if (domainInfo.isFree || !domainInfo.isValid) {
    return {
      domain:              domainInfo.domain,
      company_name:        null,
      website:             null,
      industry:            null,
      country:             null,
      company_description: null,
      company_size:        null,
      logo_url:            null,
      linkedin_url:        null,
      twitter_url:         null,
      enrichment_status:   "skipped",
      error_message:       domainInfo.isFree ? "Free email domain — no company data" : "Invalid domain",
    };
  }

  try {
    aiLogger.info("enricher", "Enriching domain", { domain: domainInfo.domain });

    // Run Clearbit fetch (primary source)
    const clearbit = await fetchClearbit(domainInfo.domain);

    const companyName =
      clearbit?.name ??
      existingCompany ??
      domainInfo.companyNameGuess ??
      null;

    const logoUrl = clearbit?.logo ?? null;
    const website = domainInfo.website;

    // Industry — Clearbit doesn't return industry via autocomplete,
    // so derive from domain heuristics
    const industry = inferIndustryFromDomain(domainInfo.domain);

    // Country — from TLD or Clearbit data
    const country = inferCountryFromTLD(domainInfo.domain);

    // Company size — heuristic
    const companySize = companyName ? inferCompanySize(domainInfo.domain, companyName) : null;

    // Description — try Wikipedia for well-known companies
    let description: string | null = null;
    if (companyName && companyName.length > 2) {
      description = await fetchWikipediaSummary(companyName);
    }

    // Build social URLs from domain
    const linkedinUrl = `https://www.linkedin.com/company/${domainInfo.domain.split(".")[0]}`;
    const twitterUrl  = `https://twitter.com/${domainInfo.domain.split(".")[0]}`;

    aiLogger.info("enricher", "Enrichment complete", {
      domain: domainInfo.domain,
      companyName,
      hasDescription: Boolean(description),
    });

    return {
      domain:              domainInfo.domain,
      company_name:        companyName,
      website,
      industry,
      country,
      company_description: description,
      company_size:        companySize,
      logo_url:            logoUrl,
      linkedin_url:        linkedinUrl,
      twitter_url:         twitterUrl,
      enrichment_status:   "completed",
      error_message:       null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    aiLogger.error("enricher", "Enrichment failed", { domain: domainInfo.domain, error: msg });
    return {
      domain:              domainInfo.domain,
      company_name:        existingCompany ?? domainInfo.companyNameGuess ?? null,
      website:             domainInfo.website,
      industry:            inferIndustryFromDomain(domainInfo.domain),
      country:             inferCountryFromTLD(domainInfo.domain),
      company_description: null,
      company_size:        null,
      logo_url:            null,
      linkedin_url:        null,
      twitter_url:         null,
      enrichment_status:   "failed",
      error_message:       msg,
    };
  }
}
