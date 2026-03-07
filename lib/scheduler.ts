import { refreshGoogleToken, replaceGoogleWaterEvents } from "@/lib/google";
import { refreshMicrosoftToken, replaceWaterEvents } from "@/lib/microsoft";
import { listUsers, upsertUser } from "@/lib/storage";
import { GoogleToken, MicrosoftToken } from "@/lib/types";
import { buildWaterEvents } from "@/lib/water";

async function ensureFreshMicrosoftToken(telegramId: string, token: MicrosoftToken) {
  if (token.expiresAt > Date.now()) {
    return token;
  }

  const next = await refreshMicrosoftToken(token);
  await upsertUser(telegramId, (current) => ({ ...current, microsoft: next }));
  return next;
}

async function ensureFreshGoogleToken(telegramId: string, token: GoogleToken) {
  if (token.expiresAt > Date.now()) {
    return token;
  }

  const next = await refreshGoogleToken(token);
  await upsertUser(telegramId, (current) => ({ ...current, google: next }));
  return next;
}

export async function syncAllUsers() {
  const users = await listUsers();
  let syncedUsers = 0;
  let syncedCalendars = 0;
  let skipped = 0;

  for (const user of users) {
    if ((!user.microsoft && !user.google) || !user.waterRule) {
      skipped += 1;
      continue;
    }

    const events = buildWaterEvents(user.waterRule);
    let userSynced = false;

    if (user.microsoft) {
      try {
        const token = await ensureFreshMicrosoftToken(user.telegramId, user.microsoft);
        await replaceWaterEvents(token, events);
        await upsertUser(user.telegramId, (current) => ({
          ...current,
          microsoft: token,
        }));
        userSynced = true;
        syncedCalendars += 1;
      } catch (error) {
        console.error(`Microsoft sync failed for ${user.telegramId}:`, error);
      }
    }

    if (user.google) {
      try {
        const token = await ensureFreshGoogleToken(user.telegramId, user.google);
        await replaceGoogleWaterEvents(token, events);
        await upsertUser(user.telegramId, (current) => ({
          ...current,
          google: token,
        }));
        userSynced = true;
        syncedCalendars += 1;
      } catch (error) {
        console.error(`Google sync failed for ${user.telegramId}:`, error);
      }
    }

    if (userSynced) {
      await upsertUser(user.telegramId, (current) => ({
        ...current,
        lastSyncAt: new Date().toISOString(),
      }));
      syncedUsers += 1;
    }
  }

  return { ok: true, syncedUsers, syncedCalendars, skipped };
}
