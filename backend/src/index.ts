import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env } from "./lib/supabase";
import { translateRoute } from "./routes/translate";
import { pairRoute } from "./routes/pair";
import { adminRoute } from "./routes/admin";
import { relayRoute } from "./routes/relay";
import { voucherRoute } from "./routes/voucher";
import { authRoute } from "./routes/auth";

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for mobile apps, WebOS TV browser engine, and Admin Dashboard
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Admin-Secret"],
  })
);

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "TranslateTV Backend API",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

// Remote web companion endpoint
app.get("/remote", (c) => {
  const code = c.req.query("code") || "";
  const deviceId = c.req.query("device_id") || "";
  
  // Redirect or serve the mobile-web controller
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta http-equiv="refresh" content="0; url=./mobile-web/index.html?code=${encodeURIComponent(code)}&device_id=${encodeURIComponent(deviceId)}" />
      </head>
      <body>Redirecting to remote...</body>
    </html>
  `);
});

// Mount Routes
app.route("/api/translate", translateRoute);
app.route("/api/pair", pairRoute);
app.route("/api/admin", adminRoute);
app.route("/api/relay", relayRoute);
app.route("/api/voucher", voucherRoute);
app.route("/api/auth", authRoute);

// 404 Handler
app.notFound((c) => {
  return c.json({ error: "Route not found" }, 404);
});

// Error Handler
app.onError((err, c) => {
  console.error("Unhandled API error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      details: err.message || String(err),
    },
    500
  );
});

export default app;
