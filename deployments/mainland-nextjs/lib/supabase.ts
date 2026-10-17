import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { requireEnv, publicSupabaseConfig } from './env';

// Browser auth session is carried via same-site cookies. Never authorize using getSession().
export async function userDb() {
  const jar = await cookies();
  const { url, key } = publicSupabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return jar.getAll(); },
      setAll(items) {
        try { items.forEach(({ name, value, options }) => jar.set(name, value, options)); }
        catch { /* Read-only rendering; API route handlers have writable cookies. */ }
      },
    },
  });
}
export function adminDb() {
  const { url } = publicSupabaseConfig();
  return createClient(url, requireEnv('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function currentUser() {
  const db = await userDb();
  const { data, error } = await db.auth.getUser();
  return { db, user: error ? null : data.user };
}
