declare const process: any;
import { serve } from "@hono/node-server";
import app from "./index";

const port = Number(process.env.PORT) || 8787;

console.log(`\n======================================================`);
console.log(`🚀 TranslateTV Backend Local Server running!`);
console.log(`📡 URL: http://localhost:${port}`);
console.log(`📺 TV WebOS View: http://localhost:${port}/tv-webos`);
console.log(`📱 Mobile Web Remote: http://localhost:${port}/remote`);
console.log(`🖥️ Admin Dashboard: http://localhost:${port}/admin`);
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
