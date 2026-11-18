import { Hono } from "hono";
import { Env, createUserClient, createAdminClient } from "../lib/supabase";

export const translateRoute = new Hono<{ Bindings: Env }>();

interface TranslateRequest {
  text: string;
  source_lang?: string;
  target_lang?: string;
  device_id?: string;
}

translateRoute.post("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  const body = await c.req.json<TranslateRequest>().catch(() => null);
  if (!body || !body.text || !body.text.trim()) {
    return c.json({ error: "Text is required" }, 400);
  }

  const textToTranslate = body.text.trim();
  const sourceLang = body.source_lang || "en";
  const targetLang = body.target_lang || "ar";
  const deviceId = body.device_id;

  // Demo mode fallback when Supabase URL is placeholder or empty
  const isDemo = !c.env.SUPABASE_URL || c.env.SUPABASE_URL.includes("your-project-id");

  if (isDemo) {
    // Quick translation fallback for instant local testing
    try {
      const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${sourceLang}|${targetLang}`);
      const data: any = await response.json();
      const translation = data?.responseData?.translatedText || `[مترجم]: ${textToTranslate}`;
      return c.json({
        success: true,
        demo_mode: true,
        translated_text: translation,
        source_lang: sourceLang,
        target_lang: targetLang,
        cached: false
      });
    } catch (_) {
      return c.json({
        success: true,
        demo_mode: true,
        translated_text: `[ترجمة تجريبية]: ${textToTranslate}`,
        source_lang: sourceLang,
        target_lang: targetLang,
        cached: false
      });
    }
  }

  const supabase = createUserClient(c.env, authHeader);
  const adminClient = createAdminClient(c.env);

  // 1. Get user details from JWT
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  // 2. Fetch user profile & quota status
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return c.json({ error: "User profile not found" }, 404);
  }

  // Check subscription validity
  const now = new Date();
  const isExpired = profile.subscription_expires_at && new Date(profile.subscription_expires_at) < now;
  const isPaidTier = ["basic", "pro", "family"].includes(profile.subscription_tier);

  // If paid tier expired, fallback to free logic
  const effectiveTier = isPaidTier && !isExpired ? profile.subscription_tier : "free";

  // Check quota for free/limited accounts
  if (effectiveTier === "free") {
    if (profile.monthly_minutes_used >= profile.monthly_minutes_limit) {
      return c.json({
        error: "Monthly quota exceeded. Please upgrade your subscription to continue.",
        quota_exceeded: true,
        minutes_used: profile.monthly_minutes_used,
        limit: profile.monthly_minutes_limit
      }, 403);
    }
  }

  // 3. Check translation cache (MD5 or raw text match)
  const { data: cached } = await adminClient
    .from("translation_cache")
    .select("translated_text")
    .eq("source_lang", sourceLang)
    .eq("target_lang", targetLang)
    .eq("source_text", textToTranslate)
    .maybeSingle();

  if (cached && cached.translated_text) {
    return c.json({
      success: true,
      translated_text: cached.translated_text,
      source_lang: sourceLang,
      target_lang: targetLang,
      cached: true,
    });
  }

  // 4. Translate via Cloudflare Workers AI (Meta M2M100)
  try {
    const aiResponse: any = await c.env.AI.run("@cf/meta/m2m100-1.2b", {
      text: textToTranslate,
      source_lang: sourceLang,
      target_lang: targetLang,
    });

    const translatedText = aiResponse?.translated_text || "";

    if (!translatedText) {
      return c.json({ error: "Failed to generate translation" }, 502);
    }

    // 5. Store in translation cache asynchronously
    c.executionCtx.waitUntil(
      (async () => {
        try {
          await adminClient.from("translation_cache").insert({
            source_text: textToTranslate,
            source_lang: sourceLang,
            target_lang: targetLang,
            translated_text: translatedText,
          });
        } catch (_) {}

        // Update device activity if device_id provided
        if (deviceId) {
          try {
            await adminClient
              .from("devices")
              .update({ last_seen_at: new Date().toISOString() })
              .eq("id", deviceId)
              .eq("user_id", user.id);
          } catch (_) {}
        }
      })()
    );

    return c.json({
      success: true,
      translated_text: translatedText,
      source_lang: sourceLang,
      target_lang: targetLang,
      cached: false,
    });
  } catch (err: any) {
    return c.json({
      error: "AI Translation Service error",
      details: err?.message || String(err)
    }, 500);
  }
});
