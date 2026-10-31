import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies, config, cookieOptions, TRANSACTION_COOKIE } from '@/lib/auth';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const { base } = config();
  if (request.headers.get('origin') !== base) return new NextResponse('Invalid origin', { status: 403 });
  const response = NextResponse.redirect(new URL('/', base), 303);
  clearSessionCookies(response);
  response.cookies.set(TRANSACTION_COOKIE, '', cookieOptions(0));
  return response;
}
