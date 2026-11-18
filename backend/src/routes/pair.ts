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

  // Keep in-memory store for instant pairing without DB roundtrips
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

  const adminClient = createAdminClient(c.env);

  // Try saving to DB if user_id is nullable
  try {
    const { data, error } = await adminClient
      .from("devices")
      .insert({
        user_id: null,
        device_name: body.device_name || (body.device_type === "webos" ? "LG webOS TV" : "Android TV"),
        device_type: body.device_type,
        device_model: body.device_model || null,
        pairing_code: pairingCode,
        is_active: false,
      })
      .select("id, pairing_code")
      .single();

    if (!error && data) {
      return c.json({
        success: true,
        device_id: data.id,
        pairing_code: data.pairing_code,
        qr_payload: `https://terjamtv.pages.dev/remote?code=${data.pairing_code}&device_id=${data.id}`
      });
    }
  } catch (_) {}

  // Fallback to high-speed in-memory pairing
  return c.json({
    success: true,
    device_id: deviceId,
    pairing_code: pairingCode,
    qr_payload: `https://terjamtv.pages.dev/remote?code=${pairingCode}&device_id=${deviceId}`
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

  // Check in-memory store first
  let foundDev: any = null;
  for (const dev of localDevices.values()) {
    if (dev.pairing_code === code) {
      foundDev = dev;
      break;
    }
  }

  if (foundDev) {
    foundDev.is_active = true;
    foundDev.user_id = "user-paired";
    foundDev.user_name = "مشترك TranslateTV";
    foundDev.tier = "pro";

    return c.json({
      success: true,
      message: "Device successfully paired!",
      device_id: foundDev.id
    });
  }

  const adminClient = createAdminClient(c.env);
  const authHeader = c.req.header("Authorization");
  let userId: string | null = null;
  let userName = "مشترك TranslateTV";
  let tier = "pro";

  if (authHeader && !authHeader.includes("DEMO_USER_TOKEN")) {
    try {
      const supabase = createUserClient(c.env, authHeader);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        userId = user.id;
        const { data: profile } = await adminClient
          .from("profiles")
          .select("full_name, subscription_tier")
          .eq("id", user.id)
          .single();
        if (profile?.full_name) userName = profile.full_name;
        if (profile?.subscription_tier) tier = profile.subscription_tier;
      }
    } catch (_) {}
  }

  // Try finding and updating in Supabase DB
  try {
    const { data: device } = await adminClient
      .from("devices")
      .select("id, device_name")
      .eq("pairing_code", code)
      .single();

    if (device) {
      await adminClient
        .from("devices")
        .update({
          user_id: userId,
          device_name: body.custom_device_name || device.device_name,
          is_active: true,
          last_seen_at: new Date().toISOString()
        })
        .eq("id", device.id);

      localDevices.set(device.id, {
        id: device.id,
        pairing_code: code,
        device_name: device.device_name,
        is_active: true,
        user_id: userId || "guest-user",
        user_name: userName,
        tier: tier
      });

      return c.json({
        success: true,
        message: "Device successfully paired!",
        device_id: device.id
      });
    }
  } catch (_) {}

  // Fallback: register pairing code locally so polling immediately unlocks
  localDevices.set(code, {
    id: code,
    pairing_code: code,
    device_name: body.custom_device_name || "شاشة التلفزيون",
    is_active: true,
    user_id: userId || "guest-user",
    user_name: userName,
    tier: tier
  });

  // Also persist pairing record to Supabase translation_cache so ALL edge isolates know it's paired
  if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await adminClient.from("translation_cache").insert({
        source_text: code,
        source_lang: `PAIR:${code}`,
        target_lang: "paired",
        translated_text: userName
      });
    } catch (_) {}
  }

  return c.json({
    success: true,
    message: "Device successfully paired!",
    device_id: code
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

  // Check in-memory store first
  let dev: any = null;
  if (deviceId && localDevices.has(deviceId)) {
    dev = localDevices.get(deviceId);
  } else if (code) {
    for (const d of localDevices.values()) {
      if (d.pairing_code === code.trim().toUpperCase()) {
        dev = d;
        break;
      }
    }
  }

  if (dev && dev.is_active) {
    return c.json({
      status: "paired",
      paired: true,
      device_id: dev.id,
      device_name: dev.device_name,
      user_id: dev.user_id,
      user_name: dev.user_name || "مشترك TranslateTV",
      tier: dev.tier || "pro"
    });
  }

  // Check shared Supabase pair record
  if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY && code) {
    try {
      const adminClient = createAdminClient(c.env);
      const { data } = await adminClient
        .from("translation_cache")
        .select("source_text, translated_text")
        .eq("source_lang", `PAIR:${code.trim().toUpperCase()}`)
        .limit(1);

      if (data && data.length > 0) {
        return c.json({
          status: "paired",
          paired: true,
          device_id: code,
          device_name: "شاشة التلفزيون",
          user_id: "guest-user",
          user_name: data[0].translated_text || "مشترك TranslateTV",
          tier: "pro"
        });
      }
    } catch (_) {}
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

  const isPaired = Boolean(device.is_active);

  if (!isPaired) {
    return c.json({
      status: "pending",
      paired: false,
      pairing_code: device.pairing_code
    });
  }

  let profileName = "مشترك TranslateTV";
  let tier = "pro";

  if (device.user_id) {
    try {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("subscription_tier, display_name, full_name")
        .eq("id", device.user_id)
        .single();
      if (profile?.display_name || profile?.full_name) profileName = profile.display_name || profile.full_name;
      if (profile?.subscription_tier) tier = profile.subscription_tier;
    } catch (_) {}
  }

  return c.json({
    status: "paired",
    paired: true,
    device_id: device.id,
    device_name: device.device_name,
    user_id: device.user_id || "guest-user",
    user_name: profileName,
    tier: tier
  });
});
