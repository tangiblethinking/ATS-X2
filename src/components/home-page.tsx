import { useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, Play, RotateCcw, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import { JobSearchPanel } from "@/components/job-search-panel";
import { OutputPanel } from "@/components/output-panel";
import { PipelineRail } from "@/components/pipeline-rail";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  isPlausibleApiKey,
  readStoredApiKey,
  readStoredSearchApiKey,
} from "@/lib/api-key-store";
import { looksLikeHtml } from "@/lib/html-clean";
import {
  auditKeywords,
  cleanHtml,
  extractKeywords,
  fetchJobDescription,
  grammarCheck,
  lockLayout,
  rewriteResume,
} from "@/lib/optimize";
import type { JobResult } from "@/lib/job-search";
import {
  DRAFT_STORAGE,
  MAX_JOB_CHARS,
  MAX_RESUME_CHARS,
  type AuditResult,
  type KeywordSet,
  type StepId,
  type StepStatus,
} from "@/lib/pipeline-types";

const idleStatuses = (): Record<StepId, StepStatus> => ({
  1: "idle",
  2: "idle",
  3: "idle",
  4: "idle",
  5: "idle",
  6: "idle",
});

type Draft = { jobUrl: string; jobText: string; resumeHtml: string };
type Theme = "dark" | "light";

function readDraft(): Draft {
  if (typeof window === "undefined") return { jobUrl: "", jobText: "", resumeHtml: "" };
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE);
    if (!raw) return { jobUrl: "", jobText: "", resumeHtml: "" };
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      jobUrl: typeof parsed.jobUrl === "string" ? parsed.jobUrl : "",
      jobText: typeof parsed.jobText === "string" ? parsed.jobText : "",
      resumeHtml: typeof parsed.resumeHtml === "string" ? parsed.resumeHtml : "",
    };
  } catch {
    return { jobUrl: "", jobText: "", resumeHtml: "" };
  }
}

function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const t = window.localStorage.getItem("ats-align.theme");
    return t === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light", theme === "light");
  try {
    window.localStorage.setItem("ats-align.theme", theme);
  } catch {
    /* ignore */
  }
}

export function HomePage() {
  const [apiKey, setApiKey] = useState("");
  const [searchApiKey, setSearchApiKey] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [jobText, setJobText] = useState("");
  const [resumeHtml, setResumeHtml] = useState("");
  const [statuses, setStatuses] = useState<Record<StepId, StepStatus>>(idleStatuses);
  const [details, setDetails] = useState<Partial<Record<StepId, string>>>({});
  const [keywords, setKeywords] = useState<KeywordSet | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [finalHtml, setFinalHtml] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<"pipeline" | "search">("pipeline");
  const [theme, setTheme] = useState<Theme>("dark");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setApiKey(readStoredApiKey());
    setSearchApiKey(readStoredSearchApiKey());
    const draft = readDraft();
    setJobUrl(draft.jobUrl);
    setJobText(draft.jobText);
    setResumeHtml(draft.resumeHtml);
    const t = readTheme();
    setTheme(t);
    applyTheme(t);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        DRAFT_STORAGE,
        JSON.stringify({ jobUrl, jobText, resumeHtml } satisfies Draft),
      );
    } catch {
      // quota
    }
  }, [hydrated, jobUrl, jobText, resumeHtml]);

  const canRun = useMemo(() => {
    return (
      isPlausibleApiKey(apiKey) &&
      jobUrl.trim().length > 7 &&
      resumeHtml.trim().length > 40 &&
      !running
    );
  }, [apiKey, jobUrl, resumeHtml, running]);

  function mark(id: StepId, status: StepStatus, detail?: string) {
    setStatuses((prev) => ({ ...prev, [id]: status }));
    if (detail) setDetails((prev) => ({ ...prev, [id]: detail }));
  }

  function fail(id: StepId, message: string) {
    mark(id, "error", message);
    toast.error(message);
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    if (text.length > MAX_RESUME_CHARS) {
      toast.error("That HTML file is too large.");
      return;
    }
    setResumeHtml(text);
  }

  function resetPipeline() {
    setStatuses(idleStatuses());
    setDetails({});
    setKeywords(null);
    setAudit(null);
    setFinalHtml(null);
  }

  async function runPipeline(opts?: { url?: string; skipResetUrl?: boolean }) {
    const urlToUse = (opts?.url ?? jobUrl).trim();
    if (!isPlausibleApiKey(apiKey)) {
      toast.error("Save a Gemini API key first.");
      return;
    }
    if (!looksLikeHtml(resumeHtml)) {
      toast.error("The resume must be HTML, not plain text.");
      return;
    }
    if (urlToUse.length < 8) {
      toast.error("Enter a valid job description URL.");
      return;
    }
    if (opts?.skipResetUrl) setJobUrl(urlToUse);

    setRunning(true);
    resetPipeline();
    const original = resumeHtml.trim();
    let currentJob = jobText.trim();
    let currentHtml = original;
    let currentKeywords: KeywordSet | null = null;

    try {
      mark(1, "running", "Fetching the job posting…");
      const fetched = await fetchJobDescription({ data: { url: urlToUse } });
      if (fetched.ok) {
        currentJob = fetched.text.slice(0, MAX_JOB_CHARS);
        setJobText(currentJob);
        mark(1, "running", "Extracting ATS keywords…");
      } else if (currentJob.length >= 40) {
        mark(1, "running", `${fetched.error} Using pasted description.`);
      } else {
        fail(1, fetched.error);
        return;
      }

      const extracted = await extractKeywords({ data: { apiKey, jobText: currentJob } });
      if (!extracted.ok) {
        fail(1, extracted.error);
        return;
      }
      currentKeywords = extracted.keywords;
      setKeywords(currentKeywords);
      const kwCount = currentKeywords.keywords.length + currentKeywords.phrases.length;
      mark(1, "done", `${kwCount} keywords and phrases`);

      mark(2, "running");
      const rewritten = await rewriteResume({
        data: { apiKey, resumeHtml: original, keywords: currentKeywords },
      });
      if (!rewritten.ok) {
        fail(2, rewritten.error);
        return;
      }
      currentHtml = rewritten.html;
      mark(2, "done", "Full resume rewritten");

      mark(3, "running");
      const grammar = await grammarCheck({ data: { apiKey, resumeHtml: currentHtml } });
      if (!grammar.ok) {
        fail(3, grammar.error);
        return;
      }
      currentHtml = grammar.html;
      mark(3, "done", "Spelling and language checked");

      mark(4, "running");
      const audited = await auditKeywords({
        data: { apiKey, resumeHtml: currentHtml, keywords: currentKeywords },
      });
      if (!audited.ok) {
        fail(4, audited.error);
        return;
      }
      currentHtml = audited.html;
      setAudit(audited.audit);
      mark(4, "done", audited.audit.flags.length ? `${audited.audit.flags.length} issues fixed` : "No stuffing found");

      mark(5, "running");
      const laidOut = await lockLayout({
        data: { apiKey, originalHtml: original, currentHtml },
      });
      if (!laidOut.ok) {
        fail(5, laidOut.error);
        return;
      }
      currentHtml = laidOut.html;
      mark(5, "done", "Original layout restored");

      mark(6, "running");
      const cleaned = await cleanHtml({ data: { originalHtml: original, currentHtml } });
      setFinalHtml(cleaned.html);
      mark(6, "done", "Full clean HTML ready");
      toast.success("Pipeline finished.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The pipeline failed.");
    } finally {
      setRunning(false);
    }
  }

  function sendToInputs(job: JobResult) {
    resetPipeline();
    setJobText("");
    setJobUrl(job.applicationUrl);
    setMode("pipeline");
    toast.success(`Sent to Pipeline: ${job.title}`, {
      description: "Starting the alignment pipeline…",
    });
    void (async () => {
      await new Promise((r) => setTimeout(r, 80));
      await runPipeline({ url: job.applicationUrl, skipResetUrl: true });
    })();
  }

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-dvh bg-background text-foreground">
        <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex min-w-0 items-baseline gap-3">
                <p className="font-display text-xl font-medium tracking-tight">ATS Align</p>
                <p className="hidden truncate text-sm text-muted-foreground sm:block">
                  Resume to job · search & align
                </p>
              </div>
              <Tabs value={mode} onValueChange={(v) => setMode(v as "pipeline" | "search")} className="hidden sm:block">
                <TabsList className="h-9">
                  <TabsTrigger value="pipeline" className="px-3 text-xs sm:text-sm">Pipeline</TabsTrigger>
                  <TabsTrigger value="search" className="px-3 text-xs sm:text-sm">Job Search</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                onClick={toggleTheme}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
              <ApiKeyDialog
                apiKey={apiKey}
                onChange={setApiKey}
                searchApiKey={searchApiKey}
                onSearchChange={setSearchApiKey}
              />
            </div>
          </div>
          <div className="border-t border-border px-4 py-2 sm:hidden">
            <Tabs value={mode} onValueChange={(v) => setMode(v as "pipeline" | "search")}>
              <TabsList className="h-9 w-full">
                <TabsTrigger value="pipeline" className="flex-1 text-xs">Pipeline</TabsTrigger>
                <TabsTrigger value="search" className="flex-1 text-xs">Job Search</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </header>

        <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
          {mode === "pipeline" ? (
            <>
              <section className="stagger-in max-w-2xl">
                <h1 className="font-display text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
                  Align the resume you already have to the job you want.
                </h1>
                <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
                  Paste a job URL and the HTML of your resume. The pipeline extracts ATS keywords,
                  rewrites the whole document, checks grammar, audits stuffing, locks your original
                  layout, and returns clean HTML.
                </p>
              </section>

              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>Inputs</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-5">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="job-url">Job description URL</Label>
                      <Input id="job-url" type="url" inputMode="url" placeholder="https://…" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} disabled={running} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="job-text">
                        Job description text
                        <span className="ml-2 font-normal text-muted-foreground">used if the URL is blocked</span>
                      </Label>
                      <Textarea id="job-text" value={jobText} onChange={(e) => setJobText(e.target.value.slice(0, MAX_JOB_CHARS))} disabled={running} className="min-h-28" placeholder="Optional. Paste the posting if the page cannot be fetched." />
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="resume-html">Resume HTML</Label>
                        <Button type="button" variant="ghost" size="sm" className="h-9" disabled={running} onClick={() => fileRef.current?.click()}>
                          <FileCode2 className="size-3.5" /> Load .html
                        </Button>
                        <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ""; }} />
                      </div>
                      <Textarea id="resume-html" value={resumeHtml} onChange={(e) => setResumeHtml(e.target.value.slice(0, MAX_RESUME_CHARS))} disabled={running} className="min-h-48 font-mono text-xs leading-relaxed" placeholder="Paste the full HTML of your resume, including style tags." />
                      <p className="text-xs text-muted-foreground">
                        {resumeHtml.length.toLocaleString()} / {MAX_RESUME_CHARS.toLocaleString()} characters
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button type="button" className="h-12 flex-1" disabled={!canRun} onClick={() => void runPipeline()}>
                        <Play className="size-4" /> {running ? "Running…" : "Run pipeline"}
                      </Button>
                      <Button type="button" variant="outline" className="h-12" disabled={running} onClick={resetPipeline}>
                        <RotateCcw className="size-4" /> Clear output
                      </Button>
                    </div>
                    {!apiKey ? (
                      <p className="text-xs text-muted-foreground">
                        A Gemini API key is required. Save one under API keys in the header.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="flex flex-col gap-6 p-4">
                    <PipelineRail statuses={statuses} details={details} running={running} />
                    <div className="h-px bg-border" />
                    <div>
                      <p className="mb-3 font-display text-lg font-medium leading-snug tracking-tight">Output</p>
                      <OutputPanel html={finalHtml} keywords={keywords} audit={audit} />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <JobSearchPanel
              resumeHtml={resumeHtml}
              setResumeHtml={setResumeHtml}
              apiKey={apiKey}
              searchApiKey={searchApiKey}
              running={running}
              onSendToInputs={sendToInputs}
              onPickFile={onPickFile}
            />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
