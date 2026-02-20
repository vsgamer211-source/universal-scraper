// providers/annas.ts
import { Provider } from "@/lib/types";
import { fetchWithPlaywright } from "@/lib/playwrightFetcher";

/**
 * AnnasProvider — ultra-robust raw fetcher for Anna's Archive
 *
 * Behavior:
 * - Always attempt to fetch the exact URL provided by the caller.
 * - If the exact URL fails, attempt safe fallbacks in this order:
 *   1. retry the same URL (small backoff)
 *   2. toggle protocol (https <-> http)
 *   3. add/remove trailing slash
 *   4. try known mirror origins but KEEP the original path + query intact
 * - Does not filter or parse HTML; returns whatever the fetcher returns (string or object).
 * - Never throws for transient fetch errors — returns an `error` field and diagnostics instead.
 */

const MIRROR_ORIGINS = [
  "https://annas-archive.li",
  "https://annas-archive.org",
  "https://annas-archive.se",
];

type FetchAttempt = {
  attemptUrl: string;
  success: boolean;
  error?: string;
  source?: string; // "playwright" | "http" | other tag
  returnedType?: "string" | "object" | "unknown";
};

function normalizeUrlCandidate(original: string, candidateOrigin?: string): string {
  try {
    const u = new URL(original);
    if (!candidateOrigin) return u.toString();
    // preserve path + search + hash, only replace origin
    const origin = new URL(candidateOrigin).origin;
    return origin + u.pathname + u.search + u.hash;
  } catch {
    // if original isn't parseable, try to return candidateOrigin + original
    if (candidateOrigin) {
      return candidateOrigin + original;
    }
    return original;
  }
}

export const AnnasProvider: Provider = {
  name: "annas-archive",

  match: (url: string) => {
    return (
      typeof url === "string" &&
      (url.includes("annas-archive.org") ||
        url.includes("annas-archive.li") ||
        url.includes("annas-archive.se"))
    );
  },

  scrape: async (url: string) => {
    const start = Date.now();

    if (!url || typeof url !== "string") {
      return {
        title: "Anna Raw Fetch",
        error: "Invalid or missing URL",
        sourceUrl: url,
        timestamp: new Date().toISOString(),
      } as any;
    }

    const maxRetries = 2;
    const attempts: FetchAttempt[] = [];
    let lastErrMsg: string | null = null;
    let fetchResult: any = null;
    let finalAttemptUrl: string | null = null;
    let usedFallbackOrigin: string | null = null;

    // Helper to attempt a single fetch and record diagnostics
    const tryFetch = async (attemptUrl: string, tag?: string): Promise<boolean> => {
      const attemptRecord: FetchAttempt = { attemptUrl, success: false };
      try {
        const r = await fetchWithPlaywright(attemptUrl as string, {
          // ask the fetcher to capture API responses if it supports the option;
          // if not supported by the fetcher implementation it should be ignored.
          enableApiCapture: true,
        } as any);
        fetchResult = r;
        attemptRecord.success = true;
        attemptRecord.source = typeof r === "string" ? "playwright-string" : "playwright-object";
        attemptRecord.returnedType = typeof r === "string" ? "string" : "object";
        attempts.push(attemptRecord);
        finalAttemptUrl = attemptUrl;
        if (tag) usedFallbackOrigin = tag;
        return true;
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        attemptRecord.success = false;
        attemptRecord.error = msg;
        attempts.push(attemptRecord);
        lastErrMsg = msg;
        return false;
      }
    };

    // 1) try the exact URL, with a couple retries
    for (let i = 0; i < maxRetries; i++) {
      // small backoff on retries
      if (i > 0) {
        await new Promise((res) => setTimeout(res, 400 * i));
      }
      const ok = await tryFetch(url, "original");
      if (ok) break;
    }

    // 2) if still no result, try flipping protocol (https <-> http)
    if (!fetchResult) {
      try {
        const u = new URL(url);
        const swapped = (u.protocol === "https:" ? "http:" : "https:") + "//" + u.host + u.pathname + u.search + u.hash;
        for (let i = 0; i < 2 && !fetchResult; i++) {
          const ok = await tryFetch(swapped, "protocol-swapped");
          if (ok) break;
        }
      } catch {
        // ignore invalid URL parse here
      }
    }

    // 3) try adding or removing trailing slash variations if still failing
    if (!fetchResult) {
      try {
        const u = new URL(url);
        const hasSlash = u.pathname.endsWith("/");
        const variant = hasSlash ? u.origin + u.pathname.slice(0, -1) + u.search + u.hash : u.origin + u.pathname + "/" + u.search + u.hash;
        for (let i = 0; i < 2 && !fetchResult; i++) {
          const ok = await tryFetch(variant, "trailing-slash-variant");
          if (ok) break;
        }
      } catch {
        // ignore
      }
    }

    // 4) mirror origin fallback — preserve the original path + query exactly
    if (!fetchResult) {
      for (const origin of MIRROR_ORIGINS) {
        const candidate = normalizeUrlCandidate(url, origin);
        const ok = await tryFetch(candidate, `mirror-origin:${origin}`);
        if (ok) break;
      }
    }

    // 5) final attempt: try calling http fallback (in case fetchWithPlaywright always throws)
    if (!fetchResult) {
      try {
        // dynamic import of HTTP fallback fetcher
        const { fetchHTML } = await import("../lib/fetcher").catch(() => ({} as any));
        if (typeof fetchHTML === "function") {
          try {
            const html = await (fetchHTML as any)(url);
            fetchResult = html;
            attempts.push({ attemptUrl: url, success: true, source: "http-fallback", returnedType: "string" });
            finalAttemptUrl = url;
            usedFallbackOrigin = "http-fallback";
          } catch (e: any) {
            attempts.push({ attemptUrl: url, success: false, error: String(e?.message ?? e) });
            lastErrMsg = String(e?.message ?? e);
          }
        }
      } catch {
        // ignore
      }
    }

    // Build rawHtml if available (string or object.html)
    let rawHtml: string | null = null;
    try {
      if (typeof fetchResult === "string") rawHtml = fetchResult;
      else if (fetchResult && typeof fetchResult.html === "string") rawHtml = fetchResult.html;
    } catch {
      rawHtml = null;
    }

    const durationMs = Date.now() - start;

    // Final response — do NOT filter fetchResult; return everything for inspection
    const response: any = {
      title: "Anna Raw Fetch (robust)",
      description: "Raw fetch of provided URL using multiple fallbacks. No filtering applied.",
      sourceUrl: url,
      finalAttemptUrl,
      usedFallbackOrigin,
      attempts,
      fetchResult, // raw value returned by fetchWithPlaywright or http fallback
      rawHtml,
      rawHtmlLength: typeof rawHtml === "string" ? rawHtml.length : 0,
      success: !!fetchResult,
      error: fetchResult ? null : lastErrMsg,
      durationMs,
      timestamp: new Date().toISOString(),
    };

    return response as any;
  },
};