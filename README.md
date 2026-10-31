# ZachnologyHR

A small Next.js App Router project that displays the signed-in employee's directory profile. It uses your Auth0 `entra-saml` connection and the custom claims returned by `/userinfo`.

## Run locally

1. Install Node.js 22 or newer and run `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Set `AUTH0_CLIENT_SECRET` to the full secret from your Auth0 application settings. The screenshot's truncated secret is intentionally not copied.
4. Generate a session secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and set `SESSION_SECRET` to that value.
5. In Auth0, configure this client as a **Regular Web Application**, enable **Authorization Code**, and use **POST** client authentication (client secret in the token request body). Add this exact Allowed Callback URL:

   `http://localhost:3000/auth/callback`

6. Run `npm run dev` and open http://localhost:3000.

No full client secret is available from the screenshots, so live authentication needs step 3 before it will work. The app displays a configuration message until both secrets are set.

## Sign-in flow

- `/auth/login` redirects to `https://auth.zachnology.com/authorize` with your client ID, connection, `openid profile email` scope, and requested Management API audience. It adds random state and PKCE S256.
- `/auth/callback` verifies the expiring, encrypted transaction cookie and state, then POSTs an `application/x-www-form-urlencoded` code exchange to `/oauth/token`, including the client secret and PKCE verifier.
- The server calls `/userinfo` with the access token as a Bearer token. It saves the returned profile and discards the tokens. The ID token is not used as an authentication source.
- Profile sessions expire after eight hours or the access token lifetime, whichever is shorter. Profile data is stored in authenticated, AES-256-GCM encrypted HttpOnly cookies, marked Secure on HTTPS with SameSite=Lax. No filesystem writes or database are needed. Larger profiles use up to three cookie chunks (3,000 characters each); profiles exceeding 9,000 encrypted characters are rejected rather than silently truncated.
- Sign out clears all session cookie chunks. The organization's Auth0/Entra SSO session remains active. These stateless sessions do not support individual server-side revocation: a copied cookie remains valid until expiry. Rotating SESSION_SECRET invalidates all sessions.

The page renders contact details, employment details, location, extra app metadata, and a collapsible full `/userinfo` response. Missing and null fields show “Not provided.” Custom claims use `https://namespace.zachnology.com/app_metadata` and `https://namespace.zachnology.com/user_data/phone`.

## Deployment

Run `npm run build` and `npm start` for a production build. Set `APP_BASE_URL` to your public HTTPS origin and add `<origin>/auth/callback` to Auth0 Allowed Callback URLs. The callback is derived from this trusted configuration, rather than incoming host headers. Configure your reverse proxy to forward to the app's localhost port (or adjust the start script for your host).

### Vercel

Import the Next.js project into Vercel. Set `APP_BASE_URL` to the deployed HTTPS origin, and configure `AUTH0_CLIENT_SECRET` and a random `SESSION_SECRET` of at least 64 characters in Vercel's environment variables. The other Auth0 settings have the defaults shown in `.env.example`. Add `<APP_BASE_URL>/auth/callback` to Auth0 Allowed Callback URLs, then redeploy so environment changes take effect.

Sessions work across serverless instances as long as all instances use the same session secret. The old disk-backed session format is no longer accepted; existing users must sign in again after this update. Profile updates appear on the next sign-in; this app displays each employee's own profile rather than listing all employees. For unusually large directory profiles or individual session revocation, use a shared database session store instead.

## Verification

`npm run typecheck` checks TypeScript. `npm run build` creates the production build. After building, `npm test` runs the authentication integration checks against a mock issuer and synthetic employee profile on port 3101. A real end-to-end login requires your client secret and Auth0 callback registration.

References: [Auth0 authorization code flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow/add-login-auth-code-flow), [Next.js cookies](https://nextjs.org/docs/app/api-reference/functions/cookies).
