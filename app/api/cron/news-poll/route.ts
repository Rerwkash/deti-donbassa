import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { processPublicNews } from "@/lib/news";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (token !== env.CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const result = await processPublicNews();
  return NextResponse.json({ ok: true, ...result });
}
