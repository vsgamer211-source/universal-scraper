// lib/parsers/annasSearch.ts
/**
 * Returns everything found on the page:
 * - rawResults: every <a href> with resolved URL + context
 * - md5Results: convenience array filtering hrefs that include '/md5/'
 *
 * No filtering / no protection detection here — this is a raw extractor.
 */

import * as cheerio from "cheerio";

export interface AnnasRawAnchor {
  href: string;              // original href attribute
  resolvedHref: string;      // absolute URL resolved against page base
  text: string;              // anchor text (trimmed)
  attributes: { [k: string]: string | null }; // raw attributes
  parentText: string;        // trimmed text of the anchor's parent element
  parentHtml: string;        // parent's inner HTML (raw)
  outerHtml: string;         // anchor.outerHTML
}

/**
 * parseAnnasSearch
 * - html: raw HTML string
 * - baseHint: optional base for resolving relative URLs
 *
 * Returns:
 * { rawResults: AnnasRawAnchor[], md5Results: AnnasRawAnchor[] }
 */
export function parseAnnasSearch(html: string, baseHint?: string) {
const $ = cheerio.load(html);
  // determine base origin for resolving relative urls
  let base = baseHint;
  if (!base) {
    base = $('link[rel="canonical"]').attr("href") || $('meta[property="og:url"]').attr("content") || undefined;
  }
  try {
    if (base) base = new URL(base).origin;
  } catch {
    base = undefined;
  }
  if (!base) base = "https://annas-archive.li";

  const rawResults: AnnasRawAnchor[] = [];

  $("a[href]").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";

    // Resolve href to absolute
    let resolved = href;
    try {
      resolved = new URL(href, base!).href;
    } catch {
      if (href.startsWith("//")) resolved = "https:" + href;
      else if (href.startsWith("/")) resolved = base + href;
      else resolved = href;
    }

    // collect attributes
    const attrs: { [k: string]: string | null } = {};
    const rawAttribs = (el && (el as any).attribs) || {};
    Object.keys(rawAttribs).forEach((k) => (attrs[k] = rawAttribs[k]));

    const parent = $a.parent();
    rawResults.push({
      href,
      resolvedHref: resolved,
      text: ($a.text() || "").trim(),
      attributes: attrs,
      parentText: (parent.text() || "").trim(),
      parentHtml: parent.html() || "",
      outerHtml: $.html($a) || "",
    });
  });

  // dedupe by resolvedHref while preserving first occurrence order
  const seen = new Set<string>();
  const dedupedRaw = rawResults.filter((r) => {
    const key = r.resolvedHref || r.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // convenience: md5 results
  const md5Results = dedupedRaw.filter((r) => r.href.includes("/md5/") || r.resolvedHref.includes("/md5/"));

  return {
    rawResults: dedupedRaw,
    md5Results,
  };
}