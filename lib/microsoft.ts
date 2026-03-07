import { env } from "@/lib/env";
import { GraphEventInput, MicrosoftToken } from "@/lib/types";
import { markerTag } from "@/lib/water";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
};

type GraphProfile = {
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
};

async function requestToken(form: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(
    `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
  );

  if (!response.ok) {
    throw new Error(`Microsoft token request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as TokenResponse;
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<MicrosoftToken> {
  const token = await requestToken(
    new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      scope: "offline_access User.Read Calendars.ReadWrite",
    }),
  );

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? "",
    expiresAt: Date.now() + token.expires_in * 1000 - 60_000,
    scope: token.scope,
    userPrincipalName: "",
    displayName: "",
  };
}

export async function refreshMicrosoftToken(token: MicrosoftToken): Promise<MicrosoftToken> {
  const refreshed = await requestToken(
    new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      scope: "offline_access User.Read Calendars.ReadWrite",
    }),
  );

  return {
    ...token,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? token.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000 - 60_000,
    scope: refreshed.scope,
  };
}

export async function getMicrosoftProfile(accessToken: string): Promise<GraphProfile> {
  const response = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Graph /me failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as GraphProfile;
}

export async function replaceWaterEvents(token: MicrosoftToken, events: GraphEventInput[]): Promise<number> {
  const marker = markerTag();
  const startDateTime = new Date().toISOString();
  const endDateTime = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
  const existing = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}`,
    {
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        Prefer: `outlook.timezone="${events[0]?.timezone ?? "Europe/Moscow"}"`,
      },
    },
  );

  if (!existing.ok) {
    throw new Error(`Graph calendarView failed: ${existing.status} ${await existing.text()}`);
  }

  const payload = (await existing.json()) as {
    value?: Array<{ id: string; body?: { content?: string } }>;
  };

  for (const item of payload.value ?? []) {
    if (!item.body?.content?.includes(marker)) {
      continue;
    }

    const remove = await fetch(`https://graph.microsoft.com/v1.0/me/events/${item.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token.accessToken}` },
    });

    if (!remove.ok) {
      throw new Error(`Graph delete event failed: ${remove.status} ${await remove.text()}`);
    }
  }

  for (const event of events) {
    const start = event.allDay
      ? { dateTime: `${event.startDate}T00:00:00`, timeZone: event.timezone }
      : { dateTime: event.startIso, timeZone: event.timezone };
    const end = event.allDay
      ? { dateTime: `${event.endDate}T00:00:00`, timeZone: event.timezone }
      : { dateTime: event.endIso, timeZone: event.timezone };

    const create = await fetch("https://graph.microsoft.com/v1.0/me/events", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject: event.subject,
        body: {
          contentType: "text",
          content: event.content,
        },
        isAllDay: event.allDay ?? false,
        start,
        end,
      }),
    });

    if (!create.ok) {
      throw new Error(`Graph create event failed: ${create.status} ${await create.text()}`);
    }
  }

  return events.length;
}
