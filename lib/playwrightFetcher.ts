// lib/playwrightFetcher.ts
/**
 * Robust Playwright fetcher with safe TypeScript handling and fallbacks.
 *
 * - Prefer serverless chromium (@sparticuz/chromium + playwright-core) when VERCEL is set
 * - Use full playwright in local dev (playwright)
 * - Fallback to HTTP fetch (./fetcher) when no browser binary is available
 *
 * Env:
 * - VERCEL -> treat as serverless environment
 * - CHROMIUM_PATH -> explicit chromium executable path (optional)
 * - DISABLE_PLAYWRIGHT=1 -> force HTTP fallback
 */

import fs from "fs";

const isVercel = !!process.env.VERCEL;
const disablePlaywright = process.env.DISABLE_PLAYWRIGHT === "1";
const DEFAULT_NAV_TIMEOUT = 30_000;

function exists(p?: string): boolean {
  if (!p) return false;
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

async function httpFallback(url: string): Promise<string> {
  const { fetchHTML } = await import("./fetcher");
  return fetchHTML(url);
}

async function launchServerlessChromium(url: string): Promise<string> {
  const spartModuleAny: any = (await import("@sparticuz/chromium")).default ?? (await import("@sparticuz/chromium"));
  const pwcore: any = await import("playwright-core");

  // prefer explicit CHROMIUM_PATH if provided, otherwise ask sparticuz for path
  const exePathCandidate: unknown = process.env.CHROMIUM_PATH ?? (await spartModuleAny.executablePath());
  if (typeof exePathCandidate !== "string") {
    throw new Error("Serverless chromium: executablePath did not return a string.");
  }
  const exePath = exePathCandidate;
  if (!exists(exePath)) {
    throw new Error(`Serverless chromium executable not found at: ${exePath}`);
  }

  const launchArgs: string[] = Array.isArray(spartModuleAny.args) ? spartModuleAny.args : [];

  const browser = await pwcore.chromium.launch({
    args: launchArgs,
    executablePath: exePath,
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: DEFAULT_NAV_TIMEOUT });
    const html = await page.content();
    await page.close();
    return html;
  } finally {
    await browser.close();
  }
}

async function launchFullPlaywright(url: string): Promise<string> {
  const pwAny: any = await import("playwright");
  const browser = await pwAny.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: DEFAULT_NAV_TIMEOUT });
    const html = await page.content();
    await page.close();
    return html;
  } finally {
    await browser.close();
  }
}

export async function fetchWithPlaywright(url: string): Promise<string> {
  if (!url) throw new Error("fetchWithPlaywright: missing url");

  if (disablePlaywright) {
    return httpFallback(url);
  }

  // Prefer serverless chromium on Vercel
  if (isVercel) {
    try {
      return await launchServerlessChromium(url);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn("launchServerlessChromium failed:", err?.message ?? err);
      // fall through to other attempts
    }
  }

  // Try full playwright (local dev)
  try {
    return await launchFullPlaywright(url);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn("launchFullPlaywright failed:", err?.message ?? err);
  }

  // Best-effort attempt using sparticuz + playwright-core even if not on Vercel
  try {
    const spartAvailable: any = await import("@sparticuz/chromium").then(m => (m.default ?? m)).catch(() => null);
    const pwcoreAvailable: any = await import("playwright-core").catch(() => null);
    if (spartAvailable && pwcoreAvailable) {
      try {
        const exePathCandidate: unknown = process.env.CHROMIUM_PATH ?? (await spartAvailable.executablePath());
        if (typeof exePathCandidate === "string" && exists(exePathCandidate)) {
          const exePath = exePathCandidate;
          const args = Array.isArray(spartAvailable.args) ? spartAvailable.args : [];
          const browser = await (pwcoreAvailable as any).chromium.launch({
            args,
            executablePath: exePath,
            headless: true,
          });
          try {
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: "networkidle", timeout: DEFAULT_NAV_TIMEOUT });
            const html = await page.content();
            await page.close();
            return html;
          } finally {
            await browser.close();
          }
        }
      } catch (innerErr: any) {
        // eslint-disable-next-line no-console
        console.warn("playwright-core + sparticuz attempt failed:", innerErr?.message ?? innerErr);
      }
    }
  } catch {
    // ignore and continue to fallback
  }

  // Final fallback to HTTP fetch
  try {
    return await httpFallback(url);
  } catch (err: any) {
    throw new Error(`All attempts to render page failed. Last error: ${err?.message ?? err}`);
  }
}
