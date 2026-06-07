import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { importContacts } from "@/lib/import.functions";
import { getLeads } from "@/lib/api/leads.functions";
import { classifyAllContacts, reprocessSingleContact } from "@/lib/ai/pipeline";
import { enrichLead, enrichBulk, getEnrichmentStats } from "@/lib/api/enrichment.functions";
import type { ScoredContact } from "@/lib/ai/pipeline";
import type { LeadWithScore } from "@/lib/api/leads.functions";
import type { EnrichmentProfile } from "@/lib/api/enrichment.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Upload, LogOut, Mail, Flame, Thermometer, Snowflake,
  RefreshCw, Cpu, RotateCcw, Copy, Sparkles, Globe,
  Building2, MapPin, Users, ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Lead Pipeline" }] }),
  component: Dashboard,
});

// ── types ────────────────────────────────────────────────────────────────────
type ImportLog = {
  id: string; file_name: string; file_type: string | null;
  total_rows: number; inserted_count: number; duplicate_count: number;
  invalid_count: number; status: string; created_at: string;
};
type ScoreCounts = { Hot: number; Warm: number; Cold: number; Unscored: number };
type EnrichStats = { completed: number; failed: number; skipped: number; pending: number };

// ── helpers ───────────────────────────────────────────────────────────────────
function categoryBadge(cat: string | null | undefined) {
  if (cat === "Hot")  return <Badge variant="destructive" className="gap-1 text-xs"><Flame className="size-3" />Hot</Badge>;
  if (cat === "Warm") return <Badge className="gap-1 text-xs bg-amber-500 hover:bg-amber-500 text-white"><Thermometer className="size-3" />Warm</Badge>;
  if (cat === "Cold") return <Badge variant="secondary" className="gap-1 text-xs"><Snowflake className="size-3" />Cold</Badge>;
  return <Badge variant="outline" className="text-muted-foreground text-xs">Unscored</Badge>;
}

function enrichStatusBadge(status: string | undefined) {
  if (status === "completed") return <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 border-green-200">Enriched</Badge>;
  if (status === "processing") return <Badge variant="outline" className="text-xs text-blue-600">Processing…</Badge>;
  if (status === "failed")    return <Badge variant="destructive" className="text-xs">Failed</Badge>;
  if (status === "skipped")   return <Badge variant="outline" className="text-xs text-muted-foreground">Skipped</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">Not enriched</Badge>;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 68 ? "bg-red-500" : score >= 38 ? "bg-amber-400" : "bg-sky-400";
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-1.5 rounded bg-muted overflow-hidden">
        <div className={`h-full rounded ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums w-8 text-right font-medium">{score}</span>
    </div>
  );
}

function applyScores(leads: LeadWithScore[], scores: ScoredContact[]): LeadWithScore[] {
  const map = new Map(scores.map((s) => [s.id, s]));
  return leads.map((l) => {
    const s = map.get(l.id);
    return s ? { ...l, score: { ai_score: s.ai_score, lead_category: s.lead_category, confidence_score: s.confidence_score, model_version: s.model_version } } : l;
  });
}

function buildCounts(leads: LeadWithScore[]): ScoreCounts {
  const c: ScoreCounts = { Hot: 0, Warm: 0, Cold: 0, Unscored: 0 };
  for (const l of leads) { if (!l.score) c.Unscored++; else c[l.score.lead_category]++; }
  return c;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard() {
  const navigate = useNavigate();

  const [userEmail, setUserEmail]       = useState("");
  const [uploading, setUploading]       = useState(false);
  const [scoring, setScoring]           = useState(false);
  const [enriching, setEnriching]       = useState(false);
  const [logs, setLogs]                 = useState<ImportLog[]>([]);
  const [leads, setLeads]               = useState<LeadWithScore[]>([]);
  const [enrichments, setEnrichments]   = useState<Record<string, EnrichmentProfile>>({});
  const [enrichStats, setEnrichStats]   = useState<EnrichStats>({ completed: 0, failed: 0, skipped: 0, pending: 0 });
  const [totalContacts, setTotalContacts] = useState(0);
  const [mainTab, setMainTab]           = useState<"leads" | "enrichment" | "imports">("leads");
  const [leadsTab, setLeadsTab]         = useState<"all" | "Hot" | "Warm" | "Cold">("all");
  const [enrichingId, setEnrichingId]   = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const scoreCounts = buildCounts(leads);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadEnrichments = useCallback(async () => {
    const [statsRes, rowsRes] = await Promise.all([
      getEnrichmentStats({ data: {} }).catch(() => ({ completed: 0, failed: 0, skipped: 0, pending: 0 })),
      supabase.from("lead_enrichment").select("*").order("enriched_at", { ascending: false }).limit(200),
    ]);
    setEnrichStats(statsRes);
    if (rowsRes.data) {
      const map: Record<string, EnrichmentProfile> = {};
      for (const r of rowsRes.data) map[r.contact_id] = r as EnrichmentProfile;
      setEnrichments(map);
    }
  }, []);

  const refresh = useCallback(async () => {
    const [logsRes, leadsRes, countRes] = await Promise.all([
      supabase.from("import_logs").select("*").order("created_at", { ascending: false }).limit(10),
      getLeads({ data: { limit: 200, offset: 0 } }).catch(() => ({ leads: [] as LeadWithScore[], total: 0 })),
      supabase.from("contacts").select("id", { count: "exact", head: true }),
    ]);
    if (logsRes.data) setLogs(logsRes.data as ImportLog[]);
    setLeads(leadsRes?.leads ?? []);
    setTotalContacts(countRes.count ?? 0);
    await loadEnrichments();
  }, [loadEnrichments]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ""));
    refresh();
  }, [refresh]);

  // ── file parsing ──────────────────────────────────────────────────────────
  const parseFile = async (file: File): Promise<Record<string, unknown>[]> => {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv")) {
      const Papa = (await import("papaparse")).default;
      return new Promise((resolve, reject) =>
        Papa.parse<Record<string, unknown>>(file, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data), error: reject })
      );
    }
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    }
    throw new Error("Unsupported file type. Use .csv or .xlsx");
  };

  // ── import ────────────────────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const rows = await parseFile(file);
      if (!rows.length) { toast.error("No rows found in file"); return; }
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const result = await importContacts({ data: { fileName: file.name, fileType: ext === "csv" ? "csv" : "xlsx", rows } });
      if (result.status === "failed") toast.error(`Import failed: ${result.errorMessage ?? "unknown error"}`);
      else toast.success(`Imported ${result.inserted} contacts`);
      await refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Upload failed"); }
    finally { setUploading(false); }
  };

  // ── score all ─────────────────────────────────────────────────────────────
  const handleScoreAll = async () => {
    if (!totalContacts) return;
    setScoring(true);
    try {
      const result = await classifyAllContacts({ data: {} });
      setLeads((prev) => applyScores(prev, result.scores));
      toast.success(`Scored ${result.scores.length} leads in ${result.elapsed}ms`);
      setTimeout(() => refresh(), 1500);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Scoring failed"); }
    finally { setScoring(false); }
  };

  // ── reprocess single ──────────────────────────────────────────────────────
  const handleReprocess = async (id: string) => {
    setReprocessingId(id);
    try {
      const score = await reprocessSingleContact({ data: { id } });
      setLeads((prev) => applyScores(prev, [score]));
      toast.success(`${score.lead_category} · ${score.ai_score}/100`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Reprocess failed"); }
    finally { setReprocessingId(null); }
  };

  // ── enrich bulk ───────────────────────────────────────────────────────────
  const handleEnrichAll = async (onlyHot = false) => {
    setEnriching(true);
    try {
      const result = await enrichBulk({ data: { batchSize: 20, onlyHot, force: false } });
      toast.success(`Enriched ${result.completed} · Skipped ${result.skipped} · Failed ${result.failed}${result.remaining > 0 ? ` · ${result.remaining} remaining` : ""}`);
      await loadEnrichments();
      await refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Enrichment failed"); }
    finally { setEnriching(false); }
  };

  // ── enrich single ─────────────────────────────────────────────────────────
  const handleEnrichOne = async (contactId: string) => {
    setEnrichingId(contactId);
    try {
      const result = await enrichLead({ data: { contactId, force: true } });
      toast.success(`Enriched: ${result.status}`);
      await loadEnrichments();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Enrichment failed"); }
    finally { setEnrichingId(null); }
  };

  const filteredLeads = leadsTab === "all" ? leads : leads.filter((l) => l.score?.lead_category === leadsTab);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider>
    <div className="min-h-screen bg-background">

      {/* Header */}
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Lead Pipeline</h1>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleScoreAll} disabled={scoring || !totalContacts}>
              <Cpu className={`size-4 mr-2 ${scoring ? "animate-pulse" : ""}`} />
              {scoring ? "Scoring…" : "Score all"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleEnrichAll(false)} disabled={enriching || !totalContacts}>
              <Sparkles className={`size-4 mr-2 ${enriching ? "animate-pulse" : ""}`} />
              {enriching ? "Enriching…" : "Enrich all"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut().then(() => navigate({ to: "/auth", replace: true }))}>
              <LogOut className="size-4 mr-2" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Stat cards */}
        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          <StatCard icon={<Mail className="size-4" />}                              label="Contacts"    value={totalContacts} />
          <StatCard icon={<Flame       className="size-4 text-red-500" />}          label="Hot"         value={scoreCounts.Hot}  pct={totalContacts ? Math.round(scoreCounts.Hot  / totalContacts * 100) : 0} />
          <StatCard icon={<Thermometer className="size-4 text-amber-500" />}        label="Warm"        value={scoreCounts.Warm} pct={totalContacts ? Math.round(scoreCounts.Warm / totalContacts * 100) : 0} />
          <StatCard icon={<Snowflake   className="size-4 text-sky-500" />}          label="Cold"        value={scoreCounts.Cold} pct={totalContacts ? Math.round(scoreCounts.Cold / totalContacts * 100) : 0} />
          <StatCard icon={<Sparkles    className="size-4 text-purple-500" />}       label="Enriched"    value={enrichStats.completed} />
          <StatCard icon={<Globe       className="size-4 text-emerald-500" />}      label="Skipped"     value={enrichStats.skipped} />
        </section>

        {/* Score distribution */}
        {(scoreCounts.Hot + scoreCounts.Warm + scoreCounts.Cold) > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Score distribution</CardTitle></CardHeader>
            <CardContent>
              <div className="flex h-4 rounded overflow-hidden gap-px">
                {scoreCounts.Hot  > 0 && <div className="bg-red-500"   style={{ width: `${scoreCounts.Hot  / totalContacts * 100}%` }} />}
                {scoreCounts.Warm > 0 && <div className="bg-amber-400" style={{ width: `${scoreCounts.Warm / totalContacts * 100}%` }} />}
                {scoreCounts.Cold > 0 && <div className="bg-sky-400"   style={{ width: `${scoreCounts.Cold / totalContacts * 100}%` }} />}
                {scoreCounts.Unscored > 0 && <div className="bg-muted flex-1" />}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                {[["bg-red-500", "Hot", scoreCounts.Hot], ["bg-amber-400", "Warm", scoreCounts.Warm], ["bg-sky-400", "Cold", scoreCounts.Cold]] .map(([c, l, v]) => (
                  <span key={l as string} className="flex items-center gap-1">
                    <span className={`size-2 rounded-full ${c} inline-block`} />{l} ({v})
                  </span>
                ))}
                {scoreCounts.Unscored > 0 && <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-muted-foreground inline-block" />Unscored ({scoreCounts.Unscored})</span>}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Import box */}
        <Card>
          <CardHeader>
            <CardTitle>Import emails</CardTitle>
            <CardDescription>Upload CSV or XLSX. Contacts are validated, deduplicated, scored and enriched automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-10 cursor-pointer hover:bg-accent/50 transition">
              <Upload className="size-8 text-muted-foreground" />
              <span className="text-sm font-medium">{uploading ? "Processing…" : "Click to upload .csv or .xlsx"}</span>
              <span className="text-xs text-muted-foreground">Required: <code>email</code> · Optional: first_name, last_name, company, phone, title, industry, country, source</span>
              <Input type="file" accept=".csv,.xlsx,.xls" className="hidden" disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
            </label>
          </CardContent>
        </Card>

        {/* Main tabs */}
        <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as typeof mainTab)}>
          <TabsList>
            <TabsTrigger value="leads">Leads ({leads.length})</TabsTrigger>
            <TabsTrigger value="enrichment">
              <Sparkles className="size-3 mr-1" />Enrichment ({enrichStats.completed})
            </TabsTrigger>
            <TabsTrigger value="imports">Imports ({logs.length})</TabsTrigger>
          </TabsList>

          {/* ── Leads tab ── */}
          <TabsContent value="leads">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>AI-Classified Leads</CardTitle>
                    <CardDescription>Click <RotateCcw className="size-3 inline" /> to re-score · <Sparkles className="size-3 inline" /> to enrich</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw className="size-4" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs value={leadsTab} onValueChange={(v) => setLeadsTab(v as typeof leadsTab)}>
                  <TabsList className="mb-4">
                    <TabsTrigger value="all">All ({leads.length})</TabsTrigger>
                    <TabsTrigger value="Hot"><Flame className="size-3 mr-1 text-red-500" />Hot ({scoreCounts.Hot})</TabsTrigger>
                    <TabsTrigger value="Warm"><Thermometer className="size-3 mr-1 text-amber-500" />Warm ({scoreCounts.Warm})</TabsTrigger>
                    <TabsTrigger value="Cold"><Snowflake className="size-3 mr-1 text-sky-500" />Cold ({scoreCounts.Cold})</TabsTrigger>
                  </TabsList>
                  {(["all", "Hot", "Warm", "Cold"] as const).map((tab) => (
                    <TabsContent key={tab} value={tab}>
                      {filteredLeads.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">
                          {leads.length === 0 ? "No contacts yet. Upload a file to get started." : "No leads in this category."}
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Email</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Company</TableHead>
                                <TableHead>Category</TableHead>
                                <TableHead>AI Score</TableHead>
                                <TableHead>Confidence</TableHead>
                                <TableHead>Enrichment</TableHead>
                                <TableHead className="w-16" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredLeads.map((lead) => {
                                const enr = enrichments[lead.id];
                                return (
                                  <TableRow key={lead.id}>
                                    <TableCell className="font-mono text-xs max-w-[180px] truncate">{lead.email}</TableCell>
                                    <TableCell className="text-sm">{[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "—"}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground max-w-[130px] truncate">
                                      {enr?.company_name ?? lead.company ?? "—"}
                                    </TableCell>
                                    <TableCell>{categoryBadge(lead.score?.lead_category)}</TableCell>
                                    <TableCell>
                                      {lead.score ? <ScoreBar score={lead.score.ai_score} /> : <span className="text-muted-foreground text-xs">—</span>}
                                    </TableCell>
                                    <TableCell className="text-xs font-medium">
                                      {lead.score ? (
                                        <span className={lead.score.confidence_score >= 0.7 ? "text-green-600" : "text-amber-600"}>
                                          {Math.round(lead.score.confidence_score * 100)}%
                                        </span>
                                      ) : "—"}
                                    </TableCell>
                                    <TableCell>{enrichStatusBadge(enr?.enrichment_status)}</TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-1">
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button variant="ghost" size="icon" className="size-7"
                                              onClick={() => handleReprocess(lead.id)} disabled={reprocessingId === lead.id}>
                                              <RotateCcw className={`size-3 ${reprocessingId === lead.id ? "animate-spin" : ""}`} />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Re-score</TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button variant="ghost" size="icon" className="size-7"
                                              onClick={() => handleEnrichOne(lead.id)} disabled={enrichingId === lead.id}>
                                              <Sparkles className={`size-3 ${enrichingId === lead.id ? "animate-pulse text-purple-500" : ""}`} />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Enrich</TooltipContent>
                                        </Tooltip>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Enrichment tab ── */}
          <TabsContent value="enrichment">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Lead Enrichment</CardTitle>
                    <CardDescription>Company intelligence gathered from public data sources.</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleEnrichAll(true)} disabled={enriching}>
                      <Flame className="size-4 mr-2 text-red-500" />
                      {enriching ? "Enriching…" : "Enrich Hot leads"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleEnrichAll(false)} disabled={enriching}>
                      <Sparkles className="size-4 mr-2" />
                      {enriching ? "Enriching…" : "Enrich all"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={loadEnrichments}><RefreshCw className="size-4" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {Object.keys(enrichments).length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <Sparkles className="size-10 mx-auto text-muted-foreground" />
                    <p className="text-sm font-medium">No enrichments yet</p>
                    <p className="text-xs text-muted-foreground">Click "Enrich all" to start gathering company data for your leads.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Domain</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead>Industry</TableHead>
                          <TableHead>Country</TableHead>
                          <TableHead>Size</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Links</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.values(enrichments).map((enr) => (
                          <TableRow key={enr.id}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {enr.domain ?? "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {enr.logo_url && (
                                  <img src={enr.logo_url} alt="" className="size-5 rounded object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                )}
                                <span className="text-sm font-medium">{enr.company_name ?? "—"}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {enr.industry ? (
                                <span className="inline-flex items-center gap-1 text-xs">
                                  <Building2 className="size-3 text-muted-foreground" />{enr.industry}
                                </span>
                              ) : "—"}
                            </TableCell>
                            <TableCell>
                              {enr.country ? (
                                <span className="inline-flex items-center gap-1 text-xs">
                                  <MapPin className="size-3 text-muted-foreground" />{enr.country}
                                </span>
                              ) : "—"}
                            </TableCell>
                            <TableCell>
                              {enr.company_size ? (
                                <span className="inline-flex items-center gap-1 text-xs">
                                  <Users className="size-3 text-muted-foreground" />{enr.company_size}
                                </span>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="max-w-[220px]">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs text-muted-foreground line-clamp-2 cursor-default">
                                    {enr.company_description ?? "—"}
                                  </span>
                                </TooltipTrigger>
                                {enr.company_description && (
                                  <TooltipContent className="max-w-xs">{enr.company_description}</TooltipContent>
                                )}
                              </Tooltip>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {enr.website && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <a href={enr.website} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                                        <Globe className="size-3.5" />
                                      </a>
                                    </TooltipTrigger>
                                    <TooltipContent>Website</TooltipContent>
                                  </Tooltip>
                                )}
                                {enr.linkedin_url && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <a href={enr.linkedin_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                                        <ExternalLink className="size-3.5" />
                                      </a>
                                    </TooltipTrigger>
                                    <TooltipContent>LinkedIn</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{enrichStatusBadge(enr.enrichment_status)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Imports tab ── */}
          <TabsContent value="imports">
            <Card>
              <CardHeader><CardTitle>Import History</CardTitle></CardHeader>
              <CardContent>
                {logs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No imports yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead className="text-right">New</TableHead>
                        <TableHead className="text-right">Dupes</TableHead>
                        <TableHead className="text-right">Invalid</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium truncate max-w-[160px]">{l.file_name}</TableCell>
                          <TableCell className="text-right">{l.inserted_count}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            <span className="inline-flex items-center gap-1"><Copy className="size-3" />{l.duplicate_count}</span>
                          </TableCell>
                          <TableCell className="text-right">{l.invalid_count}</TableCell>
                          <TableCell>
                            <Badge variant={l.status === "completed" ? "secondary" : "destructive"}>{l.status}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(l.created_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </main>
    </div>
    </TooltipProvider>
  );
}

function StatCard({ icon, label, value, pct }: {
  icon: React.ReactNode; label: string; value: number; pct?: number;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="text-3xl font-semibold mt-2">{value}</div>
        {pct !== undefined && <div className="text-xs text-muted-foreground mt-0.5">{pct}% of total</div>}
      </CardContent>
    </Card>
  );
}
