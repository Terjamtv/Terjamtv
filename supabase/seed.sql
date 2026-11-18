-- ============================================
-- TranslateTV - Sample Seed Data
-- Run this in Supabase SQL Editor after 001 and 002
-- ============================================

-- 1. Insert Sample Pre-paid Vouchers (Ready to sell/test)
insert into public.vouchers (code, tier, duration_months, batch_name, is_redeemed) values
  ('TRTV-PRO-1M-DEMO01', 'pro', 1, 'دفعة الرياض التجريبية', false),
  ('TRTV-PRO-1M-DEMO02', 'pro', 1, 'دفعة الرياض التجريبية', false),
  ('TRTV-PRO-3M-DEMO03', 'pro', 3, 'دفعة الرياض التجريبية', false),
  ('TRTV-FAM-1M-DEMO04', 'family', 1, 'دفعة عائلية تجريبية', false),
  ('TRTV-BAS-1M-DEMO05', 'basic', 1, 'دفعة أساسية تجريبية', false)
on conflict (code) do nothing;

-- 2. Verify Vouchers
select code, tier, duration_months, batch_name, is_redeemed, created_at from public.vouchers;
