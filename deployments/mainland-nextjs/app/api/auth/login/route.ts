import { NextRequest, NextResponse } from 'next/server';
import { LoginSchema } from '@/lib/contracts';
import { requireEnv } from '@/lib/env';
import { requestGuard, bad } from '@/lib/http';
import { userDb } from '@/lib/supabase';
export async function POST(req: NextRequest) {
  const guard = requestGuard(req); if (guard) return guard;
  const parsed = LoginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad('用户名或密码格式无效');
  const { username, password } = parsed.data;
  const db = await userDb();
  const { error } = await db.auth.signInWithPassword({ email: `${username}@${requireEnv('STUDENT_LOGIN_DOMAIN')}`, password });
  if (error) return bad('用户名或密码不正确', 401);
  return NextResponse.json({ ok: true });
}
