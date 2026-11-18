import { Hono } from "hono";
import { Env, createAdminClient } from "../lib/supabase";

export const relayRoute = new Hono<{ Bindings: Env }>();

// In-memory message store for polling / short-lived events
// Key: device_id, Value: latest subtitle packet
const latestSubtitles = new Map<string, {
  id: string;
  original: string;
  translated: string;
  timestamp: number;
}>();

/**
 * 1. Phone sends new subtitle to be displayed on the TV
 */
relayRoute.post("/subtitle", async (c) => {
  const body = await c.req.json<{
    device_id: string;
    original: string;
    translated: string;
  }>().catch(() => null);

  if (!body || !body.device_id || !body.translated) {
    return c.json({ error: "device_id and translated text are required" }, 400);
  }

  const packet = {
    id: Math.random().toString(36).substring(2),
    original: body.original || "",
    translated: body.translated,
    timestamp: Date.now()
  };

  const key = body.device_id.trim();
  latestSubtitles.set(key, packet);
  latestSubtitles.set(key.toUpperCase(), packet);
  // Also store in demo-tv-device as global fallback so any active TV demo receives it immediately
  latestSubtitles.set("demo-tv-device", packet);

  // Persist to Supabase so ALL Cloudflare edge isolates share this subtitle packet
  if (c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const adminClient = createAdminClient(c.env);
      await adminClient.from("translation_cache").insert([
        {
          source_text: body.original || "",
          source_lang: `RELAY:${key.toUpperCase()}`,
          target_lang: "ar",
          translated_text: body.translated
        },
        {
          source_text: body.original || "",
          source_lang: "RELAY:DEMO-TV-DEVICE",
          target_lang: "ar",
          translated_text: body.translated
        }
      ]);
    } catch (e) {
      console.warn("Relay Supabase write error:", e);
    }
  }

  return c.json({
    success: true,
    packet_id: packet.id
  });
});

/**
 * 2. TV polls or checks for the latest subtitle packet
 */
relayRoute.get("/latest", async (c) => {
  const deviceId = c.req.query("device_id");
  const code = c.req.query("code");
  const lastId = c.req.query("last_id");

  let packet = deviceId ? latestSubtitles.get(deviceId.trim()) : null;
  if (!packet && deviceId) {
    packet = latestSubtitles.get(deviceId.trim().toUpperCase());
  }
  if (!packet && code) {
    packet = latestSubtitles.get(code.trim().toUpperCase());
  }

  // Fallback: Check local demo store
  if (!packet) {
    packet = latestSubtitles.get("demo-tv-device");
  }

  // If not found in isolate RAM, check Supabase translation_cache (shared across all edge isolates!)
  if (!packet && c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const adminClient = createAdminClient(c.env);
      const searchKeys: string[] = ["RELAY:DEMO-TV-DEVICE"];
      if (code) searchKeys.unshift(`RELAY:${code.trim().toUpperCase()}`);
      if (deviceId) searchKeys.unshift(`RELAY:${deviceId.trim().toUpperCase()}`);

      const { data } = await adminClient
        .from("translation_cache")
        .select("id, source_text, translated_text, created_at")
        .in("source_lang", searchKeys)
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const item = data[0];
        packet = {
          id: item.id,
          original: item.source_text,
          translated: item.translated_text,
          timestamp: new Date(item.created_at).getTime()
        };
      }
    } catch (e) {
      console.warn("Relay Supabase read error:", e);
    }
  }

  if (!packet) {
    return c.json({ has_update: false });
  }

  // If TV already has this packet, no update
  if (lastId && packet.id === lastId) {
    return c.json({ has_update: false });
  }

  return c.json({
    has_update: true,
    packet: packet
  });
});
