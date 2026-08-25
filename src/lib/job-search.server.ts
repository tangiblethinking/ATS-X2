import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { htmlToText } from "@/lib/job-fetch.server";

export type JobPortal = "workable" | "greenhouse" | "lever" | "dover";

export type JobResult = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  postedAt: string | null;
  postedAtMs: number | null;
  portal: JobPortal;
  applicationUrl: string;
  summary: string;
};

const PORTALS: {
  id: JobPortal;
  label: string;
  site: string;
  hostHint: RegExp;
}[] = [
  { id: "workable", label: "Workable", site: "workable.com", hostHint: /workable\.com/i },
  { id: "greenhouse", label: "Greenhouse", site: "boards.greenhouse.io", hostHint: /greenhouse\.io/i },
  { id: "lever", label: "Lever", site: "jobs.lever.co", hostHint: /lever\.co/i },
  { id: "dover", label: "Dover", site: "dover.com", hostHint: /dover\.com/i },
];

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/"/gi, '"')
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

/** Extract most recent / first (highest) experience job title from resume HTML. */
export function extractMostRecentJobTitle(html: string): string | null {
  if (!html || html.trim().length < 40) return null;

  const text = htmlToText(html);
  const expMatch = text.match(
    /(?:professional\s+)?experience|work\s+history|employment\s+history|career\s+history/i,
  );
  let slice = text;
  if (expMatch && expMatch.index != null) {
    slice = text.slice(expMatch.index, expMatch.index + 2500);
  }

  const patterns = [
    /(?:^|\n)\s*([A-Z][A-Za-z0-9+/&\- ]{2,60}?(?:Designer|Engineer|Manager|Director|Lead|Specialist|Analyst|Developer|Architect|Consultant|Officer|Coordinator|Associate|Intern|Writer|Researcher|Scientist|Product|Marketing|Sales|Operations|HR|Finance|Legal|Support)[A-Za-z0-9+/&\- ]{0,40})\s*(?:\n|\||–|—|-|at\s)/m,
    /(?:experience|history)[^\n]{0,80}\n+\s*([A-Z][^\n|]{4,70})/i,
    /(?:^|\n)\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z0-9+/&-]*){1,5})\s*(?:\n|\||–|—)/m,
  ];

  for (const re of patterns) {
    const m = slice.match(re);
    if (m?.[1]) {
      const title = m[1].replace(/\s+/g, " ").trim();
      if (title.length >= 4 && title.length <= 80 && !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(title)) {
        return title;
      }
    }
  }

  const lower = html.toLowerCase();
  const expIdx = lower.search(/experience|work\s+history|employment/i);
  const from = expIdx >= 0 ? html.slice(expIdx) : html;
  const hMatch = from.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
  if (hMatch?.[1]) {
    const t = decodeEntities(hMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (t.length >= 4 && t.length <= 80) return t;
  }

  return null;
}

function parseRelativeDate(snippet: string): { ms: number | null; text: string | null } {
  const now = Date.now();
  const lower = snippet.toLowerCase();

  const ago = lower.match(
    /(\d+)\s*(minute|min|hour|hr|day|week|month|year)s?\s*ago/,
  );
  if (ago) {
    const n = Number(ago[1]);
    const unit = ago[2];
    let ms = 0;
    if (unit.startsWith("min")) ms = n * 60_000;
    else if (unit.startsWith("hour") || unit === "hr") ms = n * 3_600_000;
    else if (unit.startsWith("day")) ms = n * 86_400_000;
    else if (unit.startsWith("week")) ms = n * 7 * 86_400_000;
    else if (unit.startsWith("month")) ms = n * 30 * 86_400_000;
    else if (unit.startsWith("year")) ms = n * 365 * 86_400_000;
    return { ms: now - ms, text: `${ago[1]} ${ago[2]}${n > 1 ? "s" : ""} ago` };
  }

  if (/\b(today|just now|hours? ago)\b/i.test(snippet)) {
    return { ms: now - 3_600_000, text: "Today" };
  }
  if (/\byesterday\b/i.test(snippet)) {
    return { ms: now - 86_400_000, text: "Yesterday" };
  }

  const abs = snippet.match(
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i,
  );
  if (abs) {
    const d = Date.parse(abs[1]);
    if (Number.isFinite(d)) return { ms: d, text: abs[1] };
  }

  return { ms: null, text: null };
}

function extractCompanyFromUrl(url: string, portal: JobPortal): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (portal === "lever" && path[0]) return path[0].replace(/-/g, " ");
    if (portal === "greenhouse" && path[0]) return path[0].replace(/-/g, " ");
    if (portal === "workable") {
      if (path[0] && path[0] !== "j" && path[0] !== "jobs") return path[0].replace(/-/g, " ");
    }
    if (portal === "dover" && path[0]) return path[0].replace(/-/g, " ");
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "Unknown";
  }
}

function parseDuckDuckGoHtml(
  html: string,
  portal: JobPortal,
  hostHint: RegExp,
): JobResult[] {
  const results: JobResult[] = [];
  const blocks = html.split(/class="[^"]*result[^"]*"/i).slice(1);

  for (const block of blocks) {
    const linkMatch =
      block.match(/href="(https?:\/\/[^"]+)"/i) ||
      block.match(/uddg=([^&"]+)/i);
    let href = linkMatch?.[1] ?? "";
    if (href.includes("uddg=")) {
      try {
        href = decodeURIComponent(href);
      } catch {
        /* keep */
      }
    }
    if (!href || !hostHint.test(href)) continue;
    if (/\/search\?|\/jobs\/?$|boards\.greenhouse\.io\/?$/i.test(href)) continue;

    const titleMatch =
      block.match(/class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<a[^>]+href="[^"]+"[^>]*>([\s\S]*?)<\/a>/i);
    let title = titleMatch?.[1]
      ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
      : "";
    if (!title || title.length < 3) continue;
    title = title.replace(/\s*[-|–—]\s*(Lever|Greenhouse|Workable|Dover).*$/i, "").trim();

    const snippetMatch =
      block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i) ||
      block.match(/class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    const summary = snippetMatch?.[1]
      ? decodeEntities(snippetMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 280)
      : "";

    const { ms, text: postedText } = parseRelativeDate(block + " " + summary);
    const company = extractCompanyFromUrl(href, portal);

    const salaryMatch = (summary + " " + title).match(
      /(\$[\d,]+(?:\s*[-–—to]+\s*\$?[\d,]+)?(?:\s*(?:k|K|\/yr|\/year|per year|annually)?)?)/,
    );
    const salary = salaryMatch ? salaryMatch[1] : null;

    const locationMatch = summary.match(
      /\b((?:Remote|Hybrid|On-?site|San Francisco|New York|London|Austin|Seattle|Boston|Chicago|Los Angeles|Berlin|Toronto|Sydney)[^,.]{0,40})/i,
    );
    const location = locationMatch ? locationMatch[1].trim() : "—";

    results.push({
      id: `${portal}-${href}`,
      title,
      company: company.replace(/\b\w/g, (c) => c.toUpperCase()),
      location,
      salary,
      postedAt: postedText,
      postedAtMs: ms,
      portal,
      applicationUrl: href.split("&")[0].split("#")[0],
      summary: summary || "No summary available.",
    });
  }

  return results;
}

async function searchPortal(
  title: string,
  portal: (typeof PORTALS)[number],
): Promise<{ portal: JobPortal; results: JobResult[]; error?: string }> {
  const query = encodeURIComponent(`"${title}" site:${portal.site}`);
  const url = `https://html.duckduckgo.com/html/?q=${query}`;

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (compatible; ATSAlign/1.0; +https://ats-x.vercel.app) AppleWebKit/537.36 Chrome/122.0.0.0",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      return {
        portal: portal.id,
        results: [],
        error: `${portal.label} search returned ${res.status}`,
      };
    }
    const html = await res.text();
    let results = parseDuckDuckGoHtml(html, portal.id, portal.hostHint);

    const cutoff = Date.now() - ONE_WEEK_MS;
    results = results.filter((r) => {
      if (r.postedAtMs == null) return true;
      return r.postedAtMs >= cutoff;
    });

    results = results.slice(0, 25);

    return { portal: portal.id, results };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return { portal: portal.id, results: [], error: `${portal.label}: ${message}` };
  }
}

export const extractJobTitle = createServerFn({ method: "POST" })
  .validator(
    z.object({
      resumeHtml: z.string().min(40).max(80_000),
    }),
  )
  .handler(async ({ data }) => {
    const title = extractMostRecentJobTitle(data.resumeHtml);
    if (!title) {
      return {
        ok: false as const,
        error: "Could not detect a job title in the first experience section. Check the resume HTML.",
      };
    }
    return { ok: true as const, title };
  });

export const searchAtsJobs = createServerFn({ method: "POST" })
  .validator(
    z.object({
      title: z.string().trim().min(2).max(120),
    }),
  )
  .handler(async ({ data }) => {
    const title = data.title.trim();
    const settled = await Promise.all(PORTALS.map((p) => searchPortal(title, p)));

    const errors: string[] = [];
    const all: JobResult[] = [];
    for (const s of settled) {
      if (s.error) errors.push(s.error);
      all.push(...s.results);
    }

    const seen = new Set<string>();
    const unique = all.filter((r) => {
      const key = r.applicationUrl.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    unique.sort((a, b) => {
      const am = a.postedAtMs ?? 0;
      const bm = b.postedAtMs ?? 0;
      return bm - am;
    });

    return {
      ok: true as const,
      title,
      results: unique,
      errors,
      searchedAt: new Date().toISOString(),
    };
  });

export { PORTALS };
