// Only loaded by the integration test's child server. No real identity traffic.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = String(input);
  if (!url.startsWith('https://identity.example.test/')) return originalFetch(input, options);
  if (url.endsWith('/oauth/token')) {
    const body = options.body;
    const valid = options.method === 'POST' && body.get('grant_type') === 'authorization_code'
      && body.get('client_secret') === 'integration-test-secret'
      && body.get('redirect_uri') === 'http://localhost:3101/auth/callback'
      && body.get('code_verifier')?.length === 43;
    if (!valid || body.get('code') === 'bad') return Response.json({ error: 'invalid_grant' }, { status: 400 });
    return Response.json({ access_token: body.get('code') === 'no-profile' ? 'no-profile' : 'test-access-token', token_type: 'Bearer', expires_in: 3600 });
  }
  if (url.endsWith('/userinfo')) {
    if (options.headers.Authorization !== 'Bearer test-access-token') return new Response(null, { status: 401 });
    return Response.json({ sub: 'test|employee', name: 'Test Employee', given_name: 'Test', family_name: 'Employee', email: 'employee@example.test', test_padding: 'x'.repeat(2600),
      'https://namespace.zachnology.com/app_metadata': { department: 'Engineering', employee_id: 'TEST-101', city: 'Chicago', country: null, title: 'Engineer', user_type: 'Full Time', custom_field: 'Extra property' },
      'https://namespace.zachnology.com/user_data/phone': '+1 555 0100' });
  }
  throw new Error('Unexpected identity request');
};
