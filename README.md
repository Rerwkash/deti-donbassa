# deti-donbassa

Telegram bot on `Vercel` that:

- connects Microsoft Calendar through OAuth and Graph API;
- connects Google Calendar through OAuth and Google Calendar API;
- configures water supply by buttons;
- syncs water events to both calendars;
- sends reminders on water days and at expected start/end times;
- stores state in `Supabase`.

## Main Flow

1. Open the bot and press `/start`.
2. Use buttons to connect Microsoft and/or Google.
3. Press `Настроить воду`.
4. Choose month with buttons.
5. Send the day number.
6. Choose interval days with buttons.
7. Press `Синхронизировать`.
8. On water day, use `Вода пошла` and `Вода закончилась` so the bot learns approximate times.

## Environment Variables

Copy [`.env.example`](/d:/Дети донбасса/.env.example) to `.env` and fill:

- `APP_URL`
- `APP_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

## Telegram Webhook

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<APP_URL>/api/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

## Microsoft Setup

- Create an Azure app registration.
- Add redirect URI:
  - `<APP_URL>/api/auth/microsoft/callback`
- Add delegated permissions:
  - `User.Read`
  - `Calendars.ReadWrite`

## Google Setup

- Create an OAuth client in Google Cloud for `Web application`.
- Enable `Google Calendar API`.
- Add redirect URI:
  - `<APP_URL>/api/auth/google/callback`

## Supabase Setup

Run SQL from [supabase/schema.sql](/d:/Дети донбасса/supabase/schema.sql) in Supabase SQL Editor.

If you already created the table earlier, run the new migration additions too:

```sql
alter table public.bot_users add column if not exists google jsonb;
alter table public.bot_users add column if not exists bot_state jsonb;
alter table public.bot_users add column if not exists notification_state jsonb;
```

## External Alerts Cron

`Vercel Hobby` cannot run frequent cron jobs, so use an external scheduler such as `cron-job.org`.

Call this URL every 10 minutes:

```text
https://deti-donbassa.vercel.app/api/cron/water-alerts?token=<CRON_SECRET>
```

The external cron only wakes the app up. The bot itself decides whether it should send a message right now.
