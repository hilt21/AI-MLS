import { NextRequest, NextResponse } from 'next/server';
import { requestGuard } from '@/lib/http';
import { userDb } from '@/lib/supabase';
export async function POST(req: NextRequest) {
  const guard = requestGuard(req); if (guard) return guard;
  const db = await userDb();
  await db.auth.signOut();
  return NextResponse.json({ ok: true });
}
