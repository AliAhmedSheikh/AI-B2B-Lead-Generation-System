import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getLeads, type LeadWithScore } from "@/lib/api/leads.functions";
import { getTemplates, type TemplateRecord } from "@/lib/api/templates.functions";
import { generateEmailDraft, generateBulkDrafts, getDrafts, deleteDraft, type DraftRecord } from "@/lib/api/email-drafts.functions";
import { TEMPLATE_TYPE_LABEL, recommendTemplates, type TemplateType, type LeadCategory } from "@/lib/email/template-engine";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Mail, Sparkles, FileText, Flame, Thermometer, Snowflake, CheckCircle2, Clock, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/emails")({
  head: () => ({ meta: [{ title: "Email Generation — Lead Pipeline" }] }),
  component: EmailsPage,
});

function categoryIcon(cat?: string | null) {
  if (cat === "Hot")  return <Flame className="size-3.5 text-red-500" />;
  if (cat === "Warm") return <Thermometer className="size-3.5 text-amber-500" />;
  if (cat === "Cold") return <Snowflake className="size-3.5 text-sky-500" />;
  return null;
}

function templateTypeBadge(type: string) {
  const label = TEMPLATE_TYPE_LABEL[type as TemplateType] ?? type;
  return <Badge variant="secondary" className="text-xs">{label}</Badge>;
}

function EmailsPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<LeadWithScore[]>([]);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedTemplateForLead, setSelectedTemplateForLead] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"generate" | "drafts">("generate");
  const [leadFilter, setLeadFilter] = useState<"all" | LeadCategory>("all");

  const load = async () => {
    setLoading(true);
    const [leadsRes, templatesRes, draftsRes] = await Promise.all([
      getLeads({ data: { limit: 200, offset: 0 } }).catch(() => ({ leads: [] as LeadWithScore[], total: 0 })),
      getTemplates({ data: {} }).catch(() => ({ templates: [] as TemplateRecord[] })),
      getDrafts({ data: { limit: 50, offset: 0 } }).catch(() => ({ drafts: [] as DraftRecord[], total: 0 })),
    ]);
    setLeads(leadsRes.leads);
    setTemplates(templatesRes.templates);
    setDrafts(draftsRes.drafts);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const scoredLeads = leads.filter(l => l.score);
  const filteredLeads = leadFilter === "all" ? scoredLeads : scoredLeads.filter(l => l.score?.lead_category === leadFilter);

  const handleGenerate = async (contactId: string, templateId: string) => {
    if (!templateId) { toast.error("Select a template first"); return; }
    setGenerating(contactId);
    try {
      await generateEmailDraft({ data: { contactId, templateId } });
      toast.success("Draft generated");
      const draftsRes = await getDrafts({ data: { limit: 50, offset: 0 } });
      setDrafts(draftsRes.drafts);
      setTab("drafts");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Generation failed"); }
    finally { setGenerating(null); }
  };

  const handleBulkGenerate = async () => {
    if (!selectedTemplate) { toast.error("Select a template first"); return; }
    const contactIds = filteredLeads.map(l => l.id);
    if (!contactIds.length) { toast.error("No leads to process"); return; }
    setBulkGenerating(true);
    try {
      const result = await generateBulkDrafts({ data: { contactIds, templateId: selectedTemplate } });
      toast.success(`Generated ${result.completed} drafts`);
      const draftsRes = await getDrafts({ data: { limit: 50, offset: 0 } });
      setDrafts(draftsRes.drafts);
      setTab("drafts");
    } catch (err) { toast.error(err instanceof Error ? err.message : "Bulk generation failed"); }
    finally { setBulkGenerating(false); }
  };

  const handleDeleteDraft = async (id: string) => {
    setDeletingDraftId(id);
    try {
      await deleteDraft({ data: { id } });
      toast.success("Draft deleted");
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch (err) { toast.error(err instanceof Error ? err.message : "Delete failed"); }
    finally { setDeletingDraftId(null); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/dashboard" })}>
              <ArrowLeft className="size-4 mr-1" /> Dashboard
            </Button>
            <div>
              <h1 className="text-xl font-semibold">Email Generation</h1>
              <p className="text-xs text-muted-foreground">Generate personalized email drafts</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {templates.length === 0 && (
                    <Button size="sm" variant="outline" onClick={() => navigate({ to: "/templates" })}>
                <FileText className="size-4 mr-2" /> Create templates first
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Tabs value={tab} onValueChange={v => setTab(v as "generate" | "drafts")}>
          <TabsList className="mb-6">
            <TabsTrigger value="generate" className="gap-2"><Sparkles className="size-4" /> Generate</TabsTrigger>
            <TabsTrigger value="drafts" className="gap-2"><Mail className="size-4" /> Drafts ({drafts.length})</TabsTrigger>
          </TabsList>

          {/* ── Generate tab ─────────────────────────────────────────────────── */}
          <TabsContent value="generate" className="space-y-6">
            {/* Template selector for bulk */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Bulk generation</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-3 flex-wrap">
                <div className="w-64">
                  <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                    <SelectTrigger><SelectValue placeholder="Select template…" /></SelectTrigger>
                    <SelectContent>
                      {templates.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} — {TEMPLATE_TYPE_LABEL[t.template_type as TemplateType] ?? t.template_type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleBulkGenerate} disabled={bulkGenerating || !selectedTemplate || !filteredLeads.length}>
                  {bulkGenerating ? "Generating…" : `Generate for ${filteredLeads.length} leads`}
                </Button>
              </CardContent>
            </Card>

            {/* Lead filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={leadFilter === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setLeadFilter("all")}>All scored</Badge>
              {(["Hot", "Warm", "Cold"] as const).map(cat => (
                <Badge key={cat} variant={leadFilter === cat ? "default" : "outline"} className="cursor-pointer gap-1" onClick={() => setLeadFilter(cat)}>
                  {categoryIcon(cat)} {cat} ({scoredLeads.filter(l => l.score?.lead_category === cat).length})
                </Badge>
              ))}
            </div>

            {/* Lead list */}
            {loading ? (
              <div className="text-center text-muted-foreground py-12">Loading…</div>
            ) : filteredLeads.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                <Mail className="size-12 mx-auto mb-4 opacity-30" />
                <p>No leads to generate emails for</p>
                <p className="text-xs mt-1">Score your leads first from the Dashboard</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredLeads.map(lead => {
                  const category = lead.score?.lead_category ?? "Cold";
                  const recs = recommendTemplates(category);
                  const sel = selectedTemplateForLead[lead.id] ?? "";

                  return (
                    <Card key={lead.id} className="card-hover">
                      <CardContent className="pt-4 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">
                              {lead.first_name ?? lead.email}
                            </span>
                            {categoryIcon(category)}
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {lead.company ? `${lead.company} · ` : ""}{lead.email}
                          </div>
                          {lead.score && (
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {recs.map(rt => (
                                <Badge key={rt} variant="outline" className="text-xs text-primary cursor-pointer"
                                  onClick={() => setSelectedTemplateForLead(prev => ({ ...prev, [lead.id]: templates.find(t => t.template_type === rt)?.id ?? "" }))}>
                                  {TEMPLATE_TYPE_LABEL[rt]} ✓
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="w-44">
                            <Select value={sel} onValueChange={v => setSelectedTemplateForLead(prev => ({ ...prev, [lead.id]: v }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Template…" /></SelectTrigger>
                              <SelectContent>
                                {templates.map(t => (
                                  <SelectItem key={t.id} value={t.id} className="text-xs">
                                    {templateTypeBadge(t.template_type)} {t.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button size="sm" className="h-8" disabled={generating === lead.id || !sel}
                            onClick={() => handleGenerate(lead.id, sel)}>
                            {generating === lead.id ? "…" : "Generate"}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Drafts tab ───────────────────────────────────────────────────── */}
          <TabsContent value="drafts" className="space-y-4">
            {drafts.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                <Mail className="size-12 mx-auto mb-4 opacity-30" />
                <p>No drafts yet</p>
              </div>
            ) : (
              drafts.map(d => {
                const meta = (d.metadata ?? {}) as Record<string, unknown>;
                const category = meta.lead_category as string ?? "";
                const templateType = meta.template_type as string ?? "";
                const lead = leads.find(l => l.id === d.contact_id);

                return (
                  <Card key={d.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-sm font-semibold">{d.subject}</CardTitle>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground">To: {lead?.first_name ?? d.contact_id}</span>
                            {category && categoryIcon(category)}
                            {templateType && templateTypeBadge(templateType)}
                            <Badge variant="outline" className="text-xs gap-1">
                              {d.generation_status === "completed" ? <CheckCircle2 className="size-3" /> : <Clock className="size-3" />}
                              {d.generation_status}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</span>
                          <Button variant="ghost" size="icon" className="size-7 text-destructive" disabled={deletingDraftId === d.id}
                            onClick={() => handleDeleteDraft(d.id)} title="Delete draft">
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-sm whitespace-pre-wrap rounded bg-muted p-4 text-muted-foreground max-h-60 overflow-y-auto">
                        {d.email_body}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
