/**
 * Sample lead data generator — creates a realistic .xlsx for testing Phase 1 AI classification.
 * Covers all three tiers: Hot, Warm, Cold leads with varied fields.
 */

import XLSX from "xlsx";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const leads = [
  // ── HOT LEADS (business email + senior title + B2B industry + tier-1 geo) ──
  { email: "james.hartley@nexuscorp.io",     first_name: "James",    last_name: "Hartley",    company: "Nexus Corp",          title: "CEO",                  industry: "SaaS",                 country: "United States", phone: "+1-415-555-0101", source: "LinkedIn" },
  { email: "sarah.chen@cloudvault.com",      first_name: "Sarah",    last_name: "Chen",       company: "CloudVault Inc",      title: "CTO",                  industry: "Cloud Technology",     country: "United States", phone: "+1-650-555-0192", source: "LinkedIn" },
  { email: "michael.okafor@finbridge.co",    first_name: "Michael",  last_name: "Okafor",     company: "FinBridge Solutions", title: "Chief Financial Officer", industry: "Fintech",           country: "United Kingdom", phone: "+44-20-5550-0134", source: "Conference" },
  { email: "priya.nair@healthtechglobal.com", first_name: "Priya",   last_name: "Nair",       company: "HealthTech Global",   title: "Founder & CEO",        industry: "Healthcare Technology", country: "United States", phone: "+1-212-555-0187", source: "Referral" },
  { email: "lucas.meyer@eigensoft.de",       first_name: "Lucas",    last_name: "Meyer",      company: "EigenSoft GmbH",      title: "Managing Director",    industry: "Enterprise Software",  country: "Germany",       phone: "+49-30-5550-0211", source: "Partner" },
  { email: "anna.kowalski@cyberdefend.io",   first_name: "Anna",     last_name: "Kowalski",   company: "CyberDefend",         title: "CISO",                 industry: "Cybersecurity",        country: "United States", phone: "+1-202-555-0143", source: "Conference" },
  { email: "raj.patel@deepanalytics.ai",     first_name: "Raj",      last_name: "Patel",      company: "Deep Analytics AI",   title: "Co-Founder",           industry: "Artificial Intelligence", country: "United Kingdom", phone: "+44-7700-900234", source: "LinkedIn" },
  { email: "olivia.west@legaledge.com",      first_name: "Olivia",   last_name: "West",       company: "LegalEdge Partners",  title: "Managing Partner",     industry: "Legal",                country: "United States", phone: "+1-312-555-0156", source: "Referral" },
  { email: "daniel.kim@supplyiq.co",         first_name: "Daniel",   last_name: "Kim",        company: "SupplyIQ",            title: "VP of Operations",     industry: "Supply Chain",         country: "Singapore",     phone: "+65-6555-0178", source: "LinkedIn" },
  { email: "emma.fitzpatrick@ventureai.io",  first_name: "Emma",     last_name: "Fitzpatrick", company: "VentureAI",          title: "President",            industry: "AI / Machine Learning", country: "United States", phone: "+1-415-555-0199", source: "Partner" },
  { email: "tomasz.wiśniewski@bankstream.pl", first_name: "Tomasz",  last_name: "Wiśniewski", company: "BankStream",          title: "Director of Finance",  industry: "Banking",              country: "Poland",        phone: "+48-22-5550-0345", source: "Conference" },
  { email: "nina.larsson@mediasyncab.se",    first_name: "Nina",     last_name: "Larsson",    company: "MediaSync AB",        title: "Chief Marketing Officer", industry: "Media & Advertising", country: "Sweden",       phone: "+46-8-5550-0456", source: "LinkedIn" },

  // ── WARM LEADS (business email + mid-level title or partial data) ──
  { email: "carlos.ruiz@techsprint.mx",      first_name: "Carlos",   last_name: "Ruiz",       company: "TechSprint MX",       title: "Senior Engineer",      industry: "Software",             country: "Mexico",        phone: "+52-55-5550-0567", source: "Website" },
  { email: "fiona.grant@datatransform.net",  first_name: "Fiona",    last_name: "Grant",      company: "DataTransform",       title: "Data Analyst",         industry: "Analytics",            country: "Australia",     phone: "+61-2-5550-0678", source: "Webinar" },
  { email: "alex.novak@cloudsprint.io",      first_name: "Alex",     last_name: "Novak",      company: "CloudSprint",         title: "Lead Developer",       industry: "Cloud",                country: "Canada",        phone: "+1-604-555-0234", source: "Inbound" },
  { email: "marie.dubois@conseilpro.fr",     first_name: "Marie",    last_name: "Dubois",     company: "ConseilPro",          title: "Senior Consultant",    industry: "Consulting",           country: "France",        phone: "+33-1-5550-0789", source: "Website" },
  { email: "stefan.braun@autoworks.de",      first_name: "Stefan",   last_name: "Braun",      company: "AutoWorks AG",        title: "Manager",              industry: "Automotive",           country: "Germany",       phone: "+49-89-5550-0890", source: "Content" },
  { email: "jessica.tan@logisticsco.sg",     first_name: "Jessica",  last_name: "Tan",        company: "LogisticsCo",         title: "Operations Manager",   industry: "Logistics",            country: "Singapore",     phone: "+65-9555-0321", source: "LinkedIn" },
  { email: "mark.johnson@retailnow.com",     first_name: "Mark",     last_name: "Johnson",    company: "RetailNow",           title: "Senior Analyst",       industry: "Retail",               country: "United States", phone: "+1-312-555-0432", source: "Webinar" },
  { email: "linda.wu@pharmatech.co",         first_name: "Linda",    last_name: "Wu",         company: "PharmaTech",          title: "Research Specialist",  industry: "Pharma",               country: "United States", phone: "+1-617-555-0543", source: "Inbound" },
  { email: "ibrahim.ali@energysol.ae",       first_name: "Ibrahim",  last_name: "Ali",        company: "EnergySol",           title: "Project Lead",         industry: "Energy",               country: "UAE",           phone: "+971-4-5550-0654", source: "Conference" },
  { email: "yuki.tanaka@techbridge.jp",      first_name: "Yuki",     last_name: "Tanaka",     company: "TechBridge Japan",    title: "Senior Software Engineer", industry: "Technology",      country: "Japan",         phone: "+81-3-5550-0765", source: "Website" },
  { email: "kate.murphy@irishsaas.ie",       first_name: "Kate",     last_name: "Murphy",     company: "IrishSaaS",           title: "Team Lead",            industry: "SaaS",                 country: "Ireland",       phone: "+353-1-5550-0876", source: "Content" },
  { email: "andrei.popescu@rotech.ro",       first_name: "Andrei",   last_name: "Popescu",    company: "RoTech Solutions",    title: "Software Architect",   industry: "Software",             country: "Romania",       phone: "+40-21-5550-0987", source: "Webinar" },

  // ── COLD LEADS (free email / no company / low-signal data) ──
  { email: "john.doe@gmail.com",             first_name: "John",     last_name: "Doe",        company: "",                    title: "",                     industry: "",                     country: "",              phone: "",               source: "Bulk list" },
  { email: "mary.smith@yahoo.com",           first_name: "Mary",     last_name: "Smith",      company: "",                    title: "",                     industry: "",                     country: "",              phone: "",               source: "Purchased" },
  { email: "bob.wilson@hotmail.com",         first_name: "Bob",      last_name: "Wilson",     company: "Bob's Stuff",         title: "",                     industry: "",                     country: "",              phone: "",               source: "Cold list" },
  { email: "user1234@outlook.com",           first_name: "",         last_name: "",           company: "",                    title: "",                     industry: "",                     country: "",              phone: "",               source: "" },
  { email: "contact@protonmail.com",         first_name: "Alex",     last_name: "",           company: "",                    title: "",                     industry: "",                     country: "",              phone: "",               source: "Bulk list" },
  { email: "info2024@gmail.com",             first_name: "",         last_name: "",           company: "Personal Blog",       title: "Blogger",              industry: "",                     country: "",              phone: "",               source: "Cold" },
  { email: "noreply@yahoo.co.uk",            first_name: "",         last_name: "",           company: "",                    title: "",                     industry: "",                     country: "UK",            phone: "",               source: "Purchased" },
  { email: "testuser@icloud.com",            first_name: "Test",     last_name: "User",       company: "",                    title: "",                     industry: "",                     country: "",              phone: "",               source: "" },
  { email: "newsletter@gmail.com",           first_name: "News",     last_name: "",           company: "",                    title: "",                     industry: "",                     country: "",              phone: "",               source: "Bulk list" },
  { email: "randomuser99@hotmail.com",       first_name: "",         last_name: "",           company: "",                    title: "",                     industry: "",                     country: "",              phone: "",               source: "Cold" },
  { email: "personal.mail@aol.com",          first_name: "Dave",     last_name: "Brown",      company: "",                    title: "Freelancer",           industry: "",                     country: "United States", phone: "",               source: "Bulk list" },
  { email: "hello@me.com",                   first_name: "",         last_name: "",           company: "",                    title: "",                     industry: "",                     country: "",              phone: "",               source: "" },

  // ── EDGE CASES (business email but minimal info) ──
  { email: "info@startupxyz.com",            first_name: "",         last_name: "",           company: "StartupXYZ",          title: "",                     industry: "",                     country: "",              phone: "",               source: "" },
  { email: "hello@acmecorp.net",             first_name: "Jane",     last_name: "",           company: "Acme Corp",           title: "",                     industry: "",                     country: "United States", phone: "",               source: "Website" },
  { email: "d.brown@techventure.io",         first_name: "David",    last_name: "Brown",      company: "Tech Venture",        title: "Advisor",              industry: "Technology",           country: "Canada",        phone: "+1-416-555-0999", source: "LinkedIn" },
  { email: "ops@globallogistics.co",         first_name: "",         last_name: "",           company: "Global Logistics",    title: "",                     industry: "Logistics",            country: "India",         phone: "",               source: "Inbound" },
  { email: "cfo@greenenergy.org",            first_name: "Patricia", last_name: "Moore",      company: "Green Energy Org",    title: "CFO",                  industry: "Energy",               country: "Germany",       phone: "+49-40-5550-1234", source: "Conference" },
  { email: "sales@mediabrand.biz",           first_name: "Tom",      last_name: "Clark",      company: "MediaBrand",          title: "Sales Manager",        industry: "Advertising",          country: "United States", phone: "+1-213-555-0321", source: "Cold" },
];

// Build worksheet data with headers
const headers = [
  "email", "first_name", "last_name", "company",
  "title", "industry", "country", "phone", "source"
];

const rows = leads.map(l => [
  l.email, l.first_name, l.last_name, l.company,
  l.title, l.industry, l.country, l.phone, l.source,
]);

const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

// Column widths
ws["!cols"] = [
  { wch: 42 }, // email
  { wch: 14 }, // first_name
  { wch: 14 }, // last_name
  { wch: 28 }, // company
  { wch: 28 }, // title
  { wch: 26 }, // industry
  { wch: 18 }, // country
  { wch: 20 }, // phone
  { wch: 14 }, // source
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Leads");

const outPath = path.join(__dirname, "..", "sample-leads.xlsx");
XLSX.writeFile(wb, outPath);

console.log(`✓ Generated ${leads.length} sample leads → ${outPath}`);
console.log(`  Hot candidates:  ${leads.filter(l => !["gmail","yahoo","hotmail","outlook","aol","icloud","protonmail","me.com"].some(d => l.email.includes(d)) && (l.title.toLowerCase().includes("ceo") || l.title.toLowerCase().includes("cto") || l.title.toLowerCase().includes("cfo") || l.title.toLowerCase().includes("founder") || l.title.toLowerCase().includes("chief") || l.title.toLowerCase().includes("director") || l.title.toLowerCase().includes("vp") || l.title.toLowerCase().includes("president") || l.title.toLowerCase().includes("managing") || l.title.toLowerCase().includes("partner"))).length}`);
console.log(`  Warm candidates: ~12`);
console.log(`  Cold candidates: ${leads.filter(l => ["gmail.com","yahoo.com","hotmail.com","outlook.com","aol.com","icloud.com","protonmail.com","me.com","yahoo.co.uk"].some(d => l.email.endsWith(d))).length}`);
