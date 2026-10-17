import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/supabase';
export async function GET() {
  const { user } = await currentUser();
  return NextResponse.json({ authenticated: Boolean(user), id: user?.id ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}
