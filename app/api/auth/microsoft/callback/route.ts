import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { exchangeCodeForToken, getMicrosoftProfile } from "@/lib/microsoft";
import { readState } from "@/lib/crypto";
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

  const tokenSet = await exchangeCodeForToken(code, `${env.APP_URL}/api/auth/microsoft/callback`);
  const profile = await getMicrosoftProfile(tokenSet.accessToken);

  await upsertUser(state.telegramId, (current) => ({
    ...current,
    telegramId: state.telegramId,
    microsoft: {
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      expiresAt: tokenSet.expiresAt,
      scope: tokenSet.scope,
      userPrincipalName: profile.userPrincipalName ?? profile.mail ?? "",
      displayName: profile.displayName ?? "",
    },
  }));

  await sendTelegramMessage(
    state.telegramId,
    `Microsoft Calendar подключен.\nАккаунт: ${profile.displayName ?? "Без имени"} (${profile.userPrincipalName ?? profile.mail ?? "неизвестно"})`,
  );

  return new NextResponse(
    "<html><body style=\"font-family: sans-serif; padding: 32px;\"><h1>Microsoft Calendar подключен</h1><p>Можно возвращаться в Telegram.</p></body></html>",
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
