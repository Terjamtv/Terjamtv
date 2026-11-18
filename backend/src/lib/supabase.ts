import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface Env {
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

/**
 * Create a Supabase client with the user's JWT (for RLS-protected queries)
 */
export function createUserClient(env: Env, authHeader: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: authHeader },
    },
  });
}

/**
 * Create a Supabase admin client (bypasses RLS — for admin/service operations)
 */
export function createAdminClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}
