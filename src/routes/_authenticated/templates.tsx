import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getTemplates, createTemplate, updateTemplate, deleteTemplate, duplicateTemplate } from "@/lib/api/templates.functions";
import { TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL, type TemplateType } from "@/lib/email/template-engine";
import type { TemplateRecord } from "@/lib/api/templates.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Copy, Pencil, Trash2, ArrowLeft, LayoutTemplate, Mail } from "lucide-react";

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({ meta: [{ title: "Templates — Lead Pipeline" }] }),
  component: TemplatesPage,
});

function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  // Edit / create state
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<TemplateType>("cold_outreach");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await getTemplates({ data: {} }).catch(() => ({ templates: [] }));
    setTemplates(result.templates);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredTemplates = filter === "all"
    ? templates
    : templates.filter(t => t.template_type === filter);

  const openNew = () => {
    setEditId(null);
    setFormName("");
    setFormType("cold_outreach");
    setFormSubject("");
    setFormBody("");
    setEditOpen(true);
  };

  const openEdit = (t: TemplateRecord) => {
    setEditId(t.id);
    setFormName(t.name);
    setFormType(t.template_type as TemplateType);
    setFormSubject(t.subject_template);
    setFormBody(t.body_template);
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (editId) {
        await updateTemplate({ data: { id: editId, data: { name: formName, template_type: formType, subject_template: formSubject, body_template: formBody } } });
        toast.success("Template updated");
      } else {
        await createTemplate({ data: { name: formName, template_type: formType, subject_template: formSubject, body_template: formBody } });
        toast.success("Template created");
      }
      setEditOpen(false);
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Save failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    try {
      await deleteTemplate({ data: { id } });
      toast.success("Template deleted");
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Delete failed"); }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateTemplate({ data: { id } });
      toast.success("Template duplicated");
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Duplicate failed"); }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/dashboard" })}>
              <ArrowLeft className="size-4 mr-1" /> Dashboard
            </Button>
            <div>
              <h1 className="text-xl font-semibold">Email Templates</h1>
              <p className="text-xs text-muted-foreground">Manage your email templates</p>
            </div>
          </div>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openNew}><Plus className="size-4 mr-2" /> New template</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editId ? "Edit template" : "New template"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <label className="text-sm font-medium mb-1 block">Name</label>
                  <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="My Template" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Type</label>
                  <Select value={formType} onValueChange={v => setFormType(v as TemplateType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Subject template</label>
                  <Input value={formSubject} onChange={e => setFormSubject(e.target.value)} placeholder="Hi {{first_name}}, quick question" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Body template</label>
                  <Textarea value={formBody} onChange={e => setFormBody(e.target.value)} rows={12}
                    placeholder={"Hi {{first_name}},\n\nI came across {{company_name}}...\n\nBest,\n{{sender_name}}"} />
                </div>
                <div className="text-xs text-muted-foreground bg-muted rounded p-3 space-y-1">
                  <p className="font-medium mb-1">Available variables:</p>
                  <code className="block">{`{{first_name}} {{last_name}} {{company_name}} {{industry}} {{country}} {{lead_score}} {{lead_category}} {{sender_name}}`}</code>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={filter === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setFilter("all")}>All</Badge>
          {TEMPLATE_TYPES.map(t => (
            <Badge key={t.value} variant={filter === t.value ? "default" : "outline"} className="cursor-pointer" onClick={() => setFilter(t.value)}>
              {t.label}
            </Badge>
          ))}
        </div>

        {/* Template list */}
        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading…</div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <LayoutTemplate className="size-12 mx-auto mb-4 opacity-30" />
            <p>No templates found</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={openNew}>Create your first template</Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map(t => (
              <Card key={t.id} className="card-hover">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold">{t.name}</CardTitle>
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {TEMPLATE_TYPE_LABEL[t.template_type as TemplateType] ?? t.template_type}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-xs text-muted-foreground truncate">
                    <span className="font-medium">Subject:</span> {t.subject_template || "(none)"}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-3">
                    {t.body_template || "(empty)"}
                  </div>
                  <div className="flex items-center gap-1 pt-2">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(t)} title="Edit">
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => handleDuplicate(t.id)} title="Duplicate">
                      <Copy className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => handleDelete(t.id)} title="Delete">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
