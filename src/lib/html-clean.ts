const FENCE_RE = /^```(?:html|HTML|xml|htm)?\s*\n?([\s\S]*?)\n?```\s*$/;

export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(FENCE_RE);
  if (fenced?.[1]) return fenced[1].trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:html|HTML|xml|htm)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();
  }
  return trimmed;
}

function extractHead(html: string): string | null {
  const match = html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i);
  return match ? match[0] : null;
}

function extractStyles(html: string): string {
  const matches = html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi);
  return matches ? matches.join("\n") : "";
}

function ensureDoctype(html: string): string {
  if (/<!DOCTYPE/i.test(html)) return html.trim();
  return `<!DOCTYPE html>\n${html.trim()}`;
}

function isFullDocument(html: string): boolean {
  return /<html\b/i.test(html) || /<!DOCTYPE/i.test(html);
}

/**
 * Step 6: emit a complete, fence-free HTML document.
 * Preserves original <head> / <style> when the model returned a fragment.
 */
export function finalizeCleanHtml(
  originalHtml: string,
  rewrittenHtml: string,
): string {
  const html = stripMarkdownFences(rewrittenHtml);
  const orig = originalHtml.trim();

  if (isFullDocument(html)) {
    return ensureDoctype(html);
  }

  if (isFullDocument(orig)) {
    const head =
      extractHead(orig) ??
      `<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Resume</title>\n${extractStyles(orig)}\n</head>`;
    const bodyInner = html.replace(/<\/?body\b[^>]*>/gi, "").trim();
    const lang = orig.match(/<html\b[^>]*\blang=["']([^"']+)["']/i)?.[1] ?? "en";
    return `<!DOCTYPE html>\n<html lang="${lang}">\n${head}\n<body>\n${bodyInner}\n</body>\n</html>`;
  }

  const style = extractStyles(orig);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Resume</title>
${style}
</head>
<body>
${html}
</body>
</html>`;
}

export function looksLikeHtml(value: string): boolean {
  const t = value.trim();
  return /<\/?[a-z][\s\S]*>/i.test(t);
}
