import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { handleTelegramUpdate } from "@/lib/telegram-bot";

export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await request.json();
  await handleTelegramUpdate(update);
  return NextResponse.json({ ok: true });
}
