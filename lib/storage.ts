import { env } from "@/lib/env";
import { decryptTelegramSession, encryptTelegramSession } from "@/lib/secrets";
import { NewsSourceRecord, UserRecord, WaterIncidentGeocode, WaterIncidentRecord } from "@/lib/types";

type UserRow = {
  telegram_id: string;
  microsoft: UserRecord["microsoft"] | null;
  google: UserRecord["google"] | null;
  telegram_account: UserRecord["telegramAccount"] | null;
  water_rule: UserRecord["waterRule"] | null;
  bot_state: UserRecord["botState"] | null;
  notification_state: UserRecord["notificationState"] | null;
  last_sync_at: string | null;
};

type NewsSourceRow = {
  id: number;
  telegram_id: string;
  url: string;
  channel_slug: string;
  title: string | null;
  last_post_id: number | null;
  last_checked_at: string | null;
  enabled: boolean;
  created_at: string | null;
};

type WaterIncidentRow = {
  id: number;
  telegram_id: string;
  fingerprint: string;
  source_title: string | null;
  source_url: string | null;
  source_channel_slug: string | null;
  external_message_id: string | null;
  raw_text: string;
  excerpt: string | null;
  kind: WaterIncidentRecord["kind"];
  state: WaterIncidentRecord["state"];
  city: string | null;
  street: string | null;
  house: string | null;
  address_text: string | null;
  lat: number | null;
  lon: number | null;
  reported_at: string | null;
  geocoded_at: string | null;
  created_at: string | null;
};

type WaterIncidentGeocodeRow = {
  address_key: string;
  city: string | null;
  address_text: string;
  lat: number | null;
  lon: number | null;
  provider: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function fromRow(row: UserRow): UserRecord {
  const telegramAccount =
    row.telegram_account != null
      ? {
          ...row.telegram_account,
          session: decryptTelegramSession(row.telegram_account.session),
        }
      : undefined;

  return {
    telegramId: row.telegram_id,
    microsoft: row.microsoft ?? undefined,
    google: row.google ?? undefined,
    telegramAccount,
    waterRule: row.water_rule ?? undefined,
    botState: row.bot_state ?? undefined,
    notificationState: row.notification_state ?? undefined,
    lastSyncAt: row.last_sync_at ?? undefined,
  };
}

function toRow(user: UserRecord): UserRow {
  const telegramAccount =
    user.telegramAccount != null
      ? {
          ...user.telegramAccount,
          session: encryptTelegramSession(user.telegramAccount.session),
        }
      : null;

  return {
    telegram_id: user.telegramId,
    microsoft: user.microsoft ?? null,
    google: user.google ?? null,
    telegram_account: telegramAccount,
    water_rule: user.waterRule ?? null,
    bot_state: user.botState ?? null,
    notification_state: user.notificationState ?? null,
    last_sync_at: user.lastSyncAt ?? null,
  };
}

function fromNewsRow(row: NewsSourceRow): NewsSourceRecord {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    url: row.url,
    channelSlug: row.channel_slug,
    title: row.title ?? undefined,
    lastPostId: row.last_post_id ?? undefined,
    lastCheckedAt: row.last_checked_at ?? undefined,
    enabled: row.enabled,
    createdAt: row.created_at ?? undefined,
  };
}

function toNewsRow(source: Omit<NewsSourceRecord, "id">): Omit<NewsSourceRow, "id" | "created_at"> {
  return {
    telegram_id: source.telegramId,
    url: source.url,
    channel_slug: source.channelSlug,
    title: source.title ?? null,
    last_post_id: source.lastPostId ?? null,
    last_checked_at: source.lastCheckedAt ?? null,
    enabled: source.enabled,
  };
}

function fromWaterIncidentRow(row: WaterIncidentRow): WaterIncidentRecord {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    fingerprint: row.fingerprint,
    sourceTitle: row.source_title ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    sourceChannelSlug: row.source_channel_slug ?? undefined,
    externalMessageId: row.external_message_id ?? undefined,
    rawText: row.raw_text,
    excerpt: row.excerpt ?? undefined,
    kind: row.kind,
    state: row.state,
    city: row.city ?? undefined,
    street: row.street ?? undefined,
    house: row.house ?? undefined,
    addressText: row.address_text ?? undefined,
    lat: row.lat ?? undefined,
    lon: row.lon ?? undefined,
    reportedAt: row.reported_at ?? undefined,
    geocodedAt: row.geocoded_at ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}

function toWaterIncidentRow(
  record: Omit<WaterIncidentRecord, "id" | "createdAt">,
): Omit<WaterIncidentRow, "id" | "created_at"> {
  return {
    telegram_id: record.telegramId,
    fingerprint: record.fingerprint,
    source_title: record.sourceTitle ?? null,
    source_url: record.sourceUrl ?? null,
    source_channel_slug: record.sourceChannelSlug ?? null,
    external_message_id: record.externalMessageId ?? null,
    raw_text: record.rawText,
    excerpt: record.excerpt ?? null,
    kind: record.kind,
    state: record.state,
    city: record.city ?? null,
    street: record.street ?? null,
    house: record.house ?? null,
    address_text: record.addressText ?? null,
    lat: record.lat ?? null,
    lon: record.lon ?? null,
    reported_at: record.reportedAt ?? null,
    geocoded_at: record.geocodedAt ?? null,
  };
}

function fromWaterIncidentGeocodeRow(row: WaterIncidentGeocodeRow): WaterIncidentGeocode {
  return {
    addressKey: row.address_key,
    city: row.city ?? undefined,
    addressText: row.address_text,
    lat: row.lat ?? undefined,
    lon: row.lon ?? undefined,
    provider: row.provider ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

function toWaterIncidentGeocodeRow(
  geocode: WaterIncidentGeocode,
): Omit<WaterIncidentGeocodeRow, "created_at" | "updated_at"> {
  return {
    address_key: geocode.addressKey,
    city: geocode.city ?? null,
    address_text: geocode.addressText,
    lat: geocode.lat ?? null,
    lon: geocode.lon ?? null,
    provider: geocode.provider ?? null,
  };
}

async function supabaseRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getUser(telegramId: string): Promise<UserRecord | null> {
  const rows = await supabaseRequest<UserRow[]>(
    `bot_users?select=telegram_id,microsoft,google,telegram_account,water_rule,bot_state,notification_state,last_sync_at&telegram_id=eq.${encodeURIComponent(telegramId)}&limit=1`,
    {
      headers: {
        Prefer: "return=representation",
      },
    },
  );

  return rows[0] ? fromRow(rows[0]) : null;
}

export async function listUsers(): Promise<UserRecord[]> {
  const rows = await supabaseRequest<UserRow[]>(
    "bot_users?select=telegram_id,microsoft,google,telegram_account,water_rule,bot_state,notification_state,last_sync_at",
  );
  return rows.map(fromRow);
}

export async function upsertUser(
  telegramId: string,
  updater: (current: UserRecord) => UserRecord,
): Promise<UserRecord> {
  const current = (await getUser(telegramId)) ?? { telegramId };
  const next = updater(current);
  const rows = await supabaseRequest<UserRow[]>("bot_users?on_conflict=telegram_id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(toRow(next)),
  });
  return rows[0] ? fromRow(rows[0]) : next;
}

export async function listNewsSources(telegramId: string): Promise<NewsSourceRecord[]> {
  const rows = await supabaseRequest<NewsSourceRow[]>(
    `news_sources?select=id,telegram_id,url,channel_slug,title,last_post_id,last_checked_at,enabled,created_at&telegram_id=eq.${encodeURIComponent(telegramId)}&order=channel_slug.asc`,
  );
  return rows.map(fromNewsRow);
}

export async function listActiveNewsSources(telegramId?: string): Promise<NewsSourceRecord[]> {
  const filter = telegramId ? `&telegram_id=eq.${encodeURIComponent(telegramId)}` : "";
  const rows = await supabaseRequest<NewsSourceRow[]>(
    `news_sources?select=id,telegram_id,url,channel_slug,title,last_post_id,last_checked_at,enabled,created_at&enabled=is.true${filter}&order=id.asc`,
  );
  return rows.map(fromNewsRow);
}

export async function upsertNewsSource(
  source: Omit<NewsSourceRecord, "id" | "createdAt">,
): Promise<NewsSourceRecord> {
  const rows = await supabaseRequest<NewsSourceRow[]>("news_sources?on_conflict=telegram_id,channel_slug", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(toNewsRow(source)),
  });

  return fromNewsRow(rows[0]);
}

export async function updateNewsSource(
  id: number,
  patch: Partial<Omit<NewsSourceRecord, "id" | "telegramId" | "channelSlug" | "createdAt">>,
): Promise<NewsSourceRecord | null> {
  const body: Partial<NewsSourceRow> = {};

  if (patch.url !== undefined) body.url = patch.url;
  if (patch.title !== undefined) body.title = patch.title ?? null;
  if (patch.lastPostId !== undefined) body.last_post_id = patch.lastPostId ?? null;
  if (patch.lastCheckedAt !== undefined) body.last_checked_at = patch.lastCheckedAt ?? null;
  if (patch.enabled !== undefined) body.enabled = patch.enabled;

  const rows = await supabaseRequest<NewsSourceRow[]>(
    `news_sources?id=eq.${id}&select=id,telegram_id,url,channel_slug,title,last_post_id,last_checked_at,enabled,created_at`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    },
  );

  return rows[0] ? fromNewsRow(rows[0]) : null;
}

export async function removeNewsSource(telegramId: string, channelSlug: string): Promise<boolean> {
  await supabaseRequest(
    `news_sources?telegram_id=eq.${encodeURIComponent(telegramId)}&channel_slug=eq.${encodeURIComponent(channelSlug)}`,
    {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    },
  );
  return true;
}

export async function upsertWaterIncident(
  incident: Omit<WaterIncidentRecord, "id" | "createdAt">,
): Promise<WaterIncidentRecord> {
  const rows = await supabaseRequest<WaterIncidentRow[]>("water_incidents?on_conflict=fingerprint", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(toWaterIncidentRow(incident)),
  });

  return fromWaterIncidentRow(rows[0]);
}

export async function listWaterIncidents(telegramId?: string, limit = 200): Promise<WaterIncidentRecord[]> {
  const filter = telegramId ? `&telegram_id=eq.${encodeURIComponent(telegramId)}` : "";
  const rows = await supabaseRequest<WaterIncidentRow[]>(
    `water_incidents?select=id,telegram_id,fingerprint,source_title,source_url,source_channel_slug,external_message_id,raw_text,excerpt,kind,state,city,street,house,address_text,lat,lon,reported_at,geocoded_at,created_at${filter}&order=reported_at.desc.nullslast,created_at.desc&limit=${limit}`,
  );
  return rows.map(fromWaterIncidentRow);
}

export async function getWaterIncidentGeocode(addressKey: string): Promise<WaterIncidentGeocode | null> {
  const rows = await supabaseRequest<WaterIncidentGeocodeRow[]>(
    `water_incident_geocodes?select=address_key,city,address_text,lat,lon,provider,created_at,updated_at&address_key=eq.${encodeURIComponent(addressKey)}&limit=1`,
  );

  return rows[0] ? fromWaterIncidentGeocodeRow(rows[0]) : null;
}

export async function upsertWaterIncidentGeocode(geocode: WaterIncidentGeocode): Promise<WaterIncidentGeocode> {
  const rows = await supabaseRequest<WaterIncidentGeocodeRow[]>("water_incident_geocodes?on_conflict=address_key", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(toWaterIncidentGeocodeRow(geocode)),
  });

  return fromWaterIncidentGeocodeRow(rows[0]);
}
