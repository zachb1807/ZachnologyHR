import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { createHash } from 'node:crypto';

const base = 'http://localhost:3101';
const secret = randomBytes(32).toString('hex');
const startServer = (port) => spawn(process.execPath, ['--require', fileURLToPath(new URL('./mock-identity.cjs', import.meta.url)), 'node_modules/next/dist/bin/next', 'start', '-p', String(port), '--hostname', '127.0.0.1'], {
  env: { ...process.env, APP_BASE_URL: base, AUTH0_ISSUER_BASE_URL: 'https://identity.example.test',
    AUTH0_CLIENT_SECRET: 'integration-test-secret', SESSION_SECRET: secret },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const server = startServer(3101);
let secondServer;
let output = '';
server.stdout.on('data', b => { output += b; });
server.stderr.on('data', b => { output += b; });
const request = (route, options = {}) => fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
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
  const sessionCookies = callback.headers.getSetCookie().filter(c => /^zhr_session(?:\.\d+)?=/.test(c) && !c.includes('Max-Age=0')).map(c => c.split(';')[0]);
  assert.ok(sessionCookies.length > 1, 'Large profile should use multiple cookie chunks');
  const session = sessionCookies.join('; ');
  assert.ok(session);
  assert.ok(callback.headers.getSetCookie().some(c => c.includes('HttpOnly') && c.startsWith('zhr_session=')));
  const profile = await (await request('/', { headers: { Cookie: session } })).text();
  for (const value of ['Test Employee', 'Engineering', 'TEST-101', '+1 555 0100', 'Not provided', 'Extra property']) assert.ok(profile.includes(value), value);
  assert.ok(!profile.includes('test-access-token'));
  const encrypted = sessionCookies.map(c => c.slice(c.indexOf('=') + 1)).join('');
  const sessionKey = createHash('sha256').update(secret).digest();
  const { payload } = await jwtDecrypt(encrypted, sessionKey, { issuer: 'zachnologyhr', audience: 'session' });
  assert.equal(payload.profile.sub, 'test|employee');
  assert.ok(payload.exp > Date.now() / 1000);
  assert.ok(payload.exp <= Date.now() / 1000 + 3600);
  for (const invalidCookie of [sessionCookies[0], session.replace('zhr_session=', 'zhr_session=corrupted')]) {
    assert.match(await (await request('/', { headers: { Cookie: invalidCookie } })).text(), /Log in to ZachnologyHR/);
  }
  const expired = await new EncryptJWT({ profile: { sub: 'expired' } }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer('zachnologyhr').setAudience('session').setExpirationTime(Math.floor(Date.now() / 1000) - 60).encrypt(sessionKey);
  assert.match(await (await request('/', { headers: { Cookie: `zhr_session=${expired}` } })).text(), /Log in to ZachnologyHR/);
  // A separate process can read the session without shared disk or process memory.
  secondServer = startServer(3102);
  secondServer.stdout.resume();
  secondServer.stderr.resume();
  let crossInstance = false;
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch('http://localhost:3102', { headers: { Cookie: session }, signal: AbortSignal.timeout(2000) });
      if ((await response.text()).includes('Test Employee')) { crossInstance = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(crossInstance, 'Session must work across independent server instances');
  for (const headers of [
    { Origin: 'https://other.test' },
    { Origin: 'null' },
    {},
    { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://other.test', 'Sec-Fetch-Site': 'same-site' },
    { Origin: base, 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    const blocked = await request('/auth/logout', { method: 'POST', headers: { ...headers, Cookie: session } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.getSetCookie().length, 0);
  }
  for (const headers of [
    { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
    { 'Sec-Fetch-Site': 'same-origin' },
    { Origin: 'https://deployment-alias.example.test', 'Sec-Fetch-Site': 'same-origin' },
  ]) {
    const result = await request('/auth/logout', { method: 'POST', headers: { ...headers, Cookie: session } });
    assert.equal(result.status, 303);
    assert.equal(result.headers.get('location'), base + '/');
    assert.ok(result.headers.getSetCookie().some(c => c.startsWith('zhr_session=') && c.includes('Max-Age=0')));
  }
  const logout = await request('/auth/logout', { method: 'POST', headers: { Origin: base, Cookie: session } });
  assert.equal(logout.status, 303);
  for (const name of ['zhr_session', 'zhr_session.1', 'zhr_session.2']) {
    assert.ok(logout.headers.getSetCookie().some(c => c.startsWith(`${name}=`) && c.includes('Max-Age=0')));
  }
  assert.match(await (await request('/')).text(), /Log in to ZachnologyHR/);
  console.log('PASS: PKCE, state and upstream errors, encrypted chunked profile, tampering and expiry rejection, cross-instance sessions, protected logout and cookie clearing.');
} finally { server.kill(); secondServer?.kill(); }
