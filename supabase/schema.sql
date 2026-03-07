create table if not exists public.bot_users (
  telegram_id text primary key,
  microsoft jsonb,
  google jsonb,
  water_rule jsonb,
  bot_state jsonb,
  notification_state jsonb,
  last_sync_at timestamptz
);

alter table public.bot_users add column if not exists google jsonb;
alter table public.bot_users add column if not exists bot_state jsonb;
alter table public.bot_users add column if not exists notification_state jsonb;
alter table public.bot_users disable row level security;
