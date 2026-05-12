import { after, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { handleTelegramUpdate } from "@/lib/telegram-bot";

export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await request.json();
  after(async () => {
    try {
      await handleTelegramUpdate(update);
    } catch (error) {
      console.error("Telegram webhook processing failed", error);
    }
  });

  return NextResponse.json({ ok: true });
}
