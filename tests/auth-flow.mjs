import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { jwtDecrypt } from 'jose';
import { createHash } from 'node:crypto';

const base = 'http://localhost:3101';
const secret = randomBytes(32).toString('hex');
const server = spawn(process.execPath, ['--require', fileURLToPath(new URL('./mock-identity.cjs', import.meta.url)), 'node_modules/next/dist/bin/next', 'start', '-p', '3101', '--hostname', '127.0.0.1'], {
  env: { ...process.env, APP_BASE_URL: base, AUTH0_ISSUER_BASE_URL: 'https://identity.example.test',
    AUTH0_CLIENT_SECRET: 'integration-test-secret', SESSION_SECRET: secret },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', b => { output += b; });
server.stderr.on('data', b => { output += b; });
const request = (route, options = {}) => fetch(base + route, { redirect: 'manual', ...options });
const cookie = (response, name) => response.headers.getSetCookie().find(c => c.startsWith(name + '='))?.split(';')[0];
async function login() {
  const response = await request('/auth/login');
  assert.equal(response.status, 307);
  const url = new URL(response.headers.get('location'));
  assert.equal(url.origin, 'https://identity.example.test');
  assert.equal(url.searchParams.get('redirect_uri'), base + '/auth/callback');
  assert.equal(url.searchParams.get('connection'), 'entra-saml');
  assert.equal(url.searchParams.get('scope'), 'openid profile email');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const transaction = cookie(response, 'zhr_transaction');
  assert.ok(transaction);
  const { payload } = await jwtDecrypt(transaction.slice('zhr_transaction='.length), createHash('sha256').update(secret).digest(), { audience: 'transaction' });
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(payload.verifier).digest('base64url'));
  return { transaction, state: url.searchParams.get('state') };
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try { if ((await request('/')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, output);
  const home = await request('/');
  assert.match(await home.text(), /Log in to ZachnologyHR/);
  assert.match(home.headers.get('cache-control'), /no-store/);
  assert.equal((await request('/auth/callback?code=test&state=forged')).headers.get('location'), base + '/?error=callback');
  const { transaction, state } = await login();
  const forged = await request('/auth/callback?code=test&state=forged', { headers: { Cookie: transaction } });
  assert.equal(forged.headers.get('location'), base + '/?error=state');
  for (const [code, expected] of [['bad', 'token'], ['no-profile', 'userinfo']]) {
    const result = await request(`/auth/callback?code=${code}&state=${state}`, { headers: { Cookie: transaction } });
    assert.equal(result.headers.get('location'), `${base}/?error=${expected}`);
  }
  const callback = await request(`/auth/callback?code=valid&state=${state}`, { headers: { Cookie: transaction } });
  assert.equal(callback.headers.get('location'), base + '/');
  const session = cookie(callback, 'zhr_session');
  assert.ok(session);
  assert.ok(callback.headers.getSetCookie().some(c => c.includes('HttpOnly') && c.startsWith('zhr_session=')));
  const profile = await (await request('/', { headers: { Cookie: session } })).text();
  for (const value of ['Test Employee', 'Engineering', 'TEST-101', '+1 555 0100', 'Not provided', 'Extra property']) assert.ok(profile.includes(value), value);
  assert.ok(!profile.includes('test-access-token'));
  assert.equal((await request('/auth/logout', { method: 'POST', headers: { Origin: 'https://other.test', Cookie: session } })).status, 403);
  const logout = await request('/auth/logout', { method: 'POST', headers: { Origin: base, Cookie: session } });
  assert.equal(logout.status, 303);
  assert.match(await (await request('/', { headers: { Cookie: session } })).text(), /Log in to ZachnologyHR/);
  console.log('PASS: login parameters, PKCE, encrypted transaction, state rejection, token and userinfo errors, profile rendering, protected logout, session invalidation.');
} finally { server.kill(); }
