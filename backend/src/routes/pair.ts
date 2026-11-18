import { Hono } from "hono";
import { Env, createUserClient, createAdminClient } from "../lib/supabase";

export const pairRoute = new Hono<{ Bindings: Env }>();

// Helper to generate a human-friendly pairing code
function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// In-memory fallback for local testing when Supabase keys are not set
const localDevices = new Map<string, any>();

function isLocalDemoMode(env: Env): boolean {
  return !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_URL.includes("your-project-id");
}

/**
 * 1. TV calls this on startup to get a pairing code and QR payload
 */
pairRoute.post("/init", async (c) => {
  const body = await c.req.json<{
    device_type: "android_tv" | "webos";
    device_name?: string;
    device_model?: string;
  }>().catch(() => null);

  if (!body || !body.device_type) {
    return c.json({ error: "device_type ('android_tv' or 'webos') is required" }, 400);
  }

  const pairingCode = generatePairingCode();
  const deviceId = "dev-" + Math.random().toString(36).substring(2, 10);

  // If local demo mode, save to in-memory store
  if (isLocalDemoMode(c.env)) {
    localDevices.set(deviceId, {
      id: deviceId,
      pairing_code: pairingCode,
      device_name: body.device_name || (body.device_type === "webos" ? "LG webOS Smart TV" : "Android TV"),
      device_type: body.device_type,
      is_active: false,
      user_id: null,
      user_name: null,
      tier: "free"
    });

    return c.json({
      success: true,
      demo_mode: true,
      device_id: deviceId,
      pairing_code: pairingCode,
      qr_payload: `https://terjamtv.pages.dev/remote?code=${pairingCode}&device_id=${deviceId}`
    });
  }

  const adminClient = createAdminClient(c.env);

  // Create an unassigned device entry with pairing_code
  const { data, error } = await adminClient
    .from("devices")
    .insert({
      user_id: "00000000-0000-0000-0000-000000000000",
      device_name: body.device_name || (body.device_type === "webos" ? "LG webOS TV" : "Android TV"),
      device_type: body.device_type,
      device_model: body.device_model || null,
      pairing_code: pairingCode,
      is_active: false,
    })
    .select("id, pairing_code")
    .single();

  if (error) {
    return c.json({ error: "Failed to generate pairing code", details: error.message }, 500);
  }

  return c.json({
    success: true,
    device_id: data.id,
    pairing_code: data.pairing_code,
    qr_payload: `https://terjamtv.pages.dev/remote?code=${data.pairing_code}&device_id=${data.id}`
  });
});

/**
 * 2. Mobile app scans QR code and claims the TV
 */
pairRoute.post("/claim", async (c) => {
  const body = await c.req.json<{
    pairing_code: string;
    custom_device_name?: string;
  }>().catch(() => null);

  if (!body || !body.pairing_code) {
    return c.json({ error: "pairing_code is required" }, 400);
  }

  const code = body.pairing_code.trim().toUpperCase();

  // Local demo mode handling
  if (isLocalDemoMode(c.env)) {
    let foundDev: any = null;
    for (const dev of localDevices.values()) {
      if (dev.pairing_code === code) {
        foundDev = dev;
        break;
      }
    }

    if (!foundDev) {
      return c.json({ error: "Invalid or expired pairing code" }, 404);
    }

    foundDev.is_active = true;
    foundDev.user_id = "demo-user-123";
    foundDev.user_name = "المشترك التجريبي (Demo User)";
    foundDev.tier = "pro";

    return c.json({
      success: true,
      demo_mode: true,
      message: "Device successfully paired in Demo mode!",
      device_id: foundDev.id
    });
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json({ error: "Authorization header required" }, 401);
  }

  const supabase = createUserClient(c.env, authHeader);
  const adminClient = createAdminClient(c.env);

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return c.json({ error: "Unauthorized user" }, 401);
  }

  const { data: profile } = await adminClient
    .from("profiles")
    .select("subscription_tier, max_devices")
    .eq("id", user.id)
    .single();

  const maxAllowed = profile?.max_devices || 1;

  const { count: currentDevicesCount } = await adminClient
    .from("devices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_active", true);

  if ((currentDevicesCount || 0) >= maxAllowed) {
    return c.json({
      error: `Device limit reached (${currentDevicesCount}/${maxAllowed}). Please upgrade your tier.`,
      limit_reached: true
    }, 403);
  }

  const { data: device, error: devError } = await adminClient
    .from("devices")
    .select("id, device_name")
    .eq("pairing_code", code)
    .single();

  if (devError || !device) {
    return c.json({ error: "Invalid or expired pairing code" }, 404);
  }

  const { error: updateError } = await adminClient
    .from("devices")
    .update({
      user_id: user.id,
      device_name: body.custom_device_name || device.device_name,
      is_active: true,
      last_seen_at: new Date().toISOString()
    })
    .eq("id", device.id);

  if (updateError) {
    return c.json({ error: "Failed to pair device", details: updateError.message }, 500);
  }

  return c.json({
    success: true,
    message: "Device successfully paired to your account!",
    device_id: device.id
  });
});

/**
 * 3. TV polls to check if user has claimed it
 */
pairRoute.get("/status", async (c) => {
  const code = c.req.query("code");
  const deviceId = c.req.query("device_id");

  if (!code && !deviceId) {
    return c.json({ error: "code or device_id query param is required" }, 400);
  }

  // Local demo mode handling
  if (isLocalDemoMode(c.env)) {
    let dev: any = null;
    if (deviceId) {
      dev = localDevices.get(deviceId);
    } else if (code) {
      for (const d of localDevices.values()) {
        if (d.pairing_code === code.trim().toUpperCase()) {
          dev = d;
          break;
        }
      }
    }

    if (!dev) {
      return c.json({ error: "Device not found" }, 404);
    }

    if (!dev.is_active) {
      return c.json({
        status: "pending",
        paired: false,
        pairing_code: dev.pairing_code
      });
    }

    return c.json({
      status: "paired",
      paired: true,
      device_id: dev.id,
      device_name: dev.device_name,
      user_id: dev.user_id,
      user_name: dev.user_name || "مستخدم تجريبي",
      tier: dev.tier || "pro"
    });
  }

  const adminClient = createAdminClient(c.env);
  let query = adminClient.from("devices").select("id, user_id, is_active, device_name, pairing_code");

  if (deviceId) {
    query = query.eq("id", deviceId);
  } else if (code) {
    query = query.eq("pairing_code", code.trim().toUpperCase());
  }

  const { data: device, error } = await query.single();

  if (error || !device) {
    return c.json({ error: "Device not found" }, 404);
  }

  const isPaired = device.is_active && device.user_id !== "00000000-0000-0000-0000-000000000000";

  if (!isPaired) {
    return c.json({
      status: "pending",
      paired: false,
      pairing_code: device.pairing_code
    });
  }

  const { data: profile } = await adminClient
    .from("profiles")
    .select("subscription_tier, display_name")
    .eq("id", device.user_id)
    .single();

  return c.json({
    status: "paired",
    paired: true,
    device_id: device.id,
    device_name: device.device_name,
    user_id: device.user_id,
    user_name: profile?.display_name || "User",
    tier: profile?.subscription_tier || "free"
  });
});
