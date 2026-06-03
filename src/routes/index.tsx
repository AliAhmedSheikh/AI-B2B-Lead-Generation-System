import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Upload, ShieldCheck, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lead Pipeline — Import & enrich your email leads" },
      {
        name: "description",
        content:
          "Upload CSV or XLSX email lists. We validate, deduplicate, and prepare your contacts for AI-powered enrichment and scoring.",
      },
      { property: "og:title", content: "Lead Pipeline" },
      { property: "og:description", content: "Import emails. We clean, dedupe, and prep them for AI." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <span className="font-semibold">Lead Pipeline</span>
        <Link to="/auth">
          <Button size="sm">Sign in</Button>
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-24 text-center">
        <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight">
          Clean email leads,<br />ready for AI.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Upload your raw CSV or XLSX. We validate, deduplicate, and store every contact in your
          private workspace — ready for the AI layer to enrich, score, and qualify.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link to="/auth">
            <Button size="lg">Get started</Button>
          </Link>
        </div>

        <div className="mt-20 grid sm:grid-cols-3 gap-6 text-left">
          <Feature icon={<Upload className="size-5" />} title="Upload anything">
            CSV and XLSX files. Flexible column mapping for email, name, company, phone.
          </Feature>
          <Feature icon={<ShieldCheck className="size-5" />} title="Clean & isolated">
            Format-validated, deduplicated, and stored privately per user account.
          </Feature>
          <Feature icon={<Sparkles className="size-5" />} title="AI-ready">
            Clean data is handed off to the AI layer for enrichment and lead scoring.
          </Feature>
        </div>
      </main>
    </div>
  );
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
