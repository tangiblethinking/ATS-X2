import { useState } from "react";
import { Check, Copy, Download, FileDown, Loader2 } from "lucide-react";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Html2PdfFn = (element?: HTMLElement | string) => any;

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

/** Load html2pdf.bundle.min.js once from CDN (no npm dependency). */
let html2pdfLoader: Promise<Html2PdfFn> | null = null;

function loadHtml2Pdf(): Promise<Html2PdfFn> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("PDF export requires a browser."));
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (window as any).html2pdf as Html2PdfFn | undefined;
  if (typeof existing === "function") {
    return Promise.resolve(existing);
  }
  if (!html2pdfLoader) {
    html2pdfLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
      script.async = true;
      script.onload = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lib = (window as any).html2pdf as Html2PdfFn | undefined;
        if (typeof lib === "function") {
          resolve(lib);
        } else {
          reject(new Error("html2pdf failed to load."));
        }
      };
      script.onerror = () => reject(new Error("Could not load PDF library."));
      document.head.appendChild(script);
    });
  }
  return html2pdfLoader;
}

/**
 * Rewrite html/body selectors so resume CSS still applies when the markup
 * lives under #ats-pdf-export-host instead of a real document root.
 */
function scopeResumeCss(css: string): string {
  return css
    .replace(/(^|[,\s}])html(?=[\s,{.#:\[])/gi, "$1#ats-pdf-export-host")
    .replace(/(^|[,\s}])body(?=[\s,{.#:\[])/gi, "$1#ats-pdf-export-host");
}

function parseResumeDocument(html: string): {
  styles: string;
  bodyHtml: string;
  bodyClass: string;
  bodyStyle: string;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const styleParts: string[] = [];
  doc.querySelectorAll("style").forEach((el) => {
    styleParts.push(el.textContent ?? "");
  });

  const body = doc.body;
  return {
    styles: scopeResumeCss(styleParts.join("\n")),
    bodyHtml: body ? body.innerHTML : html,
    bodyClass: body?.getAttribute("class") ?? "",
    bodyStyle: body?.getAttribute("style") ?? "",
  };
}

/** High-fidelity fallback: open the resume and trigger the browser print dialog (Save as PDF). */
function printResumeAsPdf(html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error("Pop-up blocked. Allow pop-ups to print the resume as PDF.");
  }
  const trigger = () => {
    try {
      win.focus();
      win.print();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };
  // Some browsers fire load before styles settle
  if (win.document.readyState === "complete") {
    window.setTimeout(trigger, 250);
  } else {
    win.addEventListener("load", () => window.setTimeout(trigger, 250));
  }
  toast.message("Use the print dialog → Save as PDF for a full-layout copy.");
}

/**
 * Mount the resume (styles + markup) into the main document so html2canvas
 * can clone it with CSS intact, then export to a letter PDF.
 */
async function downloadPdf(html: string) {
  const html2pdf = await loadHtml2Pdf();
  const { styles, bodyHtml, bodyClass, bodyStyle } = parseResumeDocument(html);

  const host = document.createElement("div");
  host.id = "ats-pdf-export-host";
  host.setAttribute("aria-hidden", "true");
  if (bodyClass) host.className = bodyClass;
  host.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:816px",
    "max-width:816px",
    "min-height:1056px",
    "margin:0",
    "padding:0",
    "background:#ffffff",
    "color:#000000",
    "z-index:2147483646",
    // Nearly invisible but still "rendered" so layout engines run
    "opacity:0.01",
    "pointer-events:none",
    "overflow:visible",
    bodyStyle,
  ]
    .filter(Boolean)
    .join(";");

  const styleEl = document.createElement("style");
  styleEl.textContent = `
    #ats-pdf-export-host, #ats-pdf-export-host * {
      box-sizing: border-box;
    }
    ${styles}
  `;

  const content = document.createElement("div");
  content.id = "ats-pdf-export-content";
  content.style.cssText = "width:100%;margin:0;padding:0;";
  content.innerHTML = bodyHtml;

  host.appendChild(styleEl);
  host.appendChild(content);
  document.body.appendChild(host);

  try {
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    await new Promise<void>((r) => window.setTimeout(r, 400));

    const measuredHeight = Math.max(
      content.scrollHeight,
      content.offsetHeight,
      host.scrollHeight,
      1056,
    );
    host.style.height = `${measuredHeight}px`;

    // Sanity: if almost no content rendered, fall back to print
    if (content.scrollHeight < 40 && content.textContent?.trim().length === 0) {
      throw new Error("Resume content did not render for capture.");
    }

    const opt = {
      margin: [0.25, 0.25, 0.25, 0.25] as [number, number, number, number],
      filename: "resume-ats.pdf",
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: "#ffffff",
        width: 816,
        windowWidth: 816,
        height: measuredHeight,
        windowHeight: measuredHeight,
        scrollX: 0,
        scrollY: -window.scrollY,
        x: 0,
        y: 0,
        onclone: (clonedDoc: Document) => {
          const clonedHost = clonedDoc.getElementById("ats-pdf-export-host");
          if (clonedHost) {
            clonedHost.style.opacity = "1";
            clonedHost.style.position = "static";
            clonedHost.style.left = "auto";
            clonedHost.style.top = "auto";
            clonedHost.style.zIndex = "auto";
          }
        },
      },
      jsPDF: {
        unit: "in" as const,
        format: "letter" as const,
        orientation: "portrait" as const,
      },
      pagebreak: { mode: ["css", "legacy"] as const },
    };

    // Capture the host (styles + content), not only the inner content div
    await html2pdf().set(opt).from(host).save();
    toast.success("PDF downloaded.");
  } catch (primaryErr) {
    // Fall back to browser print → Save as PDF (best layout fidelity)
    console.warn("html2pdf capture failed, falling back to print", primaryErr);
    printResumeAsPdf(html);
  } finally {
    host.remove();
  }
}

export function OutputPanel({ html, keywords, audit }: Props) {
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

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
              variant="paper"
              size="sm"
              disabled={pdfBusy}
              onClick={async () => {
                setPdfBusy(true);
                try {
                  await downloadPdf(html);
                } catch (err) {
                  const message =
                    err instanceof Error ? err.message : "Could not create PDF.";
                  toast.error(message);
                } finally {
                  setPdfBusy(false);
                }
              }}
            >
              {pdfBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FileDown className="size-3.5" />
              )}
              {pdfBusy ? "PDF…" : "PDF"}
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
