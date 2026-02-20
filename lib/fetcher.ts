import axios, { AxiosRequestConfig } from "axios";
import http from "http";
import https from "https";

const DEFAULT_TIMEOUT = 20000;
const MAX_REDIRECTS = 5;
const MAX_RETRIES = 3;

// Shared keep-alive agents (important for performance)
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  rejectUnauthorized: false, // tolerate some TLS misconfigs
});

// Basic protection page detection
function isBlocked(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("ddos-guard") ||
    lower.includes("access denied") ||
    lower.includes("captcha") ||
    lower.includes("verify you are human") ||
    lower.includes("just a moment") ||
    html.length < 2000
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  };
}

export async function fetchHTML(url: string): Promise<string> {
  if (!url) throw new Error("fetchHTML: missing URL");

  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const config: AxiosRequestConfig = {
        url,
        method: "GET",
        timeout: DEFAULT_TIMEOUT,
        maxRedirects: MAX_REDIRECTS,
        httpAgent,
        httpsAgent,
        decompress: true,
        responseType: "text",
        headers: buildHeaders(),
        validateStatus: () => true,
      };

      const response = await axios(config);

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html =
        typeof response.data === "string"
          ? response.data
          : String(response.data);

      if (!html || html.trim().length === 0) {
        throw new Error("Empty response body");
      }

      if (isBlocked(html)) {
        throw new Error("Protection page detected");
      }

      return html;
    } catch (err: any) {
      lastError = err;

      // small exponential backoff
      await sleep(500 * attempt);
    }
  }

  throw new Error(
    `fetchHTML failed after ${MAX_RETRIES} attempts. Last error: ${
      lastError?.message || lastError
    }`
  );
}