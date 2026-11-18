// Cloudflare Worker configuration
// Using cf CLI (no wrangler.toml needed)

import { defineConfig } from "cloudflare";

export default defineConfig({
  name: "translatetv-api",
  main: "src/index.ts",
  compatibilityDate: "2025-01-01",
  
  ai: {
    binding: "AI",
  },
});
