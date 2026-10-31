import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { config, cookieOptions, createSession, Profile, setSessionCookies, TRANSACTION_COOKIE, unseal } from '@/lib/auth';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const settings = config();
  let stage = 'callback';
  const failure = (code: string) => {
    const response = NextResponse.redirect(new URL(`/?error=${code}`, settings.base));
    response.cookies.set(TRANSACTION_COOKIE, '', cookieOptions(0));
    return response;
  };
  try {
    const transaction = await unseal(request.cookies.get(TRANSACTION_COOKIE)?.value || '', 'transaction');
    const state = request.nextUrl.searchParams.get('state') || '';
    if (typeof transaction.state !== 'string' || typeof transaction.verifier !== 'string' ||
      state.length !== transaction.state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(transaction.state))) return failure('state');
    if (request.nextUrl.searchParams.has('error')) return failure('denied');
    const code = request.nextUrl.searchParams.get('code');
    if (!code || !settings.clientSecret) return failure('callback');
    stage = 'token';
    const tokenResponse = await fetch(new URL('/oauth/token', settings.issuer), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: settings.callback,
        client_id: settings.clientId, client_secret: settings.clientSecret, code_verifier: transaction.verifier }),
      cache: 'no-store', signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!tokenResponse.ok) return failure('token');
    const tokens = await tokenResponse.json();
    if (typeof tokens.access_token !== 'string' || tokens.token_type?.toLowerCase() !== 'bearer' ||
      typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) return failure('token');
    stage = 'userinfo';
    const userResponse = await fetch(new URL('/userinfo', settings.issuer), {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: 'no-store',
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!userResponse.ok) return failure('userinfo');
    const profile: Profile = await userResponse.json();
    if (!profile || typeof profile.sub !== 'string') return failure('userinfo');
    stage = 'session';
    const lifetime = Math.min(Math.floor(tokens.expires_in), 8 * 60 * 60);
    const session = await createSession(profile, lifetime);
    const response = NextResponse.redirect(new URL('/', settings.base));
    setSessionCookies(response, session, lifetime);
    response.cookies.set(TRANSACTION_COOKIE, '', cookieOptions(0));
    return response;
  } catch {
    // Never log callback codes, tokens, secrets, or upstream response bodies.
    console.error(`Authentication failed at ${stage}`);
    return failure(stage);
  }
}
