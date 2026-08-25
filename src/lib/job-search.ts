import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/"/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

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
const SERPER_SEARCH_URL = "https://google.serper.dev/search";

const BROWSER_HEADERS: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

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

export function extractMostRecentJobTitle(html: string): string | null {
  if (!html || html.trim().length < 40) return null;
  const text = htmlToText(html);
  const expMatch = text.match(
    /(?:professional\s+)?experience|work\s+history|employment\s+history|career\s+history/i,
  );
  let slice = text;
  if (expMatch && expMatch.index != null) slice = text.slice(expMatch.index, expMatch.index + 2500);
  const patterns = [
    /(?:^|\n)\s*([A-Z][A-Za-z0-9+/&\- ]{2,60}?(?:Designer|Engineer|Manager|Director|Lead|Specialist|Analyst|Developer|Architect|Consultant|Officer|Coordinator|Associate|Intern|Writer|Researcher|Scientist|Product|Marketing|Sales|Operations|HR|Finance|Legal|Support)[A-Za-z0-9+/&\- ]{0,40})\s*(?:\n|\||–|—|-|at\s)/m,
    /(?:experience|history)[^\n]{0,80}\n+\s*([A-Z][^\n|]{4,70})/i,
    /(?:^|\n)\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z0-9+/&-]*){1,5})\s*(?:\n|\||–|—)/m,
  ];
  for (const re of patterns) {
    const m = slice.match(re);
    if (m?.[1]) {
      const title = m[1].replace(/\s+/g, " ").trim();
      if (title.length >= 4 && title.length <= 80 && !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(title)) return title;
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
  const ago = lower.match(/(\d+)\s*(minute|min|hour|hr|day|week|month|year)s?\s*ago/);
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
  if (/\b(today|just now|hours? ago)\b/i.test(snippet)) return { ms: now - 3_600_000, text: "Today" };
  if (/\byesterday\b/i.test(snippet)) return { ms: now - 86_400_000, text: "Yesterday" };
  const abs = snippet.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i);
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
    if (portal === "workable" && path[0] && path[0] !== "j" && path[0] !== "jobs") return path[0].replace(/-/g, " ");
    if (portal === "dover" && path[0]) return path[0].replace(/-/g, " ");
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "Unknown";
  }
}

type ParsedHit = { title: string; href: string; summary: string };

function hitToJob(hit: ParsedHit, portal: JobPortal): JobResult {
  let title = hit.title.replace(/\s*[-|–—]\s*(Lever|Greenhouse|Workable|Dover).*$/i, "").trim();
  const { ms, text: postedText } = parseRelativeDate(hit.summary + " " + hit.title);
  const company = extractCompanyFromUrl(hit.href, portal);
  const salaryMatch = (hit.summary + " " + title).match(/(\$[\d,]+(?:\s*[-–—to]+\s*\$?[\d,]+)?(?:\s*(?:k|K|\/yr|\/year|per year|annually)?)?)/);
  const locationMatch = hit.summary.match(/\b((?:Remote|Hybrid|On-?site|San Francisco|New York|London|Austin|Seattle|Boston|Chicago|Los Angeles|Berlin|Toronto|Sydney)[^,.]{0,40})/i);
  return {
    id: `${portal}-${hit.href}`,
    title,
    company: company.replace(/\b\w/g, (c) => c.toUpperCase()),
    location: locationMatch ? locationMatch[1].trim() : "—",
    salary: salaryMatch ? salaryMatch[1] : null,
    postedAt: postedText,
    postedAtMs: ms,
    portal,
    applicationUrl: hit.href.split("&")[0] ?? hit.href,
    summary: hit.summary || "No summary available.",
  };
}

function filterRecent(results: JobResult[]): JobResult[] {
  const cutoff = Date.now() - ONE_WEEK_MS;
  return results.filter((r) => (r.postedAtMs == null ? true : r.postedAtMs >= cutoff)).slice(0, 25);
}

async function searchPortalSerper(
  title: string,
  portal: (typeof PORTALS)[number],
  apiKey: string,
): Promise<{ portal: JobPortal; results: JobResult[]; error?: string; authError?: boolean }> {
  const q = `"${title}" site:${portal.site}`;
  try {
    const res = await fetch(SERPER_SEARCH_URL, {
      method: "POST",
      signal: AbortSignal.timeout(14000),
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({ q, num: 10 }),
    });
    const body = (await res.json()) as {
      message?: string;
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    if (res.status === 401 || res.status === 403) {
      return {
        portal: portal.id,
        results: [],
        error: `${portal.label}: invalid or exhausted Serper key`,
        authError: true,
      };
    }
    if (!res.ok) {
      const msg = body.message || `Serper HTTP ${res.status}`;
      return { portal: portal.id, results: [], error: `${portal.label}: ${msg}` };
    }
    const items = body.organic ?? [];
    const hits: ParsedHit[] = items
      .filter((it) => it.link && portal.hostHint.test(it.link))
      .map((it) => ({
        title: it.title ?? "Untitled",
        href: it.link!,
        summary: it.snippet ?? "",
      }));
    return {
      portal: portal.id,
      results: filterRecent(hits.map((h) => hitToJob(h, portal.id))),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Serper failed";
    return { portal: portal.id, results: [], error: `${portal.label}: ${message}` };
  }
}

function cleanHref(raw: string): string {
  let href = raw.trim();
  const ud = href.match(/[?&]u=([^&]+)/);
  if (ud?.[1]) { try { href = decodeURIComponent(ud[1]); } catch { /* keep */ } }
  const uddg = href.match(/uddg=([^&]+)/);
  if (uddg?.[1]) { try { href = decodeURIComponent(uddg[1]); } catch { /* keep */ } }
  if (href.startsWith("//")) href = `https:${href}`;
  return href.split("#")[0] ?? href;
}

function parseBingHtml(html: string): ParsedHit[] {
  const hits: ParsedHit[] = [];
  const blocks = html.split(/<li[^>]*class="[^"]*b_algo[^"]*"/i).slice(1);
  for (const block of blocks) {
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const href = cleanHref(linkMatch[1] ?? "");
    const title = decodeEntities((linkMatch[2] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!title || !href.startsWith("http")) continue;
    const snipMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || block.match(/class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)(?:<\/div>|<ul)/i);
    const summary = snipMatch?.[1]
      ? decodeEntities(snipMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 280)
      : "";
    hits.push({ title, href, summary });
  }
  return hits;
}

function parseDuckDuckGoHtml(html: string): ParsedHit[] {
  const hits: ParsedHit[] = [];
  const rowRe = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const href = cleanHref(m[1] ?? "");
    const title = decodeEntities((m[2] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!title || !href.startsWith("http")) continue;
    hits.push({ title, href, summary: "" });
  }
  if (hits.length === 0) {
    const blocks = html.split(/class="[^"]*result[^"]*"/i).slice(1);
    for (const block of blocks) {
      const linkMatch =
        block.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
        block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;
      const href = cleanHref(linkMatch[1] ?? "");
      const title = decodeEntities((linkMatch[2] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      if (!title || !href.startsWith("http")) continue;
      const snip = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
      const summary = snip?.[1]
        ? decodeEntities(snip[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 280)
        : "";
      hits.push({ title, href, summary });
    }
  }
  return hits;
}

async function searchPortalPublic(
  title: string,
  portal: (typeof PORTALS)[number],
): Promise<{ portal: JobPortal; results: JobResult[]; error?: string }> {
  const queries = [`"${title}" site:${portal.site}`, `${title} site:${portal.site}`];
  const errors: string[] = [];

  for (const q of queries) {
    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20&setlang=en-US&cc=US`;
      const res = await fetch(url, {
        redirect: "follow",
        headers: { ...BROWSER_HEADERS, Referer: "https://www.bing.com/" },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        errors.push(`Bing ${res.status}`);
        continue;
      }
      const html = await res.text();
      const hits = parseBingHtml(html).filter((h) => portal.hostHint.test(h.href));
      const results = filterRecent(hits.map((h) => hitToJob(h, portal.id)));
      if (results.length > 0) return { portal: portal.id, results };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Bing error");
    }
  }

  for (const q of queries) {
    try {
      const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        redirect: "follow",
        headers: { ...BROWSER_HEADERS, Referer: "https://lite.duckduckgo.com/" },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        errors.push(`DDG ${res.status}`);
        continue;
      }
      const html = await res.text();
      const hits = parseDuckDuckGoHtml(html).filter((h) => portal.hostHint.test(h.href));
      const results = filterRecent(hits.map((h) => hitToJob(h, portal.id)));
      if (results.length > 0) return { portal: portal.id, results };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "DDG error");
    }
  }

  return {
    portal: portal.id,
    results: [],
    error: errors.length > 0 ? `${portal.label}: public search empty (${errors.slice(0, 2).join("; ")})` : undefined,
  };
}

export const extractJobTitle = createServerFn({ method: "POST" })
  .validator(z.object({ resumeHtml: z.string().min(40).max(80_000) }))
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

/** Job Search only — uses searchApiKey (Serper), never the Gemini pipeline key. */
export const searchAtsJobs = createServerFn({ method: "POST" })
  .validator(
    z.object({
      title: z.string().trim().min(2).max(120),
      searchApiKey: z.string().trim().min(20).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const title = data.title.trim();
    const searchApiKey = data.searchApiKey?.trim();

    const errors: string[] = [];
    const all: JobResult[] = [];
    let engine: "serper" | "public" | "mixed" = "public";
    let serperAuthDenied = false;

    if (searchApiKey) {
      const serperResults = await Promise.all(
        PORTALS.map((p) => searchPortalSerper(title, p, searchApiKey)),
      );
      for (const s of serperResults) {
        all.push(...s.results);
        if (s.authError) {
          serperAuthDenied = true;
        } else if (s.error && s.results.length === 0) {
          errors.push(s.error);
        }
      }
      if (all.length > 0) engine = "serper";
    }

    if (all.length === 0) {
      if (serperAuthDenied) {
        errors.push(
          "Invalid or exhausted Serper key. Using public web search instead…",
        );
      }
      const pub = await Promise.all(PORTALS.map((p) => searchPortalPublic(title, p)));
      for (const s of pub) {
        all.push(...s.results);
        if (s.error && s.results.length === 0) errors.push(s.error);
      }
      engine = searchApiKey ? "mixed" : "public";
    }

    const seenErr = new Set<string>();
    const uniqueErrors = errors.filter((e) => {
      const key = e.replace(/^(Workable|Greenhouse|Lever|Dover):\s*/i, "").toLowerCase();
      if (seenErr.has(key)) return false;
      seenErr.add(key);
      return true;
    });

    const seen = new Set<string>();
    const unique = all.filter((r) => {
      const key = r.applicationUrl.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    unique.sort((a, b) => (b.postedAtMs ?? 0) - (a.postedAtMs ?? 0));

    return {
      ok: true as const,
      title,
      results: unique,
      errors: uniqueErrors,
      engine,
      serperAuthDenied,
      keyHint: searchApiKey ? `${searchApiKey.slice(0, 4)}…${searchApiKey.slice(-4)}` : null,
      searchedAt: new Date().toISOString(),
    };
  });

export { PORTALS };
