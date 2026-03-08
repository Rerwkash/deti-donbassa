import { env } from "@/lib/env";
import { NewsSourceRecord, UserRecord } from "@/lib/types";

type UserRow = {
  telegram_id: string;
  microsoft: UserRecord["microsoft"] | null;
  google: UserRecord["google"] | null;
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

function fromRow(row: UserRow): UserRecord {
  return {
    telegramId: row.telegram_id,
    microsoft: row.microsoft ?? undefined,
    google: row.google ?? undefined,
    waterRule: row.water_rule ?? undefined,
    botState: row.bot_state ?? undefined,
    notificationState: row.notification_state ?? undefined,
    lastSyncAt: row.last_sync_at ?? undefined,
  };
}

function toRow(user: UserRecord): UserRow {
  return {
    telegram_id: user.telegramId,
    microsoft: user.microsoft ?? null,
    google: user.google ?? null,
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
    `bot_users?select=telegram_id,microsoft,google,water_rule,bot_state,notification_state,last_sync_at&telegram_id=eq.${encodeURIComponent(telegramId)}&limit=1`,
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
    "bot_users?select=telegram_id,microsoft,google,water_rule,bot_state,notification_state,last_sync_at",
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
