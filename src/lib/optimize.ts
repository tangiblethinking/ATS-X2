import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { finalizeCleanHtml, stripMarkdownFences } from "@/lib/html-clean";
import type { AuditResult, KeywordSet } from "@/lib/pipeline-types";
import { MAX_JOB_CHARS, MAX_RESUME_CHARS } from "@/lib/pipeline-types";
import systemPrompt from "@/lib/system-prompt.txt?raw";

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

const SYSTEM = systemPrompt;

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
      user: `STEP 1 — Exhaustively extract EVERY ATS-relevant keyword and phrase from this job description.\n\nBe completely thorough. Do not stop at a short list. Scrape the entire posting and return the maximum useful signal an ATS and a recruiter would care about.\n\nReturn JSON only, shape:\n{\n  \"keywords\": string[],      // single tokens: tools, technologies, skills, certifications, job titles, domain terms, methodologies, soft skills, industry terms, acronyms, software, platforms, frameworks, languages, standards, regulations\n  \"phrases\": string[],       // multi-word requirements, responsibilities, qualifications, and capability statements copied closely from the posting (e.g. \"cross-functional collaboration\", \"end-to-end ownership\", \"stakeholder management\")\n  \"must_have\": string[],     // explicitly required / minimum qualifications, years of experience, degrees, certifications, must-know tools\n  \"nice_to_have\": string[]   // preferred, bonus, \"nice to have\", \"plus\", preferred qualifications\n}\n\nExtraction rules (mandatory):\n- Extract as many distinct items as the posting contains. Target 40–120+ total items across all arrays when the JD is rich; never artificially limit yourself to a handful.\n- Prefer the employer's exact wording and casing (the tokens an ATS will scan).\n- Include synonyms and near-variants that appear in the text (e.g. both \"JS\" and \"JavaScript\" if both appear).\n- Capture action-oriented capability phrases from responsibilities and requirements sections.\n- Capture every tool, technology, platform, language, framework, methodology, certification, and domain term.\n- Capture soft-skill and leadership phrases when they are written as requirements or preferred traits.\n- Deduplicate exact duplicates only. Keep close variants if the wording differs.\n- Do not invent terms that are not present or strongly implied by the posting.\n- No prose, no explanations, JSON only.\n\nJOB DESCRIPTION:\n${data.jobText}`,
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
      user: `STEP 2 — Completely rewrite the WHOLE resume for strict syntactic + deep semantic ATS dual-alignment.\n\nGoal: Conform the existing resume to the target role. The output must read as if the candidate wrote it specifically for this posting, while remaining 100% truthful to the source content.\n\nLayout lock (mandatory):\n- Keep every tag, attribute, class, id, inline style, <style> block, table, and document structure from the original HTML.\n- Change TEXT CONTENT only. Do not restyle. Do not add or remove sections, columns, or wrappers.\n- Return ONLY HTML. No markdown, no commentary.\n- Do not change any location at any part of the resume.\n\n### SYNTACTIC ALIGNMENT (Exact Keyword Matching)\n- Integrate extracted keywords, acronyms, and multi-word phrases VERBATIM. Do not alter singular/plural forms or spellings of critical toolsets, certifications, or methodologies from the must_have / phrases lists.\n- Density: every high-priority must_have keyword must appear at least once in the professional summary or core competencies AND naturally inside experience bullets. Avoid robotic stuffing or consecutive repetition of the same term.\n\n### SEMANTIC ALIGNMENT (Contextual Relevance)\n- Reframe historical experience to map to the problem domains, scaling challenges, and business outcomes emphasized in the JD.\n- Every experience bullet MUST follow the PAR formula:\n  [Action Verb] + [Task utilizing JD Keyword] + [Context/Scale] + [Quantifiable Impact].\n  Use only metrics, scales, and outcomes already present or clearly supported by the source resume. Never invent numbers.\n- Mirror the industry-specific lexicon of the target vertical.\n\n### CONTEXTUAL BOUNDARY & POLLUTION FILTER (mandatory)\n- Taxonomic Separation: isolate keywords into correct ontological buckets before insertion.\n  - NEVER inject job titles, company names, seniorities, or employment statuses into technical skills, toolsets, or core competencies (e.g. ban \"Director of Product\" inside a Skills list).\n- Domain Context Validation before every insertion:\n  - Tools/Technologies → only technical competencies / tech stacks.\n  - Methodologies/Frameworks → only process, domain expertise, or experience bullets.\n  - Roles/Titles → only summary hooks or professional experience headers.\n  - Locations / geographies / administrative constraints → never in skills or tool blocks.\n- Negative Filtering: after drafting, self-audit for absurd collocation; strip any keyword whose category mismatches the section it landed in.\n\n### Full-orientation rewrite logic (apply to every part of the resume)\n1. Professional summary / objective / profile\n   - Rewrite so it mirrors the job's top priorities, seniority, and language.\n   - Lead with the most relevant strengths and must-have alignments that the source resume already supports.\n   - Place at least one high-priority mandatory keyword/phrase here.\n   - Roles/titles from the JD may appear here as target-role framing only if they truthfully describe the candidate's trajectory; never invent a title the candidate did not hold.\n\n2. Skills / technologies / core competencies\n   - Reorder and rephrase existing skills so the job's must-have and high-priority TOOLS/TECH terms appear first and in the employer's exact wording where truthful.\n   - ONLY tools, technologies, platforms, languages, frameworks, certifications, and genuine technical competencies belong here.\n   - NEVER place job titles, company names, seniorities, locations, or administrative constraints in this section.\n   - Drop or de-emphasize skills that are irrelevant to this posting only if the original content allows; never invent new skills.\n\n3. Experience / work history bullets\n   - Completely rewrite every bullet with the PAR structure and JD keywords embedded.\n   - Map existing achievements, responsibilities, and tools to the closest matching keywords and phrases from the ATS list.\n   - Prefer the employer's exact tokens when the candidate already performed that work.\n   - Methodologies, process phrases, and domain terms belong here; titles stay in headers only.\n   - Preserve all real employers, titles, dates, and locations exactly as they appear.\n\n4. Projects, education, certifications, and other sections\n   - Rephrase descriptions and highlight the elements that best match the job's requirements and preferred qualifications.\n   - Surface relevant coursework, tools, or credentials using the posting's wording where accurate.\n   - Keep taxonomic boundaries: no title pollution in skills-like lists.\n\n### Zero Hallucination\n- Do not fabricate employers, titles, dates, degrees, certifications, tools, metrics, or achievements.\n- Only use terms that truthfully map to experience already present in the source resume.\n- If a mandatory skill is missing, adapt adjacent experience transparently; never invent a false history.\n\nMUST_HAVE (highest priority — exact replication, respect taxonomic buckets):\n${mustHave || "(none extracted)"}\n\nPHRASES (multi-word — exact replication, respect taxonomic buckets):\n${phrases || "(none extracted)"}\n\nKEYWORDS:\n${keywords || "(none extracted)"}\n\nNICE_TO_HAVE:\n${niceToHave || "(none extracted)"}\n\nORIGINAL RESUME HTML:\n${data.resumeHtml}`,
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
      user: `STEP 3 — Grammar check for proper spelling and real language use.\n\nFix:\n- Spelling, grammar, punctuation, subject-verb agreement\n- Awkward or robotic phrasing\n- Buzzword salad; rewrite into language a hiring manager would actually say\n\nDo not:\n- Change facts, dates, names, or numbers\n- Add new claims\n- Alter HTML tags, attributes, classes, ids, or styles\n- Strip or dilute exact ATS keywords that were intentionally placed in STEP 2\n- Introduce taxonomic pollution (e.g. job titles into skills lists)\n\nReturn ONLY the full HTML. No markdown.\n\nRESUME HTML:\n${data.resumeHtml}`,
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
      user: `STEP 4 — Audit for overuse, redundant application, AND taxonomic pollution of ATS keywords and phrases.\n\nFind and fix:\n- The same keyword repeated in consecutive bullets\n- Unnatural stuffing\n- Keywords that do not match the candidate's actual experience (remove those)\n- Density that would look spammy to a human reader\n- CONTEXTUAL BOUNDARY VIOLATIONS (pollution filter):\n  - Job titles, company names, seniorities, or employment statuses sitting inside skills / toolsets / core competencies lists → STRIP them from those sections\n  - Locations, geographies, or administrative constraints inside software/skill blocks → STRIP them\n  - Methodologies or role titles misplaced into pure tech-stack lists → move or strip\n  - Any absurd keyword collocation where category mismatches the section → strip immediately\n\nFix the HTML: keep the strongest natural occurrence of each term in the CORRECT section, drop redundant or polluted ones.\nKeep tags, attributes, classes, ids, and styles identical except for text changes.\nPreserve must_have terms that appear only once, fit truthfully, AND sit in a taxonomically valid section — do not strip required coverage that is correctly placed.\n\nReturn JSON only:\n{\n  \"html\": \"full resume HTML after fixes\",\n  \"flags\": [{ \"issue\": string, \"fix\": string }],\n  \"keyword_counts\": { \"term\": number }\n}\n\nATS KEYWORDS AND PHRASES:\n${kw}\n\nRESUME HTML:\n${data.resumeHtml}`,
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
      user: `STEP 5 — Follow the exact layout and styling of the original HTML so every resume output is consistent.\n\nTake the ORIGINAL HTML as the structural source of truth.\nTake the CURRENT HTML as the source of rewritten text.\n\nProduce HTML that:\n- Uses the original's exact tags, nesting, classes, ids, inline styles, <style> blocks, fonts, spacing, tables, and wrappers\n- Replaces only text nodes with the improved wording from CURRENT\n- Does not introduce new CSS, new sections, or a different template\n- If CURRENT dropped a region that ORIGINAL had, restore the original region (with original text if no rewrite exists)\n\nReturn ONLY the full HTML. No markdown.\n\nORIGINAL HTML (layout source of truth):\n${data.originalHtml}\n\nCURRENT HTML (wording to keep):\n${data.currentHtml}`,
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
