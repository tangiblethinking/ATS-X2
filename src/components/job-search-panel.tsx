import { useMemo, useRef, useState } from "react";
import {
  FileCode2,
  Search,
  Send,
  Filter,
  ArrowUpDown,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isPlausibleApiKey } from "@/lib/api-key-store";
import { looksLikeHtml } from "@/lib/html-clean";
import {
  extractJobTitle,
  searchAtsJobs,
  type JobPortal,
  type JobResult,
} from "@/lib/job-search";
import { MAX_RESUME_CHARS } from "@/lib/pipeline-types";

type SortKey = "date" | "title" | "salary" | "portal";

const PORTAL_LABEL: Record<JobPortal, string> = {
  workable: "Workable",
  greenhouse: "Greenhouse",
  lever: "Lever",
  dover: "Dover",
};

function salarySortValue(s: string | null): number {
  if (!s) return -1;
  const nums = s.replace(/,/g, "").match(/\d+/g);
  if (!nums?.length) return -1;
  return Number(nums[0]);
}

type Props = {
  resumeHtml: string;
  setResumeHtml: (v: string) => void;
  /** Gemini key — Send to inputs / pipeline only */
  apiKey: string;
  /** Serper key — Job Search only */
  searchApiKey: string;
  running: boolean;
  onSendToInputs: (job: JobResult) => void;
  onPickFile: (file: File | undefined) => void;
};

export function JobSearchPanel({
  resumeHtml,
  setResumeHtml,
  apiKey,
  searchApiKey,
  running,
  onSendToInputs,
  onPickFile,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [detectedTitle, setDetectedTitle] = useState("");
  const [titleOverride, setTitleOverride] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<JobResult[]>([]);
  const [portalFilter, setPortalFilter] = useState<JobPortal | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);

  const filteredSorted = useMemo(() => {
    let list = results;
    if (portalFilter !== "all") list = list.filter((r) => r.portal === portalFilter);
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = (a.postedAtMs ?? 0) - (b.postedAtMs ?? 0);
      else if (sortKey === "title") cmp = a.title.localeCompare(b.title);
      else if (sortKey === "portal") cmp = a.portal.localeCompare(b.portal);
      else if (sortKey === "salary") cmp = salarySortValue(a.salary) - salarySortValue(b.salary);
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [results, portalFilter, sortKey, sortAsc]);

  async function detectTitle() {
    if (!looksLikeHtml(resumeHtml) || resumeHtml.trim().length < 40) {
      toast.error("Load an HTML resume first.");
      return;
    }
    try {
      const res = await extractJobTitle({ data: { resumeHtml } });
      if (!res.ok) {
        toast.error(res.error);
        setDetectedTitle("");
        return;
      }
      setDetectedTitle(res.title);
      setTitleOverride(res.title);
      toast.success(`Detected title: ${res.title}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Title extraction failed.");
    }
  }

  async function runSearch() {
    const title = (titleOverride || detectedTitle).trim();
    if (!title) {
      toast.error("Detect or enter a job title first.");
      return;
    }
    // Job Search does NOT require a key when public fallback is enough,
    // but if a Serper key is saved we use it first.
    setSearching(true);
    setResults([]);
    try {
      const res = await searchAtsJobs({
        data: {
          title,
          searchApiKey: isPlausibleApiKey(searchApiKey) ? searchApiKey : undefined,
        },
      });
      if (!res.ok) {
        toast.error("Search failed.");
        return;
      }
      setResults(res.results);
      for (const e of res.errors) toast.error(e, { duration: 9000 });
      if (res.keyHint) {
        toast.message(`Job Search used Serper key ${res.keyHint}`);
      }
      if (res.results.length === 0) {
        toast.message("No recent listings found for that title on the four ATS portals.");
      } else {
        const via =
          res.engine === "serper"
            ? "Serper"
            : res.engine === "mixed"
              ? "public web search (Serper unavailable)"
              : "public web search";
        toast.success(
          `Found ${res.results.length} listing${res.results.length === 1 ? "" : "s"} via ${via}.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === "title" || key === "portal");
    }
  }

  return (
    <>
      <section className="stagger-in max-w-2xl">
        <h1 className="font-display text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
          Search Direct ATS job boards
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          Searches Workable, Greenhouse, Lever, and Dover for your title. Uses your{" "}
          <strong>Serper</strong> key when available; otherwise public web search.
          The <strong>Gemini</strong> key is only for the Pipeline (rewrite).
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Search inputs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="search-resume">Resume HTML</Label>
              <Button type="button" variant="ghost" size="sm" className="h-9" disabled={searching} onClick={() => fileRef.current?.click()}>
                <FileCode2 className="size-3.5" /> Load .html
              </Button>
              <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
            <Textarea
              id="search-resume"
              value={resumeHtml}
              onChange={(e) => setResumeHtml(e.target.value.slice(0, MAX_RESUME_CHARS))}
              disabled={searching}
              className="min-h-32 font-mono text-xs leading-relaxed"
              placeholder="Paste or load the HTML resume used for title detection."
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="job-title">Job title (from first experience section)</Label>
              <Input
                id="job-title"
                value={titleOverride}
                onChange={(e) => setTitleOverride(e.target.value)}
                placeholder={detectedTitle || "Detect from resume or type a title"}
                disabled={searching}
              />
            </div>
            <Button type="button" variant="outline" className="h-10 shrink-0" disabled={searching || resumeHtml.trim().length < 40} onClick={() => void detectTitle()}>
              Detect title
            </Button>
            <Button
              type="button"
              className="h-10 shrink-0"
              disabled={searching || !(titleOverride || detectedTitle).trim()}
              onClick={() => void runSearch()}
            >
              {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              {searching ? "Searching…" : "Search portals"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Queries like <code className="rounded bg-muted px-1 py-0.5 text-[11px]">"product designer" site:workable.com</code>.
            Pre-filter: ≤ 1 week when dated.
          </p>
        </CardContent>
      </Card>

      {results.length > 0 || searching ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>
              Results
              {results.length > 0 ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {filteredSorted.length} of {results.length}
                </span>
              ) : null}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Filter className="size-3.5" /> Portal
              </div>
              <select
                className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
                value={portalFilter}
                onChange={(e) => setPortalFilter(e.target.value as JobPortal | "all")}
              >
                <option value="all">All</option>
                <option value="workable">Workable</option>
                <option value="greenhouse">Greenhouse</option>
                <option value="lever">Lever</option>
                <option value="dover">Dover</option>
              </select>
              <div className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowUpDown className="size-3.5" /> Sort
              </div>
              {([["date", "Date"], ["title", "Title"], ["salary", "Salary"], ["portal", "Portal"]] as const).map(([key, label]) => (
                <Button key={key} type="button" variant={sortKey === key ? "secondary" : "ghost"} size="sm" className="h-8 text-xs" onClick={() => toggleSort(key)}>
                  {label}{sortKey === key ? (sortAsc ? " ↑" : " ↓") : ""}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {searching && results.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Searching Workable, Greenhouse, Lever, and Dover…
              </p>
            ) : filteredSorted.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No results match the current filter.</p>
            ) : (
              filteredSorted.map((job) => (
                <div key={job.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={job.applicationUrl} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:underline">{job.title}</a>
                      <Badge variant="outline" className="text-[11px]">{PORTAL_LABEL[job.portal]}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {job.company}{job.location && job.location !== "—" ? ` · ${job.location}` : ""}
                    </p>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{job.summary}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{job.postedAt ? `Posted ${job.postedAt}` : "Date unknown"}</span>
                      <span>{job.salary ? job.salary : "Salary not listed"}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
                    <Button type="button" size="sm" className="h-9" disabled={running || !isPlausibleApiKey(apiKey)} onClick={() => onSendToInputs(job)}>
                      <Send className="size-3.5" /> Send to inputs
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-9" asChild>
                      <a href={job.applicationUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-3.5" /> Open
                      </a>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
