import { createClient } from "@supabase/supabase-js";

function cleanEnv(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^['"]|['"]$/g, "").trim();
}

const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL);
const anonKey = cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY);
const publishableKey = cleanEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const genericKey = cleanEnv(import.meta.env.VITE_SUPABASE_KEY);
const supabaseKey = anonKey || publishableKey || genericKey;

export const supabaseConfigStatus = {
  hasUrl: Boolean(supabaseUrl),
  hasKey: Boolean(supabaseKey),
  keySource: anonKey
    ? "VITE_SUPABASE_ANON_KEY"
    : publishableKey
      ? "VITE_SUPABASE_PUBLISHABLE_KEY"
      : genericKey
        ? "VITE_SUPABASE_KEY"
        : "",
};

export const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;
