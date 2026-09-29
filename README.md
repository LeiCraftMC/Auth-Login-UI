# LeiCraft_MC Auth Login UI

The login of LeiCraft_MC Auth: a drop-in replacement for the **Zitadel Login V2**
([`zitadel/apps/login`](https://github.com/zitadel/zitadel/tree/main/apps/login), ported from tag
**v4.19.2**) in the LeiCraft_MC design. It serves the same pages, query parameters, cookies and flows
(OIDC, SAML, device authorization, IdPs incl. LDAP, passkeys, U2F, TOTP/SMS/email OTP, registration,
invites, logout), so Zitadel can use it as its login without further changes.

It talks to Zitadel **only as a system API user** (JWT signed with the system user's key, audience
`AUDIENCE`). One deployment serves all virtual instances: the instance of every request is taken from
its host (`Host`, or `x-zitadel-instance-host` / `x-zitadel-public-host` behind a proxy).

## Stack

- Nuxt 4 (`app/` srcDir) + NuxtUI v4 + Tailwind v4, client-rendered pages in the LeiCraft_MC design,
  styled by the complete branding (label policy) of the instance / organization
- Hono + Zod + `hono-openapi` (Scalar) in `server/`, mounted at `<base>/api`
- Connect (`@connectrpc/connect-web`, binary protobuf) with protobuf-es code generated from the
  Zitadel v4.19.2 protos (`server/lib/zitadel/proto/`)
- Bun runtime (Nitro `bun` preset), Biome, AGPL-3.0

## Setup

```bash
bun install
cp example.env .env   # fill in the Zitadel system user, see below
bun run dev           # http://localhost:12192/ui/v2/login/
```

### Zitadel

1. **System API user**: add a system user to the Zitadel runtime configuration (`SystemAPIUsers`)
   with the public key of `LCMC_AUTH_LOGIN_SYSTEM_USER_PRIVATE_KEY(_FILE)` and a system-level
   membership that allows acting as login client on every instance. Set `LCMC_AUTH_LOGIN_AUDIENCE`
   to the audience Zitadel expects (its external URL). See
   [Access the Zitadel System API](https://zitadel.com/docs/guides/integrate/zitadel-apis/access-zitadel-system-api)
   and [Login UI](https://zitadel.com/docs/guides/integrate/login-ui).
2. **Login V2 per instance**: enable the Login V2 feature with the base URI of this app, e.g.
   `https://auth.leicraftmc.de/ui/v2/login` — Zitadel then redirects to
   `…/ui/v2/login/login?authRequest=…`, and links in emails point to `…/ui/v2/login/<page>`.
3. **Routing**: route `/ui/v2/login/*` of each instance domain to this app, and keep the original
   `Host` (or send `x-zitadel-public-host` / `x-zitadel-instance-host`). Everything else goes to
   Zitadel. With `PROXY_ZITADEL_PATHS` the app also forwards `<base>/.well-known`, `/oauth`, `/oidc`,
   `/idps/callback`, `/saml` and `/assets` to Zitadel, like the Zitadel login.
4. **Session cookie secret**: set `LCMC_AUTH_LOGIN_SESSION_COOKIE_SECRET` (≥ 32 characters). The
   signature format is identical to the Zitadel login's; with the same secret, its `sessions` cookie
   stays valid when switching between the two logins.

All settings are documented in [`example.env`](example.env); names in parentheses there are the
Zitadel login's variables.

## Structure

| Path | What |
| --- | --- |
| `app/pages/**` | The login pages at the Zitadel login paths (`/loginname`, `/password`, `/otp/[method]`, `/idp/[provider]/process`, …) |
| `app/components/login/` | Shared login components (`<LoginCard>`, `<LoginIdpButtons>`, session lists, authenticator choosers, …) |
| `app/composables/` | `useAPI`, `useLoginPage` (page data), `useLoginFlow` (login steps: redirects, SAML posts, errors), `useTranslations`, `useBrandingTheme` |
| `server/lib/api/versions/v1/routes/` | Page data (`GET`) and login steps (`POST`/`PUT`/`DELETE`) — the Zitadel login's server components and server actions |
| `server/lib/login/` | The login logic (port of the Zitadel login's `lib/server/*`) |
| `server/lib/protocol/` + `server/middleware/protocol.ts` | `GET /login` (flow start), `/healthy`, `/ready`, the Zitadel proxy paths, security headers + CSP |
| `server/lib/zitadel/` | System-user token, Connect clients, cached Zitadel API, generated protos |
| `server/lib/i18n/` | The 15 Zitadel login languages, language resolution and Zitadel custom texts |

## Scripts

- `bun run dev` — dev server on port 12192 (frontend + API)
- `bun run build` / `bun run start` — production build (single `.output/`, Bun preset) and run it
- `docker/Dockerfile` — production image (`.output/` on `oven/bun`, port 12192)
- `bun run api-client:generate` — regenerate the typed API client (`app/api-client/`)
- `bun run proto:generate` — regenerate the Zitadel protobuf code (pinned tag, no `buf` binary needed)
- `bun run check` / `bun run format` — Biome check / format
- `bun run typecheck` — `nuxt typecheck` + `tsc` (includes `server/` and `tests/`)
- `bun test` — tests; Zitadel is replaced by an in-memory Connect router (`tests/helpers/zitadel.ts`)

## Differences to the Zitadel login

Behaviour is kept identical; these are deliberate differences:

- **Architecture**: Next.js server components / server actions became an API (`<base>/api/v1`) plus
  client-rendered pages. Mutating API calls require a same-origin `Origin` (the equivalent of Next's
  server-action origin check; extra origins via `ALLOWED_ORIGINS`).
- **Authentication**: only the system API user (no service-user token / login client key).
- **Design**: the LeiCraft_MC design is the base, and every setting of the branding (label policy)
  is applied on top: light and dark primary / background / warn / font colors, light and dark logo,
  icon (favicon), custom font, theme mode (light, dark, auto; the light / system / dark switch as in
  the Zitadel login) and "hide login name suffix". A color that still has Zitadel's default value
  counts as not customized and keeps the LeiCraft_MC color, and an instance without a theme mode
  (unspecified) starts dark. Without a logo for the current theme the other theme's logo is shown,
  without any logo the LeiCraft_MC logo. The watermark setting has nothing to hide (the Zitadel
  login v2 shows none either).
- **Hardening / fixes** over v4.19.2: the OTP email link template, the session used to continue a
  flow and the default redirect URI are resolved server-side instead of trusting the client;
  `/mfa/skip` checks that the session belongs to the user; a failed TOTP confirmation shows its error;
  the `/login` LDAP scope redirect goes to `/idp/ldap?idpId=…` (upstream: missing `/ldap` page); the
  OTP setup "continue" link uses `requestId=` (upstream: `authRequest=`); the device consent screen
  uses its existing texts (upstream looks up `device.device.*` keys that don't exist); a failed device
  approval on `/signedin` is shown; `postErrorRedirectUrl` links only lead to login pages.
