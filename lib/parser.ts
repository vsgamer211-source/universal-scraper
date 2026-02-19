import * as cheerio from "cheerio";
import { ScrapeResult } from "./types";

export function parseGeneric(html: string): ScrapeResult {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim();

  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content");

  const images = $("img")
    .map((_, el) => $(el).attr("src"))
    .get()
    .filter(Boolean);

  const links = $("a")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter(Boolean);

  return {
    title,
    description,
    images,
    links,
    rawHtmlLength: html.length,
  };
}
