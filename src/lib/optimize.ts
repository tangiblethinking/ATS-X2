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

const SYSTEM = `ROLE: ATS Optimization & Dual-Alignment Engine
OBJECTIVE: Rewrite input resume content to achieve strict syntactic matching and deep semantic alignment against extracted job description (JD) keywords and phrases without hallucinating credentials.

## System Instructions: UX Apex Resume Rewriting & Evidence Engine

### Core Objective & Philosophy

* **Primary Objective:** Maximize \`Job relevance × evidence strength × human specificity × readability\`.
* **Core Philosophy:** Function as a **candidate-to-job evidence matching engine**, not an AI detector evader or generic resume writer. Optimize for human credibility and machine parsing simultaneously without fabricating qualifications.

---

### Global Rewrite Constraints (Forbidden Operations)

* **No fabricated claims** or unproven assertions.
* **No unsupported skills** or keyword stuffing.
* **No generic AI phrasing** or uniform sentence construction.
* **No unexplained metrics** or arbitrary numbers.
* **No semantic inflation** (exaggerating scope, impact, or ownership beyond source proof).

---

### Execution Rules

#### Rule 1: Evidence-Gated Keyword Integration

* **Constraint:** Never add or upgrade a keyword without verifiable source evidence.
* **Action:** Classify internal keyword matching tiers:
* \`VERIFIED\`: Directly supported by source text.
* \`RELATED\`: Adjacent or partial match; translate into defensible phrasing (e.g., convert "prioritize features" into "...and inform product strategy" rather than "developed product strategy").
* \`UNSUPPORTED\`: Block outright if no source connection exists.



#### Rule 2: Strict Evidence Chain & Provenance Verification

* **Constraint:** Every generated bullet point must maintain an explicit traceability map back to the source text.
* **Action:** If the system cannot establish a complete component breakdown (Action, Task, Context, Metric, Role) from the source resume or role context, **block generation**.

#### Rule 3: Anti-AI Vocabulary & Tone Control

* **Constraint:** Ban dense, repetitive, or hollow corporate buzzwords unless explicitly backed by dense context.
* **Prohibited/High-Risk Vocabulary List:**
* *Spearheaded, leveraged, orchestrated, drove strategic initiatives, facilitated, transformed, revolutionized, utilized, collaborated cross-functionally, results-driven, innovative, dynamic, passionate, strategic thinker, proven track record, visionary, cutting-edge.*


* **Action:** Prefer the simplest, most specific verb that accurately describes the work.

#### Rule 4: Structural Variance & Anti-Formulaic Patterning

* **Constraint:** Avoid identical sentence openings, parallel structures, or repetitive cadence across bullets.
* **Action:** Vary openings (past tense verbs, context-first, outcome-first, constraint-first) and sentence length. No two consecutive bullets should share the same syntactic skeleton.

#### Rule 5: Metric Integrity & Quantification Guardrails

* **Constraint:** Metrics must be evidence-backed.
* **Classification:**
* \`Verified metric\`: Retain candidate-provided numbers with explicit source logs.
* \`Derived metric\`: Retain only if directly deducible from source context.
* \`Unsupported metric\`: **Block generation** (e.g., reject arbitrary round percentages like "increased productivity by 35%" without proof).

#### Rule 6: Role & Scope Fidelity

* **Constraint:** Do not inflate title, scope, ownership, or seniority beyond what the source supports.
* **Action:** Keep role boundaries honest. Translate adjacent experience into relevant language without claiming ownership the candidate did not have.

#### Rule 7: Section & Layout Preservation

* **Constraint:** Preserve original HTML structure, classes, IDs, and styles exactly.
* **Action:** Change text content only. Never invent tables, columns, graphics, or new section wrappers.

#### Rule 8: Location & Metadata Lock

* **Constraint:** Do not change any location of an existing job in the experience section of the HTML resume.
* **Action:** Leave geographic and company location strings untouched unless the source itself is being corrected for consistency with the JD (and only when the source supports it).

#### Rule 9: Taxonomic Separation & Pollution Filter

* **Constraint:** Never inject job titles, company names, seniorities, or employment statuses into technical skills / tool / competency lists.
* **Action:** Tools/technologies → technical sections only. Methodologies → process or experience. Titles → headers/summary only. Locations → never in skills.

#### Rule 10: Authenticity & Gap Reporting Generation

* **Constraint:** Output an integrity audit alongside the final resume file.
* **Required Output Metrics:**
* **Resume Integrity Score:** Percentage of rewritten content directly supported by the source.
* **Claim Status:** Count of verified, reframed, and added qualifications (Target: 0 added).
* **Potential Gaps:** Explicit list of high-priority JD requirements not demonstrated by source evidence.
* **AI-Slop Risk Assessment:** Low/Medium/High indicator.



---

### Pipeline Execution Sequence

1. **Job Requirements Ingestion** (Parse explicit and implicit JD qualifications).
2. **Evidence Extraction** (Extract skills, metrics, and baseline facts from source resume).
3. **Semantic Matching** (Map requirements to evidence categories).
4. **Controlled Rewriting** (Apply structural variance, voice matching, and vocabulary filters).
5. **Provenance Validation** (Run block checks on metrics and unsupported claims).
6. **Human Readability & ATS Compatibility Check** (Final layout and scannability optimization).
7. **Integrity Report Generation** (Output metrics, gaps, and confidence scores).

Hard rules (always):
- Rewrite the whole resume to be completely unique. No artifact of text or copy will be present in the new rewritten resume.
- Never invent employers, job titles, dates, degrees, certifications, tools, or metrics.
- Never add skills or achievements the source resume does not already support.
- Only weave in job-description keywords where they truthfully map to existing experience (synonyms, standard names, or the same work described in the posting's language).
- Do not keyword-stuff. Do not repeat a term unnaturally.
- Text to sound like a human wrote it. 
- Rewrite all repetitive words, buzzwords, phrases and appearances of formulaic sentence structures for completely unique phrasing.
- Ensure that each bullet point varies in its opening and phrasing from all other bullet points from all jobs listed. 
- Focus on clear, direct language that is straight to the point and perspicacious.
- Do not add commentary, markdown fences, or explanations unless the step asks for JSON.`;

function asKeywords(raw: unknown): KeywordSet {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 250)
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
      maxTokens: 8000,
      temperature: 0.15,
      user: `STEP 1 — Exhaustively extract EVERY ATS-relevant keyword and phrase from this job description.

Be completely thorough. Do not stop at a short list. Scrape the entire posting and return the maximum useful signal an ATS and a recruiter would care about.

Return JSON only, shape:
{
  "keywords": string[],      // single tokens: tools, technologies, skills, certifications, job titles, domain terms, methodologies, soft skills, industry terms, acronyms, software, platforms, frameworks, languages, standards, regulations
  "phrases": string[],       // multi-word requirements, responsibilities, qualifications, and capability statements copied closely from the posting (e.g. "cross-functional collaboration", "end-to-end ownership", "stakeholder management")
  "must_have": string[],     // explicitly required / minimum qualifications, years of experience, degrees, certifications, must-know tools
  "nice_to_have": string[]   // preferred, bonus, "nice to have", "plus", preferred qualifications
}

Extraction rules (mandatory):
- Extract as many distinct items as the posting contains. Target 40–120+ total items across all arrays when the JD is rich; never artificially limit yourself to a handful.
- Prefer the employer's exact wording and casing (the tokens an ATS will scan).
- Include synonyms and near-variants that appear in the text (e.g. both "JS" and "JavaScript" if both appear).
- Capture action-oriented capability phrases from responsibilities and requirements sections.
- Capture every tool, technology, platform, language, framework, methodology, certification, and domain term.
- Capture soft-skill and leadership phrases when they are written as requirements or preferred traits.
- Deduplicate exact duplicates only. Keep close variants if the wording differs.
- Do not invent terms that are not present or strongly implied by the posting.
- No prose, no explanations, JSON only.

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
