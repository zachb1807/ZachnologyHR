import { NextResponse } from 'next/server';
import { challenge, config, cookieOptions, isConfigured, randomValue, seal, TRANSACTION_COOKIE } from '@/lib/auth';
export const runtime = 'nodejs';
export async function GET() {
  const settings = config();
  if (!isConfigured()) return NextResponse.redirect(new URL('/?error=configuration', settings.base));
  const state = randomValue();
  const verifier = randomValue();
  const url = new URL('/authorize', settings.issuer);
  url.search = new URLSearchParams({ response_type: 'code', client_id: settings.clientId,
    redirect_uri: settings.callback, connection: settings.connection, scope: 'openid profile email', prompt: 'consent',
    audience: settings.audience, state, code_challenge: challenge(verifier), code_challenge_method: 'S256' }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set(TRANSACTION_COOKIE, await seal({ state, verifier }, 600, 'transaction'), cookieOptions(600));
  return response;
}
