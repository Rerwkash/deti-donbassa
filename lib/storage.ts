import { env } from "@/lib/env";
import { UserRecord } from "@/lib/types";

type UserRow = {
  telegram_id: string;
  microsoft: UserRecord["microsoft"] | null;
  google: UserRecord["google"] | null;
  water_rule: UserRecord["waterRule"] | null;
  bot_state: UserRecord["botState"] | null;
  notification_state: UserRecord["notificationState"] | null;
  last_sync_at: string | null;
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
