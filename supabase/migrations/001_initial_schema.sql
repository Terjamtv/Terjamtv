-- ============================================
-- TranslateTV - Initial Database Schema (Idempotent Safe)
-- Can be run multiple times safely without errors
-- ============================================

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================
-- 1. Users Profile (extends Supabase Auth)
-- ============================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  subscription_tier text not null default 'free',
  subscription_expires_at timestamptz,
  max_devices int not null default 1,
  monthly_minutes_limit int not null default 30,
  monthly_minutes_used int not null default 0,
  usage_reset_at timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure all custom columns exist if profiles table was pre-created by Supabase template
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists subscription_tier text not null default 'free';
alter table public.profiles add column if not exists subscription_expires_at timestamptz;
alter table public.profiles add column if not exists max_devices int not null default 1;
alter table public.profiles add column if not exists monthly_minutes_limit int not null default 30;
alter table public.profiles add column if not exists monthly_minutes_used int not null default 0;
alter table public.profiles add column if not exists usage_reset_at timestamptz not null default (date_trunc('month', now()) + interval '1 month');
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- ============================================
-- 2. Devices (TVs paired via QR)
-- ============================================
create table if not exists public.devices (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade,
  device_name text not null default 'My TV',
  device_type text not null check (device_type in ('android_tv', 'webos')),
  device_model text,
  pairing_code text unique,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ============================================
-- 3. Translation Sessions
-- ============================================
create table if not exists public.translation_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade,
  device_id uuid references public.devices(id) on delete cascade,
  source_lang text not null default 'en',
  target_lang text not null default 'ar',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes_used numeric(8,2) not null default 0,
  translations_count int not null default 0
);

-- ============================================
-- 4. Translation Cache (for performance & cost reduction)
-- ============================================
create table if not exists public.translation_cache (
  id uuid primary key default uuid_generate_v4(),
  source_text text not null,
  source_lang text not null default 'en',
  target_lang text not null default 'ar',
  translated_text text not null,
  created_at timestamptz not null default now()
);

-- Indexes
create unique index if not exists idx_translation_cache_unique
  on public.translation_cache (source_lang, target_lang, md5(source_text));

create index if not exists idx_devices_user_id on public.devices(user_id);
create index if not exists idx_devices_pairing_code on public.devices(pairing_code) where pairing_code is not null;
create index if not exists idx_sessions_user_id on public.translation_sessions(user_id);
create index if not exists idx_sessions_device_id on public.translation_sessions(device_id);
create index if not exists idx_profiles_subscription on public.profiles(subscription_tier);

-- ============================================
-- 5. Helper Functions & Triggers
-- ============================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'User')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- 6. Row Level Security (RLS) Policies
-- ============================================
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.translation_sessions enable row level security;
alter table public.translation_cache enable row level security;

-- Profiles Policies
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile (limited fields)" on public.profiles;
create policy "Users can update own profile (limited fields)"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Devices Policies
drop policy if exists "Users can view own devices" on public.devices;
create policy "Users can view own devices"
  on public.devices for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own devices" on public.devices;
create policy "Users can insert own devices"
  on public.devices for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own devices" on public.devices;
create policy "Users can update own devices"
  on public.devices for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own devices" on public.devices;
create policy "Users can delete own devices"
  on public.devices for delete
  using (auth.uid() = user_id);

-- Translation Sessions Policies
drop policy if exists "Users can view own sessions" on public.translation_sessions;
create policy "Users can view own sessions"
  on public.translation_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own sessions" on public.translation_sessions;
create policy "Users can insert own sessions"
  on public.translation_sessions for insert
  with check (auth.uid() = user_id);

-- Translation Cache Policies
drop policy if exists "Authenticated users can read cache" on public.translation_cache;
create policy "Authenticated users can read cache"
  on public.translation_cache for select
  to authenticated
  using (true);

-- ============================================
-- 7. Subscription Tiers Reference Table
-- ============================================
create table if not exists public.subscription_tiers (
  tier text primary key,
  name_ar text not null,
  name_en text not null,
  price_usd numeric(6,2) not null,
  max_devices int not null,
  monthly_minutes int not null,
  features jsonb not null default '{}'::jsonb
);

insert into public.subscription_tiers (tier, name_ar, name_en, price_usd, max_devices, monthly_minutes, features) values
  ('free',   'مجاني',  'Free',   0,     1,  30,    '{"ocr": true, "audio": false, "all_languages": false}'),
  ('basic',  'أساسي',  'Basic',  5,     2,  600,   '{"ocr": true, "audio": true,  "all_languages": false}'),
  ('pro',    'برو',    'Pro',    12,    5,  99999, '{"ocr": true, "audio": true,  "all_languages": true}'),
  ('family', 'عائلي',  'Family', 20,    99, 99999, '{"ocr": true, "audio": true,  "all_languages": true, "family_accounts": 6}')
on conflict (tier) do nothing;

alter table public.subscription_tiers enable row level security;

drop policy if exists "Anyone can read tiers" on public.subscription_tiers;
create policy "Anyone can read tiers"
  on public.subscription_tiers for select
  using (true);
