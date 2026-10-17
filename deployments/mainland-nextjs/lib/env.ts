export function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`缺少环境变量：${key}`);
  return value;
}
export function publicSupabaseConfig() {
  return {
    url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    key: requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  };
}
