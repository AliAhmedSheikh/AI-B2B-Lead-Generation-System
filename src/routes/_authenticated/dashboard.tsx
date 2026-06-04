import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { importContacts } from "@/lib/import.functions";
import { getLeads, reprocessLead } from "@/lib/api/leads.functions";
import { classifyAllContacts } from "@/lib/ai/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Upload, LogOut, Mail, FileCheck2, Flame, Thermometer,
  Snowflake, RefreshCw, Cpu, RotateCcw, Copy,
} from "lucide-react";
import type { LeadWithScore } from "@/lib/api/leads.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Lead Pipeline" }] }),
  component: Dashboard,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ImportLog = {
  id: string;
  file_name: string;
  file_type: string | null;
  total_rows: number;
  inserted_count: number;
  duplicate_count: number;
  invalid_count: number;
  status: string;
  created_at: string;
};

type ScoreCounts = { Hot: number; Warm: number; Cold: number; Unscored: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function categoryColor(cat: string | null | undefined) {
  if (cat === "Hot")  return "destructive" as const;
  if (cat === "Warm") return "default" as const;
  if (cat === "Cold") return "secondary" as const;
  return "outline" as const;
}

function categoryIcon(cat: string | null | undefined) {
  if (cat === "Hot")  return <Flame      className="size-3" />;
  if (cat === "Warm") return <Thermometer className="size-3" />;
  if (cat === "Cold") return <Snowflake   className="size-3" />;
  return null;
}

function scoreBar(score: number) {
  const color =
    score >= 68 ? "bg-red-500" :
    score >= 38 ? "bg-amber-400" :
                  "bg-sky-400";
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded bg-muted overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums w-8 text-right">{score}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
function Dashboard() {
  const navigate = useNavigate();
  const runImport        = useServerFn(importContacts);
  const runGetLeads      = useServerFn(getLeads);
  const runReprocess     = useServerFn(reprocessLead);
  const runClassifyAll   = useServerFn(classifyAllContacts);

  const [userEmail, setUserEmail]   = useState("");
  const [uploading, setUploading]   = useState(false);
  const [scoring, setScoring]       = useState(false);
  const [logs, setLogs]             = useState<ImportLog[]>([]);
  const [leads, setLeads]           = useState<LeadWithScore[]>([]);
  const [scoreCounts, setScoreCounts] = useState<ScoreCounts>({ Hot: 0, Warm: 0, Cold: 0, Unscored: 0 });
  const [totalContacts, setTotalContacts] = useState(0);
  const [activeTab, setActiveTab]   = useState<"all" | "Hot" | "Warm" | "Cold">("all");
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  const refresh = useCallback(async () => {
    const [logsRes, leadsRes, countRes] = await Promise.all([
      supabase.from("import_logs").select("*").order("created_at", { ascending: false }).limit(10),
      runGetLeads({ data: { limit: 200, offset: 0 } }),
      supabase.from("contacts").select("id", { count: "exact", head: true }),
    ]);

    if (logsRes.data) setLogs(logsRes.data as ImportLog[]);
    if (leadsRes?.leads) {
      setLeads(leadsRes.leads);
      const counts: ScoreCounts = { Hot: 0, Warm: 0, Cold: 0, Unscored: 0 };
      for (const l of leadsRes.leads) {
        if (!l.score) counts.Unscored++;
        else counts[l.score.lead_category]++;
      }
      setScoreCounts(counts);
    }
    setTotalContacts(countRes.count ?? 0);
  }, [runGetLeads]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ""));
    refresh();
  }, [refresh]);

  // -------------------------------------------------------------------------
  // File parsing
  // -------------------------------------------------------------------------
  const parseFile = async (file: File): Promise<Record<string, unknown>[]> => {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv")) {
      const Papa = (await import("papaparse")).default;
      return new Promise((resolve, reject) =>
        Papa.parse<Record<string, unknown>>(file, {
          header: true,
          skipEmptyLines: true,
          complete: (res) => resolve(res.data),
          error: reject,
        }),
      );
    }
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const XLSX = await import("xlsx");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    }
    throw new Error("Unsupported file type. Use .csv or .xlsx");
  };

  // -------------------------------------------------------------------------
  // Import handler
  // -------------------------------------------------------------------------
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const rows = await parseFile(file);
      if (rows.length === 0) { toast.error("No rows found in file"); return; }
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const result = await runImport({
        data: { fileName: file.name, fileType: ext === "csv" ? "csv" : "xlsx", rows },
      });
      if (result.status === "failed") {
        toast.error(`Import failed: ${result.errorMessage ?? "unknown error"}`);
      } else {
        toast.success(`Imported ${result.inserted} · ${result.duplicates} dupes · ${result.invalid} invalid`);
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Score all contacts
  // -------------------------------------------------------------------------
  const handleScoreAll = async () => {
    setScoring(true);
    try {
      const result = await runClassifyAll({ data: {} });
      toast.success(`AI scored ${result.scored} leads in ${result.elapsedMs}ms`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scoring failed");
    } finally {
      setScoring(false);
    }
  };

  // -------------------------------------------------------------------------
  // Reprocess single lead
  // -------------------------------------------------------------------------
  const handleReprocess = async (id: string) => {
    setReprocessingId(id);
    try {
      const result = await runReprocess({ data: { id } });
      toast.success(`Re-scored: ${result.leadCategory} (${result.aiScore})`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reprocess failed");
    } finally {
      setReprocessingId(null);
    }
  };

  // -------------------------------------------------------------------------
  // Filtered leads
  // -------------------------------------------------------------------------
  const filteredLeads = activeTab === "all"
    ? leads
    : leads.filter((l) => l.score?.lead_category === activeTab);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Lead Pipeline</h1>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleScoreAll}
              disabled={scoring || totalContacts === 0}
            >
              <Cpu className={`size-4 mr-2 ${scoring ? "animate-pulse" : ""}`} />
              {scoring ? "Scoring…" : "Score all"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut().then(() => navigate({ to: "/auth", replace: true }))}>
              <LogOut className="size-4 mr-2" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Stat cards */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard icon={<Mail className="size-4" />}        label="Total contacts" value={totalContacts} />
          <StatCard icon={<Flame className="size-4 text-red-500" />}        label="Hot leads"       value={scoreCounts.Hot}    sub={`${totalContacts ? Math.round(scoreCounts.Hot / totalContacts * 100) : 0}%`} />
          <StatCard icon={<Thermometer className="size-4 text-amber-500" />} label="Warm leads"      value={scoreCounts.Warm}   sub={`${totalContacts ? Math.round(scoreCounts.Warm / totalContacts * 100) : 0}%`} />
          <StatCard icon={<Snowflake className="size-4 text-sky-500" />}    label="Cold leads"      value={scoreCounts.Cold}   sub={`${totalContacts ? Math.round(scoreCounts.Cold / totalContacts * 100) : 0}%`} />
        </section>

        {/* Score distribution bar */}
        {totalContacts > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Score distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-4 rounded overflow-hidden gap-0.5">
                {scoreCounts.Hot > 0 && (
                  <div
                    className="bg-red-500 transition-all"
                    style={{ width: `${scoreCounts.Hot / totalContacts * 100}%` }}
                    title={`Hot: ${scoreCounts.Hot}`}
                  />
                )}
                {scoreCounts.Warm > 0 && (
                  <div
                    className="bg-amber-400 transition-all"
                    style={{ width: `${scoreCounts.Warm / totalContacts * 100}%` }}
                    title={`Warm: ${scoreCounts.Warm}`}
                  />
                )}
                {scoreCounts.Cold > 0 && (
                  <div
                    className="bg-sky-400 transition-all"
                    style={{ width: `${scoreCounts.Cold / totalContacts * 100}%` }}
                    title={`Cold: ${scoreCounts.Cold}`}
                  />
                )}
                {scoreCounts.Unscored > 0 && (
                  <div
                    className="bg-muted transition-all"
                    style={{ width: `${scoreCounts.Unscored / totalContacts * 100}%` }}
                    title={`Unscored: ${scoreCounts.Unscored}`}
                  />
                )}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-red-500" /> Hot ({scoreCounts.Hot})</span>
                <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-amber-400" /> Warm ({scoreCounts.Warm})</span>
                <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-sky-400" /> Cold ({scoreCounts.Cold})</span>
                {scoreCounts.Unscored > 0 && (
                  <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-muted-foreground" /> Unscored ({scoreCounts.Unscored})</span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Import */}
        <Card>
          <CardHeader>
            <CardTitle>Import emails</CardTitle>
            <CardDescription>
              Upload a CSV or XLSX. Contacts are validated, deduplicated, and automatically scored by the AI engine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-10 cursor-pointer hover:bg-accent/50 transition">
              <Upload className="size-8 text-muted-foreground" />
              <span className="text-sm font-medium">
                {uploading ? "Processing…" : "Click to upload .csv or .xlsx"}
              </span>
              <span className="text-xs text-muted-foreground">
                Required: <code>email</code>. Optional: first_name, last_name, company, phone, title, industry, country, source
              </span>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
              />
            </label>
          </CardContent>
        </Card>

        {/* Leads table with tabs */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Leads</CardTitle>
                <CardDescription>AI-classified contacts. Click reprocess to re-run the model.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={refresh}>
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
              <TabsList className="mb-4">
                <TabsTrigger value="all">All ({leads.length})</TabsTrigger>
                <TabsTrigger value="Hot">
                  <Flame className="size-3 mr-1 text-red-500" /> Hot ({scoreCounts.Hot})
                </TabsTrigger>
                <TabsTrigger value="Warm">
                  <Thermometer className="size-3 mr-1 text-amber-500" /> Warm ({scoreCounts.Warm})
                </TabsTrigger>
                <TabsTrigger value="Cold">
                  <Snowflake className="size-3 mr-1 text-sky-500" /> Cold ({scoreCounts.Cold})
                </TabsTrigger>
              </TabsList>

              {(["all", "Hot", "Warm", "Cold"] as const).map((tab) => (
                <TabsContent key={tab} value={tab}>
                  {filteredLeads.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      {leads.length === 0
                        ? "No contacts yet. Upload a file to get started."
                        : "No leads in this category."}
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
                            <TableHead>Model</TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredLeads.map((lead) => (
                            <TableRow key={lead.id}>
                              <TableCell className="font-mono text-xs max-w-[180px] truncate">
                                {lead.email}
                              </TableCell>
                              <TableCell className="text-sm">
                                {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "—"}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-[120px] truncate">
                                {lead.company ?? "—"}
                              </TableCell>
                              <TableCell>
                                {lead.score ? (
                                  <Badge variant={categoryColor(lead.score.lead_category)} className="gap-1">
                                    {categoryIcon(lead.score.lead_category)}
                                    {lead.score.lead_category}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-muted-foreground">Unscored</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {lead.score ? scoreBar(lead.score.ai_score) : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {lead.score
                                  ? `${Math.round(lead.score.confidence_score * 100)}%`
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {lead.score?.model_version ?? "—"}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  onClick={() => handleReprocess(lead.id)}
                                  disabled={reprocessingId === lead.id}
                                  title="Re-run AI classification"
                                >
                                  <RotateCcw className={`size-3 ${reprocessingId === lead.id ? "animate-spin" : ""}`} />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>

        {/* Import logs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent imports</CardTitle>
          </CardHeader>
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
                      <TableCell className="text-right">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Copy className="size-3" />{l.duplicate_count}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{l.invalid_count}</TableCell>
                      <TableCell>
                        <Badge variant={l.status === "completed" ? "secondary" : "destructive"}>
                          {l.status}
                        </Badge>
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

      </main>
    </div>
  );
}

function StatCard({
  icon, label, value, sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="text-3xl font-semibold mt-2">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub} of total</div>}
      </CardContent>
    </Card>
  );
}

// Keep Progress import used — suppress unused warning
void Progress;
