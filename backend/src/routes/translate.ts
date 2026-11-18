import { Hono } from "hono";
import { Env, createUserClient, createAdminClient } from "../lib/supabase";
import { toSaudiDialect, SAUDI_SYSTEM_PROMPT } from "../lib/saudi";

export const translateRoute = new Hono<{ Bindings: Env }>();

interface TranslateRequest {
  text: string;
  source_lang?: string;
  target_lang?: string;
  dialect?: "saudi" | "fusha";
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
  const dialect = body.dialect || "saudi"; // Default to Saudi colloquial Arabic
  const deviceId = body.device_id;

  // Demo mode fallback when Supabase URL is placeholder or empty
  const isDemo = !c.env.SUPABASE_URL || c.env.SUPABASE_URL.includes("your-project-id");

  if (isDemo) {
    // Quick translation fallback for instant local testing + Saudi dialect formatting
    try {
      const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${sourceLang}|${targetLang}`);
      const data: any = await response.json();
      let translation = data?.responseData?.translatedText || textToTranslate;
      
      // Convert to natural Saudi dialect
      if (dialect === "saudi") {
        translation = toSaudiDialect(translation);
      }

      return c.json({
        success: true,
        demo_mode: true,
        dialect: dialect,
        translated_text: translation,
        source_lang: sourceLang,
        target_lang: targetLang,
        cached: false
      });
    } catch (_) {
      const fallbackSaudi = toSaudiDialect(textToTranslate);
      return c.json({
        success: true,
        demo_mode: true,
        dialect: dialect,
        translated_text: `[سعودي]: ${fallbackSaudi}`,
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

  // 4. Translate via Cloudflare Workers AI (LLaMA 3.1 Saudi Dialect + M2M100 Fallback)
  try {
    let translatedText = "";

    // Try LLaMA 3.1 on Workers AI for authentic Saudi dialect
    try {
      const llmResponse: any = await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: SAUDI_SYSTEM_PROMPT },
          { role: "user", content: `ترجم هذا النص إلى العامية السعودية الدارجة فقط: "${textToTranslate}"` }
        ],
        max_tokens: 120,
      });
      translatedText = (llmResponse?.response || "").replace(/^["']|["']$/g, "").trim();
    } catch (_) {
      // Fallback to M2M100
      const aiResponse: any = await c.env.AI.run("@cf/meta/m2m100-1.2b", {
        text: textToTranslate,
        source_lang: sourceLang,
        target_lang: targetLang,
      });
      translatedText = aiResponse?.translated_text || "";
    }

    if (!translatedText) {
      return c.json({ error: "Failed to generate translation" }, 502);
    }

    // Apply Saudi colloquial dialect polish
    if (dialect === "saudi") {
      translatedText = toSaudiDialect(translatedText);
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
        } catch (_) { }

        // Update device activity if device_id provided
        if (deviceId) {
          try {
            await adminClient
              .from("devices")
              .update({ last_seen_at: new Date().toISOString() })
              .eq("id", deviceId)
              .eq("user_id", user.id);
          } catch (_) { }
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
