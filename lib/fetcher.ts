import axios from "axios";

export async function fetchHTML(url: string): Promise<string> {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1"
    },
    validateStatus: () => true
  });

  if (response.status >= 400) {
    throw new Error(`Target returned status ${response.status}`);
  }

  return response.data;
}
