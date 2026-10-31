import { createHash, randomBytes } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'zhr_session';
export const TRANSACTION_COOKIE = 'zhr_transaction';
export const METADATA_CLAIM = 'https://namespace.zachnology.com/app_metadata';
export const PHONE_CLAIM = 'https://namespace.zachnology.com/user_data/phone';
export type Profile = Record<string, unknown> & { sub: string };
const SESSION_CHUNK_SIZE = 3000;
const SESSION_CHUNKS = 3;
const sessionCookieName = (index: number) => index === 0 ? SESSION_COOKIE : `${SESSION_COOKIE}.${index}`;

export function config() {
  const base = new URL(process.env.APP_BASE_URL || 'http://localhost:3000');
  const issuer = new URL(process.env.AUTH0_ISSUER_BASE_URL || 'https://auth.zachnology.com');
  if (issuer.protocol !== 'https:') throw new Error('Auth0 must use HTTPS.');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('APP_BASE_URL must use HTTPS outside localhost.');
  return {
    base: base.origin, issuer: issuer.origin,
    callback: new URL('/auth/callback', base).href,
    clientId: process.env.AUTH0_CLIENT_ID || '1Mg2hDZa4JXfqeiFcDmh06S6vN1QDWa8',
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    connection: process.env.AUTH0_CONNECTION || 'entra-saml',
    audience: process.env.AUTH0_AUDIENCE || 'https://dev-z52qnw1b1ucq16k0.us.auth0.com/api/v2/',
  };
}
export function isConfigured() {
  return Boolean(process.env.AUTH0_CLIENT_SECRET && (process.env.SESSION_SECRET?.length || 0) >= 64);
}
function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 64) throw new Error('Set SESSION_SECRET to at least 64 random characters.');
  return createHash('sha256').update(secret).digest();
}
export const randomValue = () => randomBytes(32).toString('base64url');
export const challenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
export function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: config().base.startsWith('https:'), sameSite: 'lax' as const, path: '/', maxAge };
}
export async function seal(payload: Record<string, unknown>, seconds: number, audience: string) {
  return new EncryptJWT(payload).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt().setIssuer('zachnologyhr').setAudience(audience).setExpirationTime(`${seconds}s`).encrypt(key());
}
export async function unseal(token: string, audience: string) {
  return (await jwtDecrypt(token, key(), { issuer: 'zachnologyhr', audience, keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] })).payload;
}
export function clearSessionCookies(response: NextResponse) {
  for (let i = 0; i < SESSION_CHUNKS; i++) {
    response.cookies.set(sessionCookieName(i), '', cookieOptions(0));
  }
}
export async function createSession(profile: Profile, lifetime: number) {
  const token = await seal({ profile }, lifetime, 'session');
  if (token.length > SESSION_CHUNK_SIZE * SESSION_CHUNKS) throw new Error('Session profile exceeds cookie capacity');
  return token;
}
export function setSessionCookies(response: NextResponse, token: string, lifetime: number) {
  for (let i = 0; i < SESSION_CHUNKS; i++) {
    const chunk = token.slice(i * SESSION_CHUNK_SIZE, (i + 1) * SESSION_CHUNK_SIZE);
    // Clear leftover chunks when a new profile is smaller than the previous one.
    response.cookies.set(sessionCookieName(i), chunk, cookieOptions(chunk ? lifetime : 0));
  }
}
export async function getProfile(): Promise<Profile | null> {
  const store = await cookies();
  if (!store.get(SESSION_COOKIE)?.value) return null;
  const token = Array.from({ length: SESSION_CHUNKS }, (_, i) => store.get(sessionCookieName(i))?.value || '').join('');
  if (token.length > SESSION_CHUNK_SIZE * SESSION_CHUNKS) return null;
  try {
    const session = await unseal(token, 'session');
    const profile = session.profile as Profile;
    return profile && typeof profile.sub === 'string' ? profile : null;
  } catch { return null; }
}
