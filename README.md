# deti-donbassa

Telegram bot for `Vercel` / `Render` that:

- connects Microsoft Calendar through OAuth and Graph API;
- connects Google Calendar through OAuth and Google Calendar API;
- configures water supply by buttons;
- syncs water events to both calendars;
- sends reminders on water days and at expected start/end times;
- watches public Telegram channels by link without a local PC agent;
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
9. Add public Telegram channels with `/news_add https://t.me/channelname`.

## Environment Variables

Copy [`.env.example`](/d:/Дети донбасса/.env.example) to `.env` and fill:

- `APP_URL`
- `APP_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_ENCRYPTION_KEY`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

## Render Deploy

- Push code to a supported Git provider (`GitHub`, `GitLab`, or `Bitbucket`).
- In Render create `New +` -> `Web Service` and connect the repo.
- Use:
  - Build command: `npm ci && npm run build`
  - Start command: `npm run start`
- Add all environment variables from `.env.example`.
- Optionally use [`render.yaml`](/d:/Дети донбасса/render.yaml) as a Blueprint starter.

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
alter table public.bot_users add column if not exists telegram_account jsonb;
alter table public.bot_users add column if not exists bot_state jsonb;
alter table public.bot_users add column if not exists notification_state jsonb;
alter table public.news_sources add column if not exists title text;
alter table public.news_sources add column if not exists last_post_id bigint;
alter table public.news_sources add column if not exists last_checked_at timestamptz;
alter table public.news_sources add column if not exists enabled boolean not null default true;
alter table public.news_sources add column if not exists created_at timestamptz not null default now();
```

## External Alerts Cron

Use an external scheduler such as `cron-job.org` or `Render Cron Jobs`.

Call this URL every 10 minutes:

```text
<APP_URL>/api/cron/water-alerts?token=<CRON_SECRET>
```

The external cron only wakes the app up. The bot itself decides whether it should send a message right now.

## Public Telegram Channels

The bot can track only public channels with usernames.

Commands:

```text
/news_add https://t.me/durov
/news_list
/news_check
/news_remove https://t.me/durov
```

For automatic checks call this URL from your scheduler every 5-10 minutes:

```text
<APP_URL>/api/cron/news-poll?token=<CRON_SECRET>
```

Notes:

- private invite links are not supported in this mode;
- the bot reads public `t.me/s/...` pages, so parsing can break if Telegram changes the page markup;
- when a source is added, existing posts are skipped and only future posts are sent.

## Telegram Account Session Security

When you enable Telegram user-session login through the bot, the session is encrypted before saving to `Supabase`.

- `TELEGRAM_SESSION_ENCRYPTION_KEY` must be set in hosting env (`Vercel` or `Render`);
- the database stores only ciphertext for the Telegram session;
- the app decrypts it only inside the server runtime when it needs to connect to Telegram.
