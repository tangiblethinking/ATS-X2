import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { finalizeCleanHtml, stripMarkdownFences } from "@/lib/html-clean";
import type { AuditResult, KeywordSet } from "@/lib/pipeline-types";
import { MAX_JOB_CHARS, MAX_RESUME_CHARS } from "@/lib/pipeline-types";

const apiKeySchema = z
  .string()
  .trim()
  .min(20, "Enter a valid API key.")
  .refine((v) => !/\s/.test(v), "The API key cannot contain spaces.");

const resumeSchema = z
  .string()
  .trim()
  .min(40, "Paste the HTML of your resume.")
  .max(MAX_RESUME_CHARS, "The resume HTML is too large.");

const SYSTEM = `You are an ATS resume optimization engine. Follow the current step exactly.

Hard rules:
- Never invent employers, job titles, dates, degrees, certifications, tools, or metrics.
- Never add skills or achievements the source resume does not already support.
- Only weave in job-description keywords where they truthfully map to existing experience (synonyms, standard names, or the same work described in the posting's language).
- Do not keyword-stuff. Do not repeat a term unnaturally.
- Do not add commentary, markdown fences, or explanations unless the step asks for JSON.`;

function asKeywords(raw: unknown): KeywordSet {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 80)
      : [];
  return {
    keywords: list(obj.keywords),
    phrases: list(obj.phrases),
    must_have: list(obj.must_have),
    nice_to_have: list(obj.nice_to_have),
  };
}

function asAudit(raw: unknown, fallbackHtml: string): { html: string; audit: AuditResult } {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const html =
    typeof obj.html === "string" && obj.html.trim()
      ? stripMarkdownFences(obj.html)
      : fallbackHtml;
  const flags = Array.isArray(obj.flags)
    ? obj.flags
        .map((f) => {
          if (!f || typeof f !== "object") return null;
          const rec = f as Record<string, unknown>;
          const issue = typeof rec.issue === "string" ? rec.issue.trim() : "";
          const fix = typeof rec.fix === "string" ? rec.fix.trim() : "";
          if (!issue) return null;
          return { issue, fix };
        })
        .filter((x): x is { issue: string; fix: string } => x !== null)
        .slice(0, 40)
    : [];
  const counts: Record<string, number> = {};
  if (obj.keyword_counts && typeof obj.keyword_counts === "object") {
    for (const [k, v] of Object.entries(obj.keyword_counts as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) counts[k] = v;
    }
  }
  return { html, audit: { flags, keyword_counts: counts } };
}

async function chat(opts: {
  apiKey: string;
  user: string;
  maxTokens: number;
  temperature: number;
  json?: boolean;
}) {
  const { geminiChat } = await import("./gemini.server");
  return geminiChat({
    apiKey: opts.apiKey,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: opts.user },
    ],
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    json: opts.json,
  });
}

export const verifyApiKey = createServerFn({ method: "POST" })
  .validator(z.object({ apiKey: apiKeySchema }))
  .handler(async ({ data }) => {
    const { verifyGeminiKey } = await import("./gemini.server");
    return verifyGeminiKey(data.apiKey);
  });

export const fetchJobDescription = createServerFn({ method: "POST" })
  .validator(
    z.object({
      url: z.string().trim().min(8).max(2000),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const { fetchJobText } = await import("./job-fetch.server");
      const result = await fetchJobText(data.url);
      return { ok: true as const, ...result };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Could not fetch that URL.",
      };
    }
  });

export const extractKeywords = createServerFn({ method: "POST" })
  .validator(
    z.object({
      apiKey: apiKeySchema,
      jobText: z.string().trim().min(40).max(MAX_JOB_CHARS),
    }),
  )
  .handler(async ({ data }) => {
    const result = await chat({
      apiKey: data.apiKey,
      json: true,
      maxTokens: 2500,
      temperature: 0.2,
      user: `STEP 1 — Extract ATS keywords and phrases from this job description.

Return JSON only, shape:
{
  "keywords": string[],   // single tokens: tools, skills, certs, titles, domain terms
  "phrases": string[],    // multi-word requirements copied closely from the posting
  "must_have": string[],  // required qualifications
  "nice_to_have": string[]
}

Deduplicate. Prefer the employer's exact wording (the tokens an ATS will scan).
No prose.

JOB DESCRIPTION:
${data.jobText}`,
    });
    if (!result.ok) return result;
    try {
      const { parseJsonObject } = await import("./gemini.server");
      const keywords = asKeywords(parseJsonObject(result.text));
      if (keywords.keywords.length + keywords.phrases.length === 0) {
        return { ok: false as const, error: "No keywords were extracted. Try a fuller job description." };
      }
      return { ok: true as const, keywords };
    } catch {
      return { ok: false as const, error: "Keyword extraction did not return valid JSON." };
    }
  });

export const rewriteResume = createServerFn({ method: "POST" })
  .validator(
    z.object({
      apiKey: apiKeySchema,
      resumeHtml: resumeSchema,
      keywords: z.object({
        keywords: z.array(z.string()),
        phrases: z.array(z.string()),
        must_have: z.array(z.string()),
        nice_to_have: z.array(z.string()),
      }),
    }),
  )
  .handler(async ({ data }) => {
    const kw = [
      ...data.keywords.must_have,
      ...data.keywords.phrases,
      ...data.keywords.keywords,
      ...data.keywords.nice_to_have,
    ]
      .filter(Boolean)
      .join(", ");
    const result = await chat({
      apiKey: data.apiKey,
      maxTokens: 8192,
      temperature: 0.35,
      user: `STEP 2 — Rewrite the WHOLE resume so it uses the ATS keywords and phrases where they truthfully apply.

Layout lock (mandatory):
- Keep every tag, attribute, class, id, inline style, <style> block, table, and document structure from the original HTML.
- Change TEXT CONTENT only. Do not restyle. Do not add or remove sections, columns, or wrappers.
- Return ONLY HTML. No markdown, no commentary.

Writing:
- Integrate the keywords naturally into existing bullets and summaries.
- Prefer the employer's exact tokens when the candidate already did that work.
- Do not fabricate.

ATS KEYWORDS AND PHRASES:
${kw}

ORIGINAL RESUME HTML:
${data.resumeHtml}`,
    });
    if (!result.ok) return result;
    const html = stripMarkdownFences(result.text);
    if (html.length < 40) {
      return { ok: false as const, error: "The rewrite returned almost no HTML." };
    }
    return { ok: true as const, html };
  });

export const grammarCheck = createServerFn({ method: "POST" })
  .validator(
    z.object({
      apiKey: apiKeySchema,
      resumeHtml: resumeSchema,
    }),
  )
  .handler(async ({ data }) => {
    const result = await chat({
      apiKey: data.apiKey,
      maxTokens: 8192,
      temperature: 0.2,
      user: `STEP 3 — Grammar check for proper spelling and real language use.

Fix:
- Spelling, grammar, punctuation, subject-verb agreement
- Awkward or robotic phrasing
- Buzzword salad; rewrite into language a hiring manager would actually say

Do not:
- Change facts, dates, names, or numbers
- Add new claims
- Alter HTML tags, attributes, classes, ids, or styles

Return ONLY the full HTML. No markdown.

RESUME HTML:
${data.resumeHtml}`,
    });
    if (!result.ok) return result;
    const html = stripMarkdownFences(result.text);
    if (html.length < 40) {
      return { ok: false as const, error: "The grammar pass returned almost no HTML." };
    }
    return { ok: true as const, html };
  });

export const auditKeywords = createServerFn({ method: "POST" })
  .validator(
    z.object({
      apiKey: apiKeySchema,
      resumeHtml: resumeSchema,
      keywords: z.object({
        keywords: z.array(z.string()),
        phrases: z.array(z.string()),
        must_have: z.array(z.string()),
        nice_to_have: z.array(z.string()),
      }),
    }),
  )
  .handler(async ({ data }) => {
    const kw = [
      ...data.keywords.must_have,
      ...data.keywords.phrases,
      ...data.keywords.keywords,
    ]
      .filter(Boolean)
      .join(", ");
    const result = await chat({
      apiKey: data.apiKey,
      json: true,
      maxTokens: 8192,
      temperature: 0.2,
      user: `STEP 4 — Audit for overuse or redundant application of ATS keywords and phrases.

Find:
- The same keyword repeated in consecutive bullets
- Unnatural stuffing
- Keywords that do not match the candidate's actual experience (remove those)
- Density that would look spammy to a human reader

Fix the HTML: keep the strongest natural occurrence of each term, drop redundant ones.
Keep tags, attributes, classes, ids, and styles identical except for text changes.

Return JSON only:
{
  "html": "full resume HTML after fixes",
  "flags": [{ "issue": string, "fix": string }],
  "keyword_counts": { "term": number }
}

ATS KEYWORDS AND PHRASES:
${kw}

RESUME HTML:
${data.resumeHtml}`,
    });
    if (!result.ok) return result;
    try {
      const { parseJsonObject } = await import("./gemini.server");
      const parsed = asAudit(parseJsonObject(result.text), data.resumeHtml);
      if (parsed.html.length < 40) {
        return { ok: false as const, error: "The audit returned almost no HTML." };
      }
      return { ok: true as const, html: parsed.html, audit: parsed.audit };
    } catch {
      const html = stripMarkdownFences(result.text);
      if (html.length > 40 && /<\/?[a-z]/i.test(html)) {
        return {
          ok: true as const,
          html,
          audit: { flags: [], keyword_counts: {} },
        };
      }
      return { ok: false as const, error: "The audit did not return valid JSON." };
    }
  });

export const lockLayout = createServerFn({ method: "POST" })
  .validator(
    z.object({
      apiKey: apiKeySchema,
      originalHtml: resumeSchema,
      currentHtml: resumeSchema,
    }),
  )
  .handler(async ({ data }) => {
    const result = await chat({
      apiKey: data.apiKey,
      maxTokens: 8192,
      temperature: 0.1,
      user: `STEP 5 — Follow the exact layout and styling of the original HTML so every resume output is consistent.

Take the ORIGINAL HTML as the structural source of truth.
Take the CURRENT HTML as the source of rewritten text.

Produce HTML that:
- Uses the original's exact tags, nesting, classes, ids, inline styles, <style> blocks, fonts, spacing, tables, and wrappers
- Replaces only text nodes with the improved wording from CURRENT
- Does not introduce new CSS, new sections, or a different template
- If CURRENT dropped a region that ORIGINAL had, restore the original region (with original text if no rewrite exists)

Return ONLY the full HTML. No markdown.

ORIGINAL HTML (layout source of truth):
${data.originalHtml}

CURRENT HTML (wording to keep):
${data.currentHtml}`,
    });
    if (!result.ok) return result;
    const html = stripMarkdownFences(result.text);
    if (html.length < 40) {
      return { ok: false as const, error: "The layout pass returned almost no HTML." };
    }
    return { ok: true as const, html };
  });

export const cleanHtml = createServerFn({ method: "POST" })
  .validator(
    z.object({
      originalHtml: resumeSchema,
      currentHtml: z.string().trim().min(1).max(MAX_RESUME_CHARS * 2),
    }),
  )
  .handler(async ({ data }) => {
    const html = finalizeCleanHtml(data.originalHtml, data.currentHtml);
    return { ok: true as const, html };
  });
