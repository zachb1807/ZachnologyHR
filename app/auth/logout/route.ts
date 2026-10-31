import { NextRequest, NextResponse } from 'next/server';
import { config, cookieOptions, deleteSession, SESSION_COOKIE, TRANSACTION_COOKIE } from '@/lib/auth';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const { base } = config();
  if (request.headers.get('origin') !== base) return new NextResponse('Invalid origin', { status: 403 });
  await deleteSession(request.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.redirect(new URL('/', base), 303);
  response.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  response.cookies.set(TRANSACTION_COOKIE, '', cookieOptions(0));
  return response;
}
