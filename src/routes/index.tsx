import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Upload, ShieldCheck, Sparkles, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lead Pipeline — Import & enrich your email leads" },
      {
        name: "description",
        content:
          "Upload CSV or XLSX email lists. We validate, deduplicate, and prepare your contacts for AI-powered enrichment and scoring.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <span className="font-semibold tracking-tight">Lead Pipeline</span>
        <div className="flex items-center gap-3">
          <Link to="/auth">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link to="/auth">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-32 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-sm text-muted-foreground mb-8">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          AI-powered lead management
        </div>

        <h1 className="text-5xl sm:text-7xl font-bold tracking-tight leading-tight">
          Clean email leads,<br />
          <span className="text-gradient">ready for AI.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Upload your raw CSV or XLSX. We validate, deduplicate, and store every contact in your
          private workspace — ready for the AI layer to enrich, score, and qualify.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link to="/auth">
            <Button size="lg" className="gap-2">
              Start importing <ArrowRight className="size-4" />
            </Button>
          </Link>
          <Link to="/auth">
            <Button variant="outline" size="lg">Learn more</Button>
          </Link>
        </div>

        <div className="mt-28 grid sm:grid-cols-3 gap-4 text-left">
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
    <div className="rounded-xl border bg-card p-6 card-hover">
      <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 text-primary">
        {icon}
      </div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}
