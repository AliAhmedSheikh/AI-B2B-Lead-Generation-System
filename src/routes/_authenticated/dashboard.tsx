import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { importContacts } from "@/lib/import.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, LogOut, Mail, FileCheck2, AlertCircle, Copy } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Lead Pipeline" }] }),
  component: Dashboard,
});

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

type Contact = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  created_at: string;
};

function Dashboard() {
  const navigate = useNavigate();
  const runImport = useServerFn(importContacts);
  const [email, setEmail] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [counts, setCounts] = useState({ contacts: 0 });

  const refresh = async () => {
    const [logsRes, contactsRes, countRes] = await Promise.all([
      supabase.from("import_logs").select("*").order("created_at", { ascending: false }).limit(10),
      supabase.from("contacts").select("id,email,first_name,last_name,company,created_at").order("created_at", { ascending: false }).limit(20),
      supabase.from("contacts").select("id", { count: "exact", head: true }),
    ]);
    if (logsRes.data) setLogs(logsRes.data as ImportLog[]);
    if (contactsRes.data) setContacts(contactsRes.data as Contact[]);
    setCounts({ contacts: countRes.count ?? 0 });
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
    refresh();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const parseFile = async (file: File): Promise<Record<string, unknown>[]> => {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv")) {
      const Papa = (await import("papaparse")).default;
      return new Promise((resolve, reject) => {
        Papa.parse<Record<string, unknown>>(file, {
          header: true,
          skipEmptyLines: true,
          complete: (res) => resolve(res.data),
          error: (err) => reject(err),
        });
      });
    }
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    }
    throw new Error("Unsupported file type. Use .csv or .xlsx");
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const rows = await parseFile(file);
      if (rows.length === 0) {
        toast.error("No rows found in file");
        return;
      }
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const fileType = ext === "csv" ? "csv" : "xlsx";
      const result = await runImport({
        data: { fileName: file.name, fileType, rows: rows as Record<string, unknown>[] },
      });
      if (result.status === "failed") {
        toast.error(`Import failed: ${result.errorMessage ?? "unknown error"}`);
      } else {
        toast.success(
          `Imported ${result.inserted} new · ${result.duplicates} duplicates · ${result.invalid} invalid`,
        );
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Lead Pipeline</h1>
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="size-4 mr-2" /> Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <section className="grid sm:grid-cols-3 gap-4">
          <StatCard icon={<Mail className="size-4" />} label="Total contacts" value={counts.contacts} />
          <StatCard icon={<FileCheck2 className="size-4" />} label="Imports" value={logs.length} />
          <StatCard icon={<AlertCircle className="size-4" />} label="AI processing" value="Queued" />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Import emails</CardTitle>
            <CardDescription>
              Upload a CSV or XLSX. The system validates emails, removes duplicates, and stores clean
              records ready for AI processing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-10 cursor-pointer hover:bg-accent/50 transition">
              <Upload className="size-8 text-muted-foreground" />
              <span className="text-sm font-medium">
                {uploading ? "Processing…" : "Click to upload .csv or .xlsx"}
              </span>
              <span className="text-xs text-muted-foreground">
                Expected column: <code>email</code> (others like first_name, last_name, company, phone are optional)
              </span>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                  e.target.value = "";
                }}
              />
            </label>
          </CardContent>
        </Card>

        <section className="grid lg:grid-cols-2 gap-6">
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium truncate max-w-[160px]">{l.file_name}</TableCell>
                        <TableCell className="text-right">{l.inserted_count}</TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Copy className="size-3" />
                            {l.duplicate_count}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{l.invalid_count}</TableCell>
                        <TableCell>
                          <Badge variant={l.status === "completed" ? "secondary" : "destructive"}>
                            {l.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent contacts</CardTitle>
              <CardDescription>Latest 20 imported records.</CardDescription>
            </CardHeader>
            <CardContent>
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No contacts yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.email}</TableCell>
                        <TableCell className="text-sm">
                          {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{c.company ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="text-3xl font-semibold mt-2">{value}</div>
      </CardContent>
    </Card>
  );
}
