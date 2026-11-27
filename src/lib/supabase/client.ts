import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "./env";

interface BrowserClientOptions {
  detectSessionInUrl?: boolean;
  isSingleton?: boolean;
}

export function createClient(options: BrowserClientOptions = {}) {
  const { url, key } = getSupabasePublicEnv();

  return createBrowserClient(url, key, {
    auth: {
      detectSessionInUrl: options.detectSessionInUrl ?? true,
    },
    isSingleton: options.isSingleton ?? true,
  });
}
