export const PIPELINE_STEPS = [
  {
    id: 1,
    key: "extract",
    title: "Extract ATS keywords",
    blurb: "Pull keywords and phrases from the job description.",
  },
  {
    id: 2,
    key: "rewrite",
    title: "Rewrite resume",
    blurb: "Rewrite the full resume using those terms, truthfully.",
  },
  {
    id: 3,
    key: "grammar",
    title: "Grammar check",
    blurb: "Fix spelling and make the language sound like a person wrote it.",
  },
  {
    id: 4,
    key: "audit",
    title: "Keyword audit",
    blurb: "Cut stuffing, repetition, and keywords that do not fit.",
  },
  {
    id: 5,
    key: "layout",
    title: "Lock layout",
    blurb: "Keep the original HTML structure, classes, and styles.",
  },
  {
    id: 6,
    key: "clean",
    title: "Clean HTML",
    blurb: "Return a complete, fence-free HTML document.",
  },
] as const;

export type StepId = (typeof PIPELINE_STEPS)[number]["id"];
export type StepStatus = "idle" | "running" | "done" | "error";

export type KeywordSet = {
  keywords: string[];
  phrases: string[];
  must_have: string[];
  nice_to_have: string[];
};

export type AuditFlag = {
  issue: string;
  fix: string;
};

export type AuditResult = {
  flags: AuditFlag[];
  keyword_counts: Record<string, number>;
};

export const API_KEY_STORAGE = "ats-align.gemini-api-key";
export const SEARCH_API_KEY_STORAGE = "ats-align.search-api-key";
export const DRAFT_STORAGE = "ats-align.draft";

export const MAX_RESUME_CHARS = 80_000;
export const MAX_JOB_CHARS = 40_000;
