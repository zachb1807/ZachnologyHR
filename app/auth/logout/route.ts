import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies, config, cookieOptions, TRANSACTION_COOKIE } from '@/lib/auth';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const { base } = config();
  // no-referrer can make a browser's same-origin form POST send Origin: null.
  // Fetch Metadata is browser-controlled and also works on deployment aliases.
  const site = request.headers.get('sec-fetch-site');
  const sameOrigin = site === 'same-origin';
  const trustedOrigin = request.headers.get('origin') === base;
  if (!sameOrigin && (site === 'cross-site' || !trustedOrigin)) {
    return new NextResponse('Invalid origin', { status: 403 });
  }
  const response = NextResponse.redirect(new URL('/', base), 303);
  clearSessionCookies(response);
  response.cookies.set(TRANSACTION_COOKIE, '', cookieOptions(0));
  return response;
}
