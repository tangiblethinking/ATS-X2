import { useState } from "react";
import { Check, Copy, Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { AuditResult, KeywordSet } from "@/lib/pipeline-types";

type Props = {
  html: string | null;
  keywords: KeywordSet | null;
  audit: AuditResult | null;
};

async function copyText(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  } catch {
    toast.error("Could not copy. Select the text instead.");
  }
}

function downloadHtml(html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "resume-ats.html";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Ensure the document has basic print-friendly defaults without overriding
 * the resume's own styles. Injected only if no @media print block exists.
 */
function withPrintHints(html: string): string {
  const printCss = `
@media print {
  html, body {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  @page {
    size: letter;
    margin: 0.4in;
  }
}
`;

  // Insert before </head> when present; otherwise prepend a head
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `<style data-ats-print>${printCss}</style></head>`);
  }
  if (/<html\b/i.test(html)) {
    return html.replace(
      /<html\b[^>]*>/i,
      (m) => `${m}<head><meta charset="utf-8"><style data-ats-print>${printCss}</style></head>`,
    );
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style data-ats-print>${printCss}</style></head><body>${html}</body></html>`;
}

/**
 * Open the full resume HTML in a new browser tab and trigger the print dialog
 * so the user can choose "Save as PDF". This preserves the original layout
 * and styles exactly — no canvas/html2pdf rasterization.
 */
function openResumeForPrint(html: string) {
  const docHtml = withPrintHints(html);

  // Must not use noopener — we need a handle to call print()
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Pop-up blocked. Allow pop-ups for this site, then try again.");
    return;
  }

  win.document.open();
  win.document.write(docHtml);
  win.document.close();
  win.document.title = "resume-ats";

  const runPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      toast.message("Resume opened in a new tab — use Print → Save as PDF.");
    }
  };

  // Wait for layout/fonts; also handle already-complete documents
  if (win.document.readyState === "complete") {
    window.setTimeout(runPrint, 400);
  } else {
    win.addEventListener("load", () => window.setTimeout(runPrint, 400));
    // Safety if load never fires
    window.setTimeout(runPrint, 1500);
  }

  toast.success('Print dialog opened — choose "Save as PDF".');
}

/** Open the resume HTML in a new tab without auto-printing (user can print later). */
function openResumeInTab(html: string) {
  const docHtml = withPrintHints(html);
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Pop-up blocked. Allow pop-ups for this site, then try again.");
    return;
  }
  win.document.open();
  win.document.write(docHtml);
  win.document.close();
  win.document.title = "resume-ats";
  win.focus();
  toast.success("Resume opened in a new tab.");
}

export function OutputPanel({ html, keywords, audit }: Props) {
  const [copied, setCopied] = useState(false);

  if (!html && !keywords) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl bg-secondary/60 px-6 py-10 text-center">
        <p className="font-display text-lg text-foreground">No output yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Save an API key, add a job URL and your resume HTML, then run the
          six-step pipeline.
        </p>
      </div>
    );
  }

  return (
    <Tabs defaultValue={html ? "preview" : "keywords"} className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="html">HTML</TabsTrigger>
          <TabsTrigger value="keywords">Keywords</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        {html ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                await copyText("HTML", html);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              Copy HTML
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => downloadHtml(html)}>
              <Download className="size-3.5" />
              HTML
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openResumeInTab(html)}
            >
              Open
            </Button>
            <Button
              type="button"
              variant="paper"
              size="sm"
              onClick={() => openResumeForPrint(html)}
            >
              <Printer className="size-3.5" />
              PDF / Print
            </Button>
          </div>
        ) : null}
      </div>

      <TabsContent value="preview">
        {html ? (
          <div className="overflow-hidden rounded-xl bg-paper shadow-[var(--shadow-border)]">
            <iframe
              title="Resume preview"
              sandbox=""
              srcDoc={html}
              className="h-[min(72vh,880px)] w-full bg-paper"
            />
          </div>
        ) : (
          <EmptyNote text="Preview appears after the pipeline finishes." />
        )}
      </TabsContent>

      <TabsContent value="html">
        {html ? (
          <ScrollArea className="h-[min(72vh,880px)] rounded-xl bg-secondary">
            <pre className="whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed text-foreground">
              {html}
            </pre>
          </ScrollArea>
        ) : (
          <EmptyNote text="Clean HTML appears in step 6." />
        )}
      </TabsContent>

      <TabsContent value="keywords">
        {keywords ? (
          <div className="flex flex-col gap-5">
            <KeywordGroup title="Must have" items={keywords.must_have} />
            <KeywordGroup title="Phrases" items={keywords.phrases} />
            <KeywordGroup title="Keywords" items={keywords.keywords} />
            <KeywordGroup title="Nice to have" items={keywords.nice_to_have} />
          </div>
        ) : (
          <EmptyNote text="Keywords appear after step 1." />
        )}
      </TabsContent>

      <TabsContent value="audit">
        {audit ? (
          <div className="flex flex-col gap-5">
            {audit.flags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No stuffing or redundant keyword use was flagged.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {audit.flags.map((flag, i) => (
                  <li
                    key={`${flag.issue}-${i}`}
                    className="rounded-xl bg-secondary p-4"
                  >
                    <p className="text-sm font-medium">{flag.issue}</p>
                    {flag.fix ? (
                      <p className="mt-1 text-sm text-muted-foreground">{flag.fix}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {Object.keys(audit.keyword_counts).length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium">Keyword counts</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(audit.keyword_counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([term, n]) => (
                      <Badge key={term} variant="outline" className="font-mono">
                        {term} · {n}
                      </Badge>
                    ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyNote text="Audit notes appear after step 4." />
        )}
      </TabsContent>
    </Tabs>
  );
}

function KeywordGroup({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Badge key={item} variant="stone">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
