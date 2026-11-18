declare const process: any;
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import app from "./index";

const port = Number(process.env.PORT) || 8787;

// Serve Static Web Apps locally through Hono server
// 1. Landing Page
app.get("/", serveStatic({ root: "../website", path: "index.html" }));
app.use("/website/*", serveStatic({ root: ".." }));

// 2. LG TV Screen view
app.get("/tv", serveStatic({ root: "../tv-webos", path: "index.html" }));
app.use("/tv/*", serveStatic({ root: "../tv-webos", rewriteRequestPath: (p) => p.replace(/^\/tv/, "") }));

// 3. Admin Dashboard
app.get("/admin", serveStatic({ root: "../admin", path: "index.html" }));
app.use("/admin/*", serveStatic({ root: "../admin", rewriteRequestPath: (p) => p.replace(/^\/admin/, "") }));

// 4. Mobile Web Remote
app.get("/remote", serveStatic({ root: "../mobile-web", path: "index.html" }));
app.use("/remote/*", serveStatic({ root: "../mobile-web", rewriteRequestPath: (p) => p.replace(/^\/remote/, "") }));

// 5. SRT Translator Tool
app.get("/srt", serveStatic({ root: "../website", path: "srt-tool.html" }));

console.log(`\n======================================================`);
console.log(`🚀 TranslateTV Server is live!`);
console.log(`🌐 Landing Page: http://localhost:${port}`);
console.log(`📺 TV WebOS Screen: http://localhost:${port}/tv`);
console.log(`📱 Mobile Web Remote: http://localhost:${port}/remote`);
console.log(`🖥️ Admin Dashboard: http://localhost:${port}/admin`);
console.log(`🎬 SRT Translator: http://localhost:${port}/srt`);
console.log(`======================================================\n`);

serve({
  fetch: (req) => {
    // Inject mock bindings if running locally via Node
    const env: any = {
      SUPABASE_URL: process.env.SUPABASE_URL || "",
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      ADMIN_SECRET_KEY: process.env.ADMIN_SECRET_KEY || "translatetv-admin-secret-2026",
    };
    return app.fetch(req, env);
  },
  port: port,
});
