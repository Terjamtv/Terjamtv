import { Hono } from "hono";
import { Env, createAdminClient } from "../lib/supabase";

export const adminRoute = new Hono<{ Bindings: Env & { ADMIN_SECRET_KEY?: string } }>();

// Simple admin authentication middleware
adminRoute.use("*", async (c, next) => {
  const adminKey = c.req.header("X-Admin-Secret") || c.req.query("admin_key");
  const expectedKey = c.env.ADMIN_SECRET_KEY || "translatetv-admin-secret-2026";

  if (!adminKey || adminKey !== expectedKey) {
    return c.json({ error: "Unauthorized: Invalid admin secret" }, 401);
  }
  await next();
});

// In-memory demo users store
const demoUsers = [
  {
    id: "usr-demo-1",
    display_name: "أحمد محمود (تجريبي)",
    phone: "+966501234567",
    subscription_tier: "pro",
    subscription_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    max_devices: 5,
    monthly_minutes_limit: 99999,
    monthly_minutes_used: 12,
    created_at: new Date().toISOString()
  },
  {
    id: "usr-demo-2",
    display_name: "خالد سعيد (مجاني)",
    phone: "+201012345678",
    subscription_tier: "free",
    subscription_expires_at: null,
    max_devices: 1,
    monthly_minutes_limit: 30,
    monthly_minutes_used: 28,
    created_at: new Date().toISOString()
  }
];

function isDemoMode(env: Env): boolean {
  return !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_URL.includes("your-project-id");
}

/**
 * 1. List users and their subscription statuses
 */
adminRoute.get("/users", async (c) => {
  if (isDemoMode(c.env)) {
    return c.json({
      success: true,
      demo_mode: true,
      total: demoUsers.length,
      users: demoUsers
    });
  }

  const adminClient = createAdminClient(c.env);
  const search = c.req.query("search")?.toLowerCase();

  let query = adminClient
    .from("profiles")
    .select(`
      id,
      display_name,
      phone,
      subscription_tier,
      subscription_expires_at,
      max_devices,
      monthly_minutes_limit,
      monthly_minutes_used,
      created_at
    `)
    .order("created_at", { ascending: false });

  if (search) {
    query = query.or(`display_name.ilike.%${search}%,phone.ilike.%${search}%`);
  }

  const { data: profiles, error } = await query;
  if (error) {
    return c.json({ error: "Failed to fetch users", details: error.message }, 500);
  }

  return c.json({
    success: true,
    total: profiles?.length || 0,
    users: profiles
  });
});

/**
 * 2. Activate or update a user's subscription (Cash payment fulfillment)
 */
adminRoute.post("/users/:id/subscription", async (c) => {
  const userId = c.req.param("id");
  const body = await c.req.json<{
    tier: "free" | "basic" | "pro" | "family";
    duration_months?: number; // 1, 3, 6, 12
    reset_usage?: boolean;
    custom_expiry?: string;
  }>().catch(() => null);

  if (!body || !body.tier) {
    return c.json({ error: "tier is required ('free', 'basic', 'pro', 'family')" }, 400);
  }

  if (isDemoMode(c.env)) {
    const user = demoUsers.find(u => u.id === userId);
    if (user) {
      user.subscription_tier = body.tier;
      user.subscription_expires_at = new Date(Date.now() + (body.duration_months || 1) * 30 * 86400000).toISOString();
      if (body.reset_usage) user.monthly_minutes_used = 0;
      return c.json({
        success: true,
        demo_mode: true,
        message: `Subscription updated to ${body.tier.toUpperCase()} in demo mode`,
        user: user
      });
    }
  }

  const adminClient = createAdminClient(c.env);

  // Determine limits based on tier
  const tierConfig: Record<string, { max_devices: number; minutes_limit: number }> = {
    free: { max_devices: 1, minutes_limit: 30 },
    basic: { max_devices: 2, minutes_limit: 600 },
    pro: { max_devices: 5, minutes_limit: 99999 },
    family: { max_devices: 10, minutes_limit: 99999 }
  };

  const config = tierConfig[body.tier] || tierConfig.free;

  let expiresAt: string | null = null;
  if (body.tier !== "free") {
    if (body.custom_expiry) {
      expiresAt = new Date(body.custom_expiry).toISOString();
    } else {
      const months = body.duration_months || 1;
      const targetDate = new Date();
      targetDate.setMonth(targetDate.getMonth() + months);
      expiresAt = targetDate.toISOString();
    }
  }

  const updatePayload: any = {
    subscription_tier: body.tier,
    subscription_expires_at: expiresAt,
    max_devices: config.max_devices,
    monthly_minutes_limit: config.minutes_limit,
    updated_at: new Date().toISOString()
  };

  if (body.reset_usage) {
    updatePayload.monthly_minutes_used = 0;
  }

  const { data, error } = await adminClient
    .from("profiles")
    .update(updatePayload)
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    return c.json({ error: "Failed to update subscription", details: error.message }, 500);
  }

  return c.json({
    success: true,
    message: `Subscription updated to ${body.tier.toUpperCase()} successfully`,
    user: data
  });
});
