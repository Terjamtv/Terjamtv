import { Hono } from "hono";
import { Env, createUserClient, createAdminClient } from "../lib/supabase";

export const authRoute = new Hono<{ Bindings: Env }>();

// In-memory demo store for offline/local execution
interface DemoUser {
  id: string;
  email: string;
  name: string;
  password?: string;
  tier: "free" | "basic" | "pro" | "family";
  plan_type: "شهري" | "سنوي" | "مجاني";
  duration_months: number;
  expires_at: string | null;
  created_at: string;
}

const demoUsers = new Map<string, DemoUser>();

// Pre-seed a default demo user
demoUsers.set("gamer@terjamtv.com", {
  id: "user-demo-gamer",
  email: "gamer@terjamtv.com",
  name: "لاعب البلايستيشن",
  password: "password123",
  tier: "pro",
  plan_type: "سنوي",
  duration_months: 12,
  expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  created_at: new Date().toISOString()
});

function isDemoMode(env: Env): boolean {
  return !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_URL.includes("your-project-id");
}

/**
 * 1. Register a new user account (إنشاء حساب جديد)
 */
authRoute.post("/register", async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
    name?: string;
  }>().catch(() => null);

  if (!body || !body.email || !body.password) {
    return c.json({ error: "البريد الإلكتروني وكلمة المرور مطلوبان" }, 400);
  }

  const email = body.email.trim().toLowerCase();
  const password = body.password.trim();
  const name = body.name?.trim() || email.split("@")[0];

  if (password.length < 6) {
    return c.json({ error: "كلمة المرور يجب أن لا تقل عن 6 خانات" }, 400);
  }

  // Demo mode
  if (isDemoMode(c.env)) {
    if (demoUsers.has(email)) {
      return c.json({ error: "هذا الحساب مسجل بالفعل، يرجى تسجيل الدخول" }, 400);
    }

    const newUser: DemoUser = {
      id: "usr-" + Math.random().toString(36).substring(2, 9),
      email,
      name,
      password,
      tier: "free",
      plan_type: "مجاني",
      duration_months: 0,
      expires_at: null,
      created_at: new Date().toISOString()
    };
    demoUsers.set(email, newUser);

    return c.json({
      success: true,
      message: "تم إنشاء الحساب بنجاح!",
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        tier: newUser.tier,
        plan_type: newUser.plan_type,
        expires_at: newUser.expires_at
      }
    });
  }

  // Supabase Production
  try {
    const adminClient = createAdminClient(c.env);
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name }
    });

    if (authErr) {
      return c.json({ error: authErr.message }, 400);
    }

    const userId = authData.user.id;

    // Create profile
    await adminClient.from("profiles").upsert({
      id: userId,
      email,
      full_name: name,
      subscription_tier: "free",
      created_at: new Date().toISOString()
    });

    return c.json({
      success: true,
      message: "تم إنشاء الحساب بنجاح في السحابة!",
      user: {
        id: userId,
        email,
        name,
        tier: "free",
        plan_type: "مجاني",
        expires_at: null
      }
    });
  } catch (err: any) {
    return c.json({ error: "خطأ في إنشاء الحساب: " + (err.message || err) }, 500);
  }
});

/**
 * 2. Login to existing user account (تسجيل الدخول)
 */
authRoute.post("/login", async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
  }>().catch(() => null);

  if (!body || !body.email || !body.password) {
    return c.json({ error: "يرجى كتابة البريد وكلمة المرور" }, 400);
  }

  const email = body.email.trim().toLowerCase();
  const password = body.password.trim();

  // Demo mode
  if (isDemoMode(c.env)) {
    let user = demoUsers.get(email);
    if (!user) {
      // Auto-create for seamless TV experience
      user = {
        id: "usr-" + Math.random().toString(36).substring(2, 9),
        email,
        name: email.split("@")[0],
        tier: "pro",
        plan_type: "سنوي",
        duration_months: 12,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString()
      };
      demoUsers.set(email, user);
    }

    const daysRemaining = user.expires_at 
      ? Math.max(0, Math.ceil((new Date(user.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;

    return c.json({
      success: true,
      message: "تم تسجيل الدخول بنجاح!",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tier: user.tier,
        plan_type: user.plan_type,
        duration_months: user.duration_months,
        expires_at: user.expires_at,
        days_remaining: daysRemaining
      }
    });
  }

  // Supabase Production
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
    const { data: sessionData, error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInErr || !sessionData.user) {
      return c.json({ error: "البريد أو كلمة المرور غير صحيحة" }, 401);
    }

    const adminClient = createAdminClient(c.env);
    const { data: profile } = await adminClient
      .from("profiles")
      .select("*")
      .eq("id", sessionData.user.id)
      .single();

    const tier = profile?.subscription_tier || "free";
    const expiresAt = profile?.subscription_expires_at || null;
    let daysRemaining = 0;
    let planType: "شهري" | "سنوي" | "مجاني" = "مجاني";

    if (expiresAt) {
      const expDate = new Date(expiresAt);
      daysRemaining = Math.max(0, Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
      planType = daysRemaining > 45 ? "سنوي" : "شهري";
    }

    return c.json({
      success: true,
      message: "تم تسجيل الدخول بنجاح!",
      token: sessionData.session?.access_token,
      user: {
        id: sessionData.user.id,
        email: sessionData.user.email,
        name: profile?.full_name || sessionData.user.user_metadata?.full_name || email.split("@")[0],
        tier,
        plan_type: planType,
        expires_at: expiresAt,
        days_remaining: daysRemaining
      }
    });
  } catch (err: any) {
    return c.json({ error: "خطأ في تسجيل الدخول: " + (err.message || err) }, 500);
  }
});

/**
 * 3. Redeem Voucher Code to activate / renew subscription (تفعيل كود شحن)
 * Identifies if subscription is Monthly (شهري) or Yearly (سنوي)
 */
authRoute.post("/redeem-code", async (c) => {
  const body = await c.req.json<{
    code: string;
    email?: string;
    user_id?: string;
  }>().catch(() => null);

  if (!body || !body.code) {
    return c.json({ error: "يرجى إدخال كود التفعيل" }, 400);
  }

  const inputCode = body.code.trim().toUpperCase();
  const email = body.email?.trim().toLowerCase();

  // Special test codes
  let durationMonths = 1;
  let planType: "شهري" | "سنوي" = "شهري";

  if (inputCode.includes("YEAR") || inputCode.includes("12M") || inputCode.includes("ANNUAL")) {
    durationMonths = 12;
    planType = "سنوي";
  } else if (inputCode.includes("MONTH") || inputCode.includes("1M")) {
    durationMonths = 1;
    planType = "شهري";
  } else {
    // Default to yearly if custom code or 6-digit pin
    durationMonths = 12;
    planType = "سنوي";
  }

  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + durationMonths);
  const daysRemaining = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  // Demo mode
  if (isDemoMode(c.env)) {
    if (email && demoUsers.has(email)) {
      const u = demoUsers.get(email)!;
      u.tier = "pro";
      u.plan_type = planType;
      u.duration_months = durationMonths;
      u.expires_at = expiry.toISOString();
    }

    return c.json({
      success: true,
      tier: "PRO",
      plan_type: planType,
      duration_months: durationMonths,
      expires_at: expiry.toISOString(),
      days_remaining: daysRemaining,
      message: `تهانينا! تم تفعيل الاشتراك ال${planType} (باقة PRO) بنجاح لمدة ${durationMonths} شهر!`
    });
  }

  // Supabase Production
  try {
    const adminClient = createAdminClient(c.env);

    // Look up voucher
    const { data: voucher } = await adminClient
      .from("vouchers")
      .select("*")
      .eq("code", inputCode)
      .single();

    if (voucher) {
      if (voucher.is_redeemed) {
        return c.json({ error: "تم استخدام كود التفعيل هذا مسبقاً!" }, 400);
      }
      durationMonths = voucher.duration_months || 1;
      planType = durationMonths >= 12 ? "سنوي" : "شهري";
      expiry.setTime(Date.now());
      expiry.setMonth(expiry.getMonth() + durationMonths);

      await adminClient.from("vouchers").update({
        is_redeemed: true,
        redeemed_at: new Date().toISOString()
      }).eq("code", inputCode);
    }

    // Update user profile if user_id or email provided
    if (body.user_id) {
      await adminClient.from("profiles").update({
        subscription_tier: "pro",
        subscription_expires_at: expiry.toISOString()
      }).eq("id", body.user_id);
    } else if (email) {
      await adminClient.from("profiles").update({
        subscription_tier: "pro",
        subscription_expires_at: expiry.toISOString()
      }).eq("email", email);
    }

    return c.json({
      success: true,
      tier: "PRO",
      plan_type: planType,
      duration_months: durationMonths,
      expires_at: expiry.toISOString(),
      days_remaining: Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      message: `تهانينا! تم تفعيل الاشتراك ال${planType} (باقة PRO) بنجاح لمدة ${durationMonths} شهر!`
    });
  } catch (err: any) {
    return c.json({ error: "خطأ أثناء تفعيل الكود: " + (err.message || err) }, 500);
  }
});
