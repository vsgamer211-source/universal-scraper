import { Provider } from "@/lib/types";
import { parseGeneric } from "@/lib/parser";
import { fetchWithPlaywright } from "@/lib/playwrightFetcher";

export const GenericProvider: Provider = {
  name: "playwright-generic",

  match: () => true,

  scrape: async (url: string) => {
    const result = await fetchWithPlaywright(url);
    const html = typeof result === "string" ? result : result.html;
    return parseGeneric(html);
  },
};