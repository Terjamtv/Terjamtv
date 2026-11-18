import { Hono } from "hono";
import { Env, createUserClient, createAdminClient } from "../lib/supabase";

export const voucherRoute = new Hono<{ Bindings: Env & { ADMIN_SECRET_KEY?: string } }>();

// In-memory demo store
const demoVouchers = new Map<string, any>();

function isDemoMode(env: Env): boolean {
  return !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_URL.includes("your-project-id");
}

function generateCode(tier: string, months: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `TRTV-${tier.toUpperCase().substring(0, 3)}-${months}M-${random}`;
}

/**
 * 1. Admin generates a batch of pre-paid activation voucher codes
 */
voucherRoute.post("/generate", async (c) => {
  const adminKey = c.req.header("X-Admin-Secret") || c.req.query("admin_key");
  const expectedKey = c.env.ADMIN_SECRET_KEY || "translatetv-admin-secret-2026";

  if (!adminKey || adminKey !== expectedKey) {
    return c.json({ error: "Unauthorized admin" }, 401);
  }

  const body = await c.req.json<{
    tier: "basic" | "pro" | "family";
    duration_months: number;
    count?: number;
    batch_name?: string;
  }>().catch(() => null);

  if (!body || !body.tier || !body.duration_months) {
    return c.json({ error: "tier and duration_months are required" }, 400);
  }

  const count = Math.min(100, Math.max(1, body.count || 1));
  const newVouchers: any[] = [];

  for (let i = 0; i < count; i++) {
    const code = generateCode(body.tier, body.duration_months);
    newVouchers.push({
      code: code,
      tier: body.tier,
      duration_months: body.duration_months,
      batch_name: body.batch_name || "دفعة نقدية عامة",
      is_redeemed: false,
      created_at: new Date().toISOString()
    });
  }

  if (isDemoMode(c.env)) {
    for (const v of newVouchers) {
      demoVouchers.set(v.code, v);
    }
    return c.json({
      success: true,
      demo_mode: true,
      count: newVouchers.length,
      vouchers: newVouchers
    });
  }

  const adminClient = createAdminClient(c.env);
  const { data, error } = await adminClient
    .from("vouchers")
    .insert(newVouchers)
    .select("code, tier, duration_months, batch_name, created_at");

  if (error) {
    return c.json({ error: "Failed to create vouchers", details: error.message }, 500);
  }

  return c.json({
    success: true,
    count: data.length,
    vouchers: data
  });
});

/**
 * 2. User redeems a voucher code to immediately activate their subscription
 */
voucherRoute.post("/redeem", async (c) => {
  const body = await c.req.json<{
    code: string;
    user_id?: string;
  }>().catch(() => null);

  if (!body || !body.code) {
    return c.json({ error: "Voucher code is required" }, 400);
  }

  const inputCode = body.code.trim().toUpperCase();

  // Demo mode redemption
  if (isDemoMode(c.env)) {
    const voucher = demoVouchers.get(inputCode);
    if (!voucher) {
      return c.json({ error: "كود التفعيل غير صحيح أو منتهي" }, 404);
    }
    if (voucher.is_redeemed) {
      return c.json({ error: "تم استخدام كود التفعيل هذا مسبقاً" }, 400);
    }

    voucher.is_redeemed = true;
    voucher.redeemed_at = new Date().toISOString();

    return c.json({
      success: true,
      demo_mode: true,
      message: `تم تفعيل باقة ${voucher.tier.toUpperCase()} بنجاح لمدة ${voucher.duration_months} شهر!`,
      tier: voucher.tier,
      duration_months: voucher.duration_months
    });
  }

  const authHeader = c.req.header("Authorization");
  const adminClient = createAdminClient(c.env);

  let targetUserId = body.user_id;
  if (!targetUserId && authHeader) {
    const supabase = createUserClient(c.env, authHeader);
    const { data: { user } } = await supabase.auth.getUser();
    targetUserId = user?.id;
  }

  if (!targetUserId) {
    return c.json({ error: "User authentication required to redeem code" }, 401);
  }

  // 1. Fetch voucher
  const { data: voucher, error: vError } = await adminClient
    .from("vouchers")
    .select("*")
    .eq("code", inputCode)
    .single();

  if (vError || !voucher) {
    return c.json({ error: "كود التفعيل غير صحيح أو غير موجود" }, 404);
  }

  if (voucher.is_redeemed) {
    return c.json({ error: "تم استخدام هذا الكود من قبل!" }, 400);
  }

  // 2. Calculate subscription expiry
  const tierConfig: Record<string, { max_devices: number; minutes: number }> = {
    basic: { max_devices: 2, minutes: 600 },
    pro: { max_devices: 5, minutes: 99999 },
    family: { max_devices: 10, minutes: 99999 }
  };
  const config = tierConfig[voucher.tier] || tierConfig.basic;

  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + voucher.duration_months);

  // 3. Update User Profile
  const { error: profileError } = await adminClient
    .from("profiles")
    .update({
      subscription_tier: voucher.tier,
      subscription_expires_at: expiry.toISOString(),
      max_devices: config.max_devices,
      monthly_minutes_limit: config.minutes,
      monthly_minutes_used: 0,
      updated_at: new Date().toISOString()
    })
    .eq("id", targetUserId);

  if (profileError) {
    return c.json({ error: "فشل تفعيل الحساب", details: profileError.message }, 500);
  }

  // 4. Mark voucher redeemed
  await adminClient
    .from("vouchers")
    .update({
      is_redeemed: true,
      redeemed_by: targetUserId,
      redeemed_at: new Date().toISOString()
    })
    .eq("id", voucher.id);

  return c.json({
    success: true,
    message: `تهانينا! تم تفعيل باقة ${voucher.tier.toUpperCase()} بنجاح حتى ${expiry.toLocaleDateString('ar-EG')}`,
    tier: voucher.tier,
    expires_at: expiry.toISOString()
  });
});

/**
 * 3. Admin lists all voucher codes
 */
voucherRoute.get("/list", async (c) => {
  const adminKey = c.req.header("X-Admin-Secret") || c.req.query("admin_key");
  const expectedKey = c.env.ADMIN_SECRET_KEY || "translatetv-admin-secret-2026";

  if (!adminKey || adminKey !== expectedKey) {
    return c.json({ error: "Unauthorized admin" }, 401);
  }

  if (isDemoMode(c.env)) {
    return c.json({
      success: true,
      demo_mode: true,
      vouchers: Array.from(demoVouchers.values())
    });
  }

  const adminClient = createAdminClient(c.env);
  const { data, error } = await adminClient
    .from("vouchers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return c.json({ error: "Failed to list vouchers", details: error.message }, 500);
  }

  return c.json({
    success: true,
    vouchers: data
  });
});
