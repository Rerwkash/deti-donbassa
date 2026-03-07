import { NextResponse } from "next/server";

import { createSignedState } from "@/lib/crypto";
import { createGoogleAuthUrl } from "@/lib/google";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const telegramId = searchParams.get("telegramId");

  if (!telegramId) {
    return NextResponse.json({ error: "telegramId is required" }, { status: 400 });
  }

  const state = createSignedState({ telegramId });
  return NextResponse.redirect(createGoogleAuthUrl(state));
}
