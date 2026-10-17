import { NextRequest, NextResponse } from 'next/server';
export const unauthorized = () => NextResponse.json({ error: '请先登录' }, { status: 401 });
export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
export function validOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  const expected = process.env.APP_ORIGIN || new URL(req.url).origin;
  // Browsers set Origin on fetch mutations. Reject missing Origin for client endpoints.
  return origin === expected;
}
export function requestGuard(req: NextRequest) {
  if (!validOrigin(req)) return bad('请求来源无效', 403);
  return null;
}
