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

* **Primary Objective:** Maximize `Job relevance × evidence strength × human specificity × readability`.
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
* `VERIFIED`: Directly supported by source text.
* `RELATED`: Adjacent or partial match; translate into defensible phrasing (e.g., convert "prioritize features" into "...and inform product strategy" rather than "developed product strategy").
* `UNSUPPORTED`: Block outright if no source connection exists.



#### Rule 2: Strict Evidence Chain & Provenance Verification

* **Constraint:** Every generated bullet point must maintain an explicit traceability map back to the source text.
* **Action:** If the system cannot establish a complete component breakdown (Action, Task, Context, Metric, Role) from the source resume or role context, **block generation**.

#### Rule 3: Anti-AI Vocabulary & Tone Control

* **Constraint:** Ban dense, repetitive, or hollow corporate buzzwords unless explicitly backed by dense context.
* **Prohibited/High-Risk Vocabulary List:**
* *Spearheaded, leveraged, orchestrated, drove strategic initiatives, facilitated, transformed, revolutionized, utilized, collaborated cross-functionally, results-driven, innovative, dynamic, passionate, strategic thinker, proven track record, visionary, cutting-edge.*


* **Action:** Prefer the simplest, most specific verb that accurately describes the action (e.g., use *Led*, *Redesigned*, *Built*, or *Established*).

#### Rule 4: Structural Variance Enforcement

* **Constraint:** Prevent repetitive AI patterning (Action + Adjective + Task + Methodology + Outcome).
* **Action:** Dynamically vary sentence length, grammatical structure, verb selection, context volume, and placement of metrics/methodologies based strictly on the underlying evidence.

#### Rule 5: Metric Provenance Validation

* **Constraint:** Numerical achievements must be categorized and filtered.
* **Action:**
* `Verified metric`: Retain candidate-provided numbers with explicit source logs.
* `Derived metric`: Retain only if directly deducible from source context.
* `Unsupported metric`: **Block generation** (e.g., reject arbitrary round percentages like "increased productivity by 35%" without proof).



#### Rule 6: Authorial Voice Fingerprint Preservation

* **Constraint:** Maintain authorial continuity between the source material and the rewritten output.
* **Action:** Analyze source metrics prior to rewriting (sentence complexity, vocabulary depth, average bullet length, verb style, first-person usage, and technical density) and constrain semantic modifications to prevent total stylistic replacement.

#### Rule 7: Semantic Relevance Coverage over Keyword Frequency

* **Constraint:** Do not repeat target keywords to game ATS counters.
* **Action:** Calculate qualitative relevance coverage rather than raw frequency. Map high-importance JD terms to existing candidate terminology via semantic translation.

#### Rule 8: Dual-Consumer Optimization (Machine + Human)

* **Constraint:** Balance parseability for automated systems with credibility and scannability for human evaluators.
* **Action:** Structure output to serve the hierarchical flow:

$$\text{ATS (Parseability)} \leftarrow \text{Optimal Resume} \rightarrow \text{Evidence (Credibility)}$$



Driven fundamentally by **Job Relevance**.

#### Rule 9: Preservation of "Human Weirdness"

* **Constraint:** Retain idiosyncratic, plain-spoken, or context-specific phrasing that demonstrates authentic human voice.
* **Action:** Favor *specific + plain + defensible* phrasings over *polished + impressive + vague* abstractions.

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
    const mustHave = data.keywords.must_have.filter(Boolean).join(", ");
    const phrases = data.keywords.phrases.filter(Boolean).join(", ");
    const keywords = data.keywords.keywords.filter(Boolean).join(", ");
    const niceToHave = data.keywords.nice_to_have.filter(Boolean).join(", ");
    const result = await chat({
      apiKey: data.apiKey,
      maxTokens: 8192,
      temperature: 0.2,
      user: `STEP 2 — Completely rewrite the WHOLE resume for strict syntactic + deep semantic ATS dual-alignment.

Goal: Conform the existing resume to the target role. The output must read as if the candidate wrote it specifically for this posting, while remaining 100% truthful to the source content.

Layout lock (mandatory):
- Keep every tag, attribute, class, id, inline style, <style> block, table, and document structure from the original HTML.
- Change TEXT CONTENT only. Do not restyle. Do not add or remove sections, columns, or wrappers.
- Return ONLY HTML. No markdown, no commentary.
- Do not change any location at any part of the resume.

### SYNTACTIC ALIGNMENT (Exact Keyword Matching)
- Integrate extracted keywords, acronyms, and multi-word phrases VERBATIM. Do not alter singular/plural forms or spellings of critical toolsets, certifications, or methodologies from the must_have / phrases lists.
- Density: every high-priority must_have keyword must appear at least once in the professional summary or core competencies AND naturally inside experience bullets. Avoid robotic stuffing or consecutive repetition of the same term.

### SEMANTIC ALIGNMENT (Contextual Relevance)
- Reframe historical experience to map to the problem domains, scaling challenges, and business outcomes emphasized in the JD.
- Every experience bullet MUST follow the PAR formula:
  [Action Verb] + [Task utilizing JD Keyword] + [Context/Scale] + [Quantifiable Impact].
  Use only metrics, scales, and outcomes already present or clearly supported by the source resume. Never invent numbers.
- Mirror the industry-specific lexicon of the target vertical.

### CONTEXTUAL BOUNDARY & POLLUTION FILTER (mandatory)
- Taxonomic Separation: isolate keywords into correct ontological buckets before insertion.
  - NEVER inject job titles, company names, seniorities, or employment statuses into technical skills, toolsets, or core competencies (e.g. ban "Director of Product" inside a Skills list).
- Domain Context Validation before every insertion:
  - Tools/Technologies → only technical competencies / tech stacks.
  - Methodologies/Frameworks → only process, domain expertise, or experience bullets.
  - Roles/Titles → only summary hooks or professional experience headers.
  - Locations / geographies / administrative constraints → never in skills or tool blocks.
- Negative Filtering: after drafting, self-audit for absurd collocation; strip any keyword whose category mismatches the section it landed in.

### Full-orientation rewrite logic (apply to every part of the resume)
1. Professional summary / objective / profile
   - Rewrite so it mirrors the job's top priorities, seniority, and language.
   - Lead with the most relevant strengths and must-have alignments that the source resume already supports.
   - Place at least one high-priority mandatory keyword/phrase here.
   - Roles/titles from the JD may appear here as target-role framing only if they truthfully describe the candidate's trajectory; never invent a title the candidate did not hold.

2. Skills / technologies / core competencies
   - Reorder and rephrase existing skills so the job's must-have and high-priority TOOLS/TECH terms appear first and in the employer's exact wording where truthful.
   - ONLY tools, technologies, platforms, languages, frameworks, certifications, and genuine technical competencies belong here.
   - NEVER place job titles, company names, seniorities, locations, or administrative constraints in this section.
   - Drop or de-emphasize skills that are irrelevant to this posting only if the original content allows; never invent new skills.

3. Experience / work history bullets
   - Completely rewrite every bullet with the PAR structure and JD keywords embedded.
   - Map existing achievements, responsibilities, and tools to the closest matching keywords and phrases from the ATS list.
   - Prefer the employer's exact tokens when the candidate already performed that work.
   - Methodologies, process phrases, and domain terms belong here; titles stay in headers only.
   - Preserve all real employers, titles, dates, and locations exactly as they appear.

4. Projects, education, certifications, and other sections
   - Rephrase descriptions and highlight the elements that best match the job's requirements and preferred qualifications.
   - Surface relevant coursework, tools, or credentials using the posting's wording where accurate.
   - Keep taxonomic boundaries: no title pollution in skills-like lists.

### Zero Hallucination
- Do not fabricate employers, titles, dates, degrees, certifications, tools, metrics, or achievements.
- Only use terms that truthfully map to experience already present in the source resume.
- If a mandatory skill is missing, adapt adjacent experience transparently; never invent a false history.

MUST_HAVE (highest priority — exact replication, respect taxonomic buckets):
${mustHave || "(none extracted)"}

PHRASES (multi-word — exact replication, respect taxonomic buckets):
${phrases || "(none extracted)"}

KEYWORDS:
${keywords || "(none extracted)"}

NICE_TO_HAVE:
${niceToHave || "(none extracted)"}

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
- Strip or dilute exact ATS keywords that were intentionally placed in STEP 2
- Introduce taxonomic pollution (e.g. job titles into skills lists)

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
      user: `STEP 4 — Audit for overuse, redundant application, AND taxonomic pollution of ATS keywords and phrases.

Find and fix:
- The same keyword repeated in consecutive bullets
- Unnatural stuffing
- Keywords that do not match the candidate's actual experience (remove those)
- Density that would look spammy to a human reader
- CONTEXTUAL BOUNDARY VIOLATIONS (pollution filter):
  - Job titles, company names, seniorities, or employment statuses sitting inside skills / toolsets / core competencies lists → STRIP them from those sections
  - Locations, geographies, or administrative constraints inside software/skill blocks → STRIP them
  - Methodologies or role titles misplaced into pure tech-stack lists → move or strip
  - Any absurd keyword collocation where category mismatches the section → strip immediately

Fix the HTML: keep the strongest natural occurrence of each term in the CORRECT section, drop redundant or polluted ones.
Keep tags, attributes, classes, ids, and styles identical except for text changes.
Preserve must_have terms that appear only once, fit truthfully, AND sit in a taxonomically valid section — do not strip required coverage that is correctly placed.

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
