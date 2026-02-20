import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/registry";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json(
      { error: "Missing URL parameter" },
      { status: 400 }
    );
  }

  try {
    const provider = getProvider(url);
    const data = await provider.scrape(url);

    return NextResponse.json({
      provider: provider.name,
      data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Scraping failed" },
      { status: 500 }
    );
  }
}
