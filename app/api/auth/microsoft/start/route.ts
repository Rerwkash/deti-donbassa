import { NextResponse } from "next/server";

import { createSignedState } from "@/lib/crypto";
import { env } from "@/lib/env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const telegramId = searchParams.get("telegramId");

  if (!telegramId) {
    return NextResponse.json({ error: "telegramId is required" }, { status: 400 });
  }

  const state = createSignedState({ telegramId });
  const redirectUri = `${env.APP_URL}/api/auth/microsoft/callback`;
  const authUrl = new URL(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set("client_id", env.MICROSOFT_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_mode", "query");
  authUrl.searchParams.set("scope", "offline_access User.Read Calendars.ReadWrite");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl);
}
