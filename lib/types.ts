export interface ScrapeResult {
  title?: string;
  description?: string;
  images?: string[];
  links?: string[];
  rawHtmlLength: number;
}

export interface Provider {
  name: string;
  match: (url: string) => boolean;
  scrape: (url: string) => Promise<ScrapeResult>;
}
