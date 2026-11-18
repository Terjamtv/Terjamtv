-- ============================================
-- TranslateTV - Vouchers & License Keys Schema (Idempotent Safe)
-- Allows selling pre-paid scratch cards / voucher codes in cash
-- ============================================

create table if not exists public.vouchers (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  tier text not null check (tier in ('basic', 'pro', 'family')),
  duration_months int not null default 1 check (duration_months in (1, 3, 6, 12)),
  batch_name text,
  is_redeemed boolean not null default false,
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_vouchers_code on public.vouchers(code);
create index if not exists idx_vouchers_redeemed on public.vouchers(is_redeemed);

-- RLS Policies
alter table public.vouchers enable row level security;

-- Only authenticated users can redeem
drop policy if exists "Users can check unused vouchers" on public.vouchers;
create policy "Users can check unused vouchers"
  on public.vouchers for select
  to authenticated
  using (true);
