import { env } from "@/lib/env";
import { GoogleToken, GraphEventInput } from "@/lib/types";

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

type GoogleProfile = {
  email?: string;
  name?: string;
};

const GOOGLE_SCOPE = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

const MARKER_KEY = "detiDonbassaWater";
const MARKER_VALUE = "1";

async function requestGoogleToken(form: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

export function createGoogleAuthUrl(state: string): string {
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", `${env.APP_URL}/api/auth/google/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);
  return authUrl.toString();
}

export async function exchangeGoogleCodeForToken(code: string, redirectUri: string): Promise<GoogleToken> {
  const token = await requestGoogleToken(
    new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  );

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? "",
    expiresAt: Date.now() + token.expires_in * 1000 - 60_000,
    scope: token.scope,
    email: "",
    displayName: "",
  };
}

export async function refreshGoogleToken(token: GoogleToken): Promise<GoogleToken> {
  const refreshed = await requestGoogleToken(
    new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: token.refreshToken,
      grant_type: "refresh_token",
    }),
  );

  return {
    ...token,
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + refreshed.expires_in * 1000 - 60_000,
    scope: refreshed.scope,
  };
}

export async function getGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google userinfo failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as GoogleProfile;
}

export async function replaceGoogleWaterEvents(token: GoogleToken, events: GraphEventInput[]): Promise<number> {
  const listUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  listUrl.searchParams.set("singleEvents", "true");
  listUrl.searchParams.set("timeMin", new Date().toISOString());
  listUrl.searchParams.set("timeMax", new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString());
  listUrl.searchParams.set("privateExtendedProperty", `${MARKER_KEY}=${MARKER_VALUE}`);

  const existing = await fetch(listUrl, {
    headers: { authorization: `Bearer ${token.accessToken}` },
  });

  if (!existing.ok) {
    throw new Error(`Google events.list failed: ${existing.status} ${await existing.text()}`);
  }

  const payload = (await existing.json()) as { items?: Array<{ id: string }> };
  for (const item of payload.items ?? []) {
    const remove = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${item.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token.accessToken}` },
    });

    if (!remove.ok) {
      throw new Error(`Google events.delete failed: ${remove.status} ${await remove.text()}`);
    }
  }

  for (const event of events) {
    const start = event.allDay
      ? { date: event.startDate }
      : { dateTime: event.startIso, timeZone: event.timezone };
    const end = event.allDay
      ? { date: event.endDate }
      : { dateTime: event.endIso, timeZone: event.timezone };

    const create = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: event.subject,
        description: event.content,
        start,
        end,
        extendedProperties: {
          private: {
            [MARKER_KEY]: MARKER_VALUE,
          },
        },
      }),
    });

    if (!create.ok) {
      throw new Error(`Google events.insert failed: ${create.status} ${await create.text()}`);
    }
  }

  return events.length;
}
