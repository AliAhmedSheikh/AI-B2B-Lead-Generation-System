# AI B2B Lead Generation System

A full-stack B2B lead management platform with an AI-powered classification engine. Import email lists, automatically score and classify leads into Hot, Warm, and Cold categories, and manage your pipeline from a clean dashboard.

---

## Architecture

```
Phase 0 → Data Ingestion Layer      ✅ Complete
Phase 1 → AI Classification Layer   ✅ Complete
Phase 2 → Lead Enrichment Layer     ✅ Complete
Phase 3 → CRM Automation & Outreach 🔜 Planned
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | TanStack Start (React 19 + SSR) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 + Radix UI (shadcn) |
| Backend | TanStack Server Functions (Nitro) |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth (email/password + Google OAuth) |
| Build | Vite 7 |

---

## Features

### Phase 0 — Data Ingestion
- Upload CSV or XLSX email lists
- Flexible column mapping (case-insensitive, supports common aliases)
- Email validation and deduplication (within file and across imports)
- Per-user data isolation via Supabase Row Level Security
- Import history with inserted / duplicate / invalid counts

### Phase 2 — Lead Enrichment Engine
- **Domain extraction** — parses and validates company domains from email addresses
- **Free data sources** — no API keys required:
  - Clearbit Autocomplete API (company name, logo)
  - Wikipedia Summary API (company description)
  - Domain heuristics (industry keywords, country from TLD)
- **Company intelligence**: name, website, industry, country, size, description, logo, LinkedIn/Twitter URLs
- **Deduplication** — skips already-enriched contacts unless forced
- **Bulk enrichment** — processes up to 20 contacts per batch with concurrency control
- **Hot-only mode** — enrich only your best leads first
- **Status tracking**: `pending` → `processing` → `completed` / `failed` / `skipped`
- **Enrichment tab** — full company profile table with logos, links and descriptions
- **Per-row enrich button** on leads table
- **Feature Engineering** — extracts 8 weighted signals per contact:
  - Business vs free email domain
  - Corporate TLD detection
  - Data completeness score
  - Job title seniority (C-suite, VP, Director, Manager, etc.)
  - Industry keyword matching (SaaS, Fintech, Healthcare, etc.)
  - Geography tier scoring (Tier 1: US/UK/DE/SG, Tier 2: IN/BR/MX)
  - Source/channel quality
  - Raw data richness
- **Weighted Ensemble Classifier** — sigmoid-normalised score 0–100
- **Three-tier classification**: Hot (≥68) · Warm (≥38) · Cold (<38)
- **Confidence scoring** — based on distance from classification boundaries
- **Model versioning** — v1.0.0, swappable without retraining
- **Bulk scoring** — "Score all" button classifies all contacts in one click
- **Per-row reprocess** — re-run the model on any individual contact
- Real-time score display (no page refresh needed)

---

## Database Schema

### `contacts`
| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | FK → auth.users |
| email | TEXT | Validated email (unique per user) |
| first_name, last_name | TEXT | Contact name |
| company | TEXT | Company name |
| phone | TEXT | Phone number |
| source | TEXT | Lead source/channel |
| raw | JSONB | Original import row |
| ai_score | NUMERIC(5,2) | AI score 0–100 |
| lead_category | TEXT | Hot / Warm / Cold |
| confidence_score | NUMERIC(5,4) | Model confidence 0–1 |
| model_version | TEXT | Classifier version used |

### `import_logs`
Tracks every file upload — file name, row counts, status, timestamps.

---

## Getting Started

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/AliAhmedSheikh/AI-B2B-Lead-Generation-System.git
   cd AI-B2B-Lead-Generation-System
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Fill in your Supabase project URL and publishable key from  
   [supabase.com/dashboard → Settings → API Keys](https://supabase.com/dashboard)

4. **Run database migrations**  
   Open your [Supabase SQL Editor](https://supabase.com/dashboard) and run the files in order:
   - `supabase/migrations/20260603123159_*.sql` — contacts + import_logs tables
   - `supabase/migrations/20260604000000_lead_scores.sql` — lead_scores table
   
   Then add score columns to contacts:
   ```sql
   ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS ai_score NUMERIC(5,2);
   ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_category TEXT;
   ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,4);
   ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS model_version TEXT;
   NOTIFY pgrst, 'reload schema';
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:8080](http://localhost:8080)

---

## Usage

1. **Sign up / Sign in** at `/auth`
2. **Upload a file** — drag or click to upload a `.csv` or `.xlsx`  
   Required column: `email`  
   Optional: `first_name`, `last_name`, `company`, `phone`, `title`, `industry`, `country`, `source`
3. **Click "Score all"** — the AI engine classifies every contact instantly
4. **Browse by category** — use the Hot / Warm / Cold tabs to filter
5. **Reprocess any lead** — click the ↺ icon on any row to re-run the model

### Sample Data
A sample Excel file with 42 pre-built leads (12 Hot, 12 Warm, 12 Cold, 6 edge cases) is included:
```
sample-leads.xlsx
```

---

## Project Structure

```
src/
├── routes/
│   ├── index.tsx                    # Landing page
│   ├── auth.tsx                     # Sign in / Sign up
│   └── _authenticated/
│       ├── route.tsx                # Auth guard layout
│       └── dashboard.tsx            # Main dashboard
├── lib/
│   ├── ai/
│   │   ├── features.ts              # Feature engineering
│   │   ├── classifier.ts            # Weighted ensemble model
│   │   ├── pipeline.ts              # Batch classification pipeline
│   │   └── logger.ts                # Structured JSON logger
│   ├── api/
│   │   ├── leads.functions.ts       # GET /api/leads endpoints
│   │   └── setup.functions.ts       # DB setup utilities
│   └── import.functions.ts          # CSV/XLSX import server function
├── integrations/
│   └── supabase/
│       ├── client.ts                # Browser Supabase client
│       ├── client.server.ts         # Server-side admin client
│       ├── auth-middleware.ts       # JWT auth middleware
│       ├── auth-attacher.ts         # Client-side token attacher
│       └── types.ts                 # Generated DB types
supabase/
└── migrations/                      # SQL migration files
```

---

## AI Model Details

The classifier uses a **weighted linear ensemble** with sigmoid normalisation:

```
score = sigmoid(
  businessEmail    × 0.25 +
  corporateTLD     × 0.08 +
  completeness     × 0.12 +
  titleSeniority   × 0.22 +
  industryMatch    × 0.13 +
  geography        × 0.08 +
  sourceQuality    × 0.07 +
  dataRichness     × 0.05
) × 100
```

**Classification thresholds:**
- **Hot** — score ≥ 68
- **Warm** — score ≥ 38
- **Cold** — score < 38

Model is versioned (`v1.0.0`) and weights can be swapped without retraining by updating `ACTIVE_MODEL` in `src/lib/ai/classifier.ts`.

---

## Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key |
| `VITE_SUPABASE_URL` | Same URL exposed to client |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same key exposed to client |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (optional, for admin ops) |

---

## License

MIT
