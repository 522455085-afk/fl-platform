-- ForgottenLand Platform schema (run this in Supabase SQL Editor)
-- Idempotent: safe to re-run.

-- ============================================================
-- profiles: one row per registered user (linked to auth.users)
-- ============================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null,
  email        text not null,
  avatar       text not null default '?',
  avatar_color text not null default '#5865f2',
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone logged-in can read all profiles (needed to display authors)
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select to authenticated using (true);

-- A user can insert/update only their own profile
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- ============================================================
-- messages: chat messages per channel
-- ============================================================
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  channel_id    text not null,
  author_id     uuid not null references auth.users(id) on delete cascade,
  author_name   text not null,
  author_color  text not null default '#5865f2',
  author_avatar text not null default '?',
  content       text not null,
  created_at    timestamptz not null default now()
);

create index if not exists messages_channel_created_idx
  on public.messages (channel_id, created_at desc);

alter table public.messages enable row level security;

-- Anyone authenticated can read all messages
drop policy if exists "messages_select_all" on public.messages;
create policy "messages_select_all" on public.messages
  for select to authenticated using (true);

-- Users can insert messages as themselves
drop policy if exists "messages_insert_self" on public.messages;
create policy "messages_insert_self" on public.messages
  for insert to authenticated with check (auth.uid() = author_id);

-- Users can delete only their own messages
drop policy if exists "messages_delete_self" on public.messages;
create policy "messages_delete_self" on public.messages
  for delete to authenticated using (auth.uid() = author_id);

-- ============================================================
-- trade_listings: marketplace items posted by players
-- ============================================================
create table if not exists public.trade_listings (
  id           uuid primary key default gen_random_uuid(),
  server_id    text not null,
  seller_id    uuid not null references auth.users(id) on delete cascade,
  seller_name  text not null,
  item_name    text not null,
  item_rarity  text not null default 'common',
  item_level   int  not null default 1,
  item_class   text not null default '杂项',
  affixes      text[] not null default '{}',
  price        bigint not null check (price >= 0),
  stock        int not null default 1 check (stock >= 1),
  note         text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '14 days')
);

create index if not exists trade_listings_server_created_idx
  on public.trade_listings (server_id, created_at desc);

alter table public.trade_listings enable row level security;

drop policy if exists "trade_select_all" on public.trade_listings;
create policy "trade_select_all" on public.trade_listings
  for select to authenticated using (true);

drop policy if exists "trade_insert_self" on public.trade_listings;
create policy "trade_insert_self" on public.trade_listings
  for insert to authenticated with check (auth.uid() = seller_id);

drop policy if exists "trade_update_self" on public.trade_listings;
create policy "trade_update_self" on public.trade_listings
  for update to authenticated using (auth.uid() = seller_id);

drop policy if exists "trade_delete_self" on public.trade_listings;
create policy "trade_delete_self" on public.trade_listings
  for delete to authenticated using (auth.uid() = seller_id);

-- ============================================================
-- parties: group-finder rooms
-- ============================================================
create table if not exists public.parties (
  id              uuid primary key default gen_random_uuid(),
  server_id       text not null,
  leader_id       uuid not null references auth.users(id) on delete cascade,
  leader_name     text not null,
  name            text not null,
  map             text not null,
  difficulty      text not null default '普通',
  max_size        int  not null default 5 check (max_size between 2 and 50),
  voice_required  boolean not null default false,
  note            text,
  members         jsonb not null default '[]'::jsonb, -- [{user_id, user_name}]
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '6 hours')
);

create index if not exists parties_server_created_idx
  on public.parties (server_id, created_at desc);

alter table public.parties enable row level security;

drop policy if exists "parties_select_all" on public.parties;
create policy "parties_select_all" on public.parties
  for select to authenticated using (true);

drop policy if exists "parties_insert_self" on public.parties;
create policy "parties_insert_self" on public.parties
  for insert to authenticated with check (auth.uid() = leader_id);

-- Any authenticated user can update parties (so members can join/leave by
-- editing the `members` array). For a stricter setup, split member ops into
-- a separate party_members table.
drop policy if exists "parties_update_any" on public.parties;
create policy "parties_update_any" on public.parties
  for update to authenticated using (true);

drop policy if exists "parties_delete_leader" on public.parties;
create policy "parties_delete_leader" on public.parties
  for delete to authenticated using (auth.uid() = leader_id);

-- ============================================================
-- Realtime: enable broadcast for these tables (idempotent)
-- ============================================================
do $$
declare
  t text;
begin
  for t in select unnest(array['messages', 'trade_listings', 'parties']) loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
