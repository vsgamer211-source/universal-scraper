/**
 * Simple, resilient Playwright fetcher that RETURNS RAW HTML.
 * - Tries full "playwright" first (local/dev). If unavailable or fails, falls back to playwright-core + @sparticuz/chromium.
 * - If both Playwright strategies fail, falls back to HTTP fetcher.
 * - Optional api capture when opts.enableApiCapture === true (returns { html, apiCapture }).
 * - Optional cookie injection via cookies.json in project root or via opts.cookieFilePath.
 * - Optional proxy via opts.proxy or env PLAYWRIGHT_PROXY.
 *
 * This implementation intentionally does NOT perform "protection" checks or filter the returned HTML.
 * It returns whatever the target served (browser-rendered) or what the HTTP fallback returned.
 */

import fs from "fs";
import path from "path";
import type { Browser } from "playwright-core";

// Note: @sparticuz/chromium is used only as a fallback serverless-compatible chromium binary.
// It's safe to import it; if you prefer dynamic import for smaller cold-starts, change accordingly.
import chromium from "@sparticuz/chromium";

type FetchOptions = {
  timeout?: number;
  waitForSelector?: string;
  enableApiCapture?: boolean;
  cookieFilePath?: string;
  proxy?: string;
  blockResources?: boolean; // default true
};

const DEFAULT_TIMEOUT = Number(process.env.PW_NAV_TIMEOUT ?? 30000);

function loadCookieArray(cookieFilePath?: string) {
  const candidate = cookieFilePath ?? process.env.COOKIE_JSON_PATH ?? path.resolve(process.cwd(), "cookies.json");
  try {
    if (!fs.existsSync(candidate)) return null;
    const raw = fs.readFileSync(candidate, "utf-8");
    const json = JSON.parse(raw);
    if (Array.isArray(json)) return json;
  } catch {
    // ignore
  }
  return null;
}

async function httpFallback(url: string): Promise<string> {
  const { fetchHTML } = await import("./fetcher");
  return fetchHTML(url);
}

let browserSingleton: Browser | null = null;

/**
 * ensurePlaywrightBrowser
 * - Try playwright (if installed with downloaded browsers) first.
 * - If that fails (no playwright or missing browsers), fall back to playwright-core + @sparticuz/chromium.
 * - Returns a Browser (never null) or throws.
 */
async function ensurePlaywrightBrowser(
  executablePath?: string,
  proxy?: string
): Promise<Browser> {
  let browser: Browser | null = browserSingleton;

  if (!browser) {
    // First attempt: try top-level "playwright" (developer/local environments that used `npx playwright install`)
    try {
      const pw: any = await import("playwright");
      const launchOpts: any = {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      };

      if (typeof executablePath === "string" && executablePath.length) {
        launchOpts.executablePath = executablePath;
      }

      if (proxy) {
        launchOpts.proxy = { server: proxy };
      }

      // Try launching playwright-managed browser (this will fail if browsers aren't installed)
      try {
        browser = await pw.chromium.launch(launchOpts);
      } catch (err) {
        // swallow and fall through to core+sparticuz fallback below
        browser = null;
      }
    } catch {
      // import failed -> playwright not installed; fall through to fallback
      browser = null;
    }
  }

  if (!browser) {
    // Fallback: use playwright-core + @sparticuz/chromium (serverless-friendly)
    try {
      const pwCore: any = await import("playwright-core");

      // build launch options using sparticuz/chromium metadata
      const resolvedExecPath =
        typeof executablePath === "string" && executablePath.length
          ? executablePath
          : await chromium.executablePath();

      const launchOpts: any = {
  args: chromium.args,
  executablePath: resolvedExecPath,
  headless: true,
};

      if (proxy) {
        launchOpts.proxy = { server: proxy };
      }

      browser = await pwCore.chromium.launch(launchOpts);
    } catch (e) {
      // keep browser === null and error will be thrown below
      browser = null;
    }
  }

  if (!browser) {
    throw new Error("Playwright browser failed to initialize (both playwright and playwright-core fallbacks failed)");
  }

  // persist singleton and return
  browserSingleton = browser;
  return browser;
}

export async function fetchWithPlaywright(url: string, opts: FetchOptions = {}): Promise<string | { html: string; apiCapture: Array<any> }> {
  if (!url) throw new Error("fetchWithPlaywright: missing url");

  const timeout = Number(opts.timeout ?? DEFAULT_TIMEOUT);
  const waitForSelector = opts.waitForSelector;
  const enableApiCapture = !!opts.enableApiCapture;
  const cookieFilePath = opts.cookieFilePath;
  const proxy = opts.proxy ?? process.env.PLAYWRIGHT_PROXY ?? undefined;
  const blockResources = opts.blockResources !== false;

  // Try full playwright (most common / reliable)
  try {
    const browser = await ensurePlaywrightBrowser(process.env.CHROMIUM_PATH, proxy);
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
    });

    // inject cookies if present
    try {
      const cookies = loadCookieArray(cookieFilePath);
      if (cookies && cookies.length) {
        // normalize cookie objects for Playwright
        const normalized = cookies.map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain?.replace(/^\./, "") || new URL(url).hostname,
          path: c.path || "/",
          expires: c.expires ? Number(c.expires) : undefined,
          httpOnly: !!c.httpOnly,
          secure: !!c.secure,
          sameSite: (c.sameSite as any) || "Lax",
        }));
        await context.addCookies(normalized);
      }
    } catch {
      // non-fatal
    }

    const page = await context.newPage();

    // optional resource blocking to speed up page loads (images/fonts/media)
    if (blockResources) {
      try {
        // route may not be supported in some environments; ignore errors
        await page.route("**/*", (route) => {
          const req = route.request();
          const type = req.resourceType();
          if (type === "image" || type === "font" || type === "media") return route.abort();
          return route.continue();
        });
      } catch {
        // ignore
      }
    }

    const apiCapture: Array<any> = [];
    if (enableApiCapture) {
      page.on("response", async (res) => {
        try {
          const req = res.request();
          const reqUrl = req.url();
          if (reqUrl.includes("/api/") || reqUrl.endsWith(".json") || reqUrl.includes("graphql")) {
            try {
              const json = await res.json();
              apiCapture.push({ url: reqUrl, json });
            } catch {
              try {
                const text = await res.text();
                apiCapture.push({ url: reqUrl, text });
              } catch {}
            }
          }
        } catch {
          // ignore capture errors
        }
      });
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout });

    // Always wait for body
    await page.waitForSelector("body", { timeout: 15000 }).catch(() => {});

    // If this is a search page, wait specifically for md5 anchors
    if (url.includes("/search")) {
      await page.waitForSelector("a[href*='/md5/']", { timeout: 15000 }).catch(() => {});
    }

    // small buffer for hydration
    await page.waitForTimeout(1500);

    if (waitForSelector) {
      try {
        await page.waitForSelector(waitForSelector, { timeout: Math.min(timeout, 10000) });
      } catch {
        // optional
      }
    }

    const html = await page.content();

    // close page/context but keep browser singleton for reuse
    try { await page.close(); } catch {}
    try { await context.close(); } catch {}

    return enableApiCapture ? { html, apiCapture } : html;
  } catch (err) {
    // Playwright failed — fallback to HTTP fetcher and return whatever it returns (no filtering).
    try {
      const html = await httpFallback(url);
      return html;
    } catch (httpErr) {
      // bubble original playwright error if HTTP fallback also fails
      throw new Error(`Playwright failed: ${String(err)}; HTTP fallback also failed: ${String(httpErr)}`);
    }
  }
}