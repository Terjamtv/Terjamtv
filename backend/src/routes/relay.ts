import { Hono } from "hono";
import { Env } from "../lib/supabase";

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

  if (!deviceId && !code) {
    return c.json({ error: "device_id or code query param is required" }, 400);
  }

  let packet = deviceId ? latestSubtitles.get(deviceId.trim()) : null;
  if (!packet && deviceId) {
    packet = latestSubtitles.get(deviceId.trim().toUpperCase());
  }
  if (!packet && code) {
    packet = latestSubtitles.get(code.trim().toUpperCase());
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
