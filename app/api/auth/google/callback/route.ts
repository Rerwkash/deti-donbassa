import { NextResponse } from "next/server";

import { readState } from "@/lib/crypto";
import { env } from "@/lib/env";
import { exchangeGoogleCodeForToken, getGoogleProfile } from "@/lib/google";
import { upsertUser } from "@/lib/storage";
import { sendTelegramMessage } from "@/lib/telegram";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");

  if (!code || !stateParam) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const state = readState(stateParam);
  if (!state) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  const tokenSet = await exchangeGoogleCodeForToken(code, `${env.APP_URL}/api/auth/google/callback`);
  const profile = await getGoogleProfile(tokenSet.accessToken);

  await upsertUser(state.telegramId, (current) => ({
    ...current,
    telegramId: state.telegramId,
    google: {
      ...tokenSet,
      email: profile.email ?? "",
      displayName: profile.name ?? "",
    },
  }));

  await sendTelegramMessage(
    state.telegramId,
    `Google Calendar подключен.\nАккаунт: ${profile.name ?? "Без имени"} (${profile.email ?? "неизвестно"})`,
  );

  return new NextResponse(
    "<html><body style=\"font-family: sans-serif; padding: 32px;\"><h1>Google Calendar подключен</h1><p>Можно возвращаться в Telegram.</p></body></html>",
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
