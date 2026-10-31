import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'zhr_session';
export const TRANSACTION_COOKIE = 'zhr_transaction';
export const METADATA_CLAIM = 'https://namespace.zachnology.com/app_metadata';
export const PHONE_CLAIM = 'https://namespace.zachnology.com/user_data/phone';
export type Profile = Record<string, unknown> & { sub: string };
const sessionDirectory = path.join(process.cwd(), '.data', 'sessions');

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
function sessionPath(id: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error('Invalid session');
  return path.join(sessionDirectory, createHash('sha256').update(id).digest('hex'));
}
export async function deleteSession(id?: string) {
  if (!id) return;
  try { await unlink(sessionPath(id)); } catch { /* Already expired or removed. */ }
}
export async function createSession(profile: Profile, lifetime: number) {
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  // Expired profile files are removed on subsequent sign-ins.
  for (const file of await readdir(sessionDirectory)) {
    if (!/^[a-f0-9]{64}$/.test(file)) continue;
    try { await unseal(await readFile(path.join(sessionDirectory, file), 'utf8'), 'session'); }
    catch { await unlink(path.join(sessionDirectory, file)).catch(() => {}); }
  }
  const id = randomValue();
  await writeFile(sessionPath(id), await seal({ profile }, lifetime, 'session'), { mode: 0o600, flag: 'wx' });
  return id;
}
export async function getProfile(): Promise<Profile | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  try {
    const session = await unseal(await readFile(sessionPath(id), 'utf8'), 'session');
    const profile = session.profile as Profile;
    return profile && typeof profile.sub === 'string' ? profile : null;
  } catch { await deleteSession(id); return null; }
}
