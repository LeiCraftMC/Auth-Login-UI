# AGENTS.md — operating manual for AI coding agents

You are working in the LeiCraft_MC Auth Login UI: a LeiCraft_MC full-stack Nuxt app (Nuxt frontend +
Hono backend in `server/`) that replaces the Zitadel Login V2 (`zitadel/apps/login`, ported from
tag v4.19.2). Follow the LeiCraft_MC Style Guides: https://git.leicraftmc.de/LeiCraftMC/Style-Guides.

## Must read

- [docs/00-overview.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/blob/main/docs/00-overview.md)
- [docs/01-project-structure.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/blob/main/docs/01-project-structure.md) — the full-stack Nuxt shape
- [docs/04-backend-hono.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/blob/main/docs/04-backend-hono.md) — Mounting Hono in Nitro
- [docs/05-api-contract.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/blob/main/docs/05-api-contract.md)
- [docs/06-frontend-nuxt.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/blob/main/docs/06-frontend-nuxt.md)
- [docs/07-state-and-data.md](https://git.leicraftmc.de/LeiCraftMC/Style-Guides/blob/main/docs/07-state-and-data.md)
- `README.md` — setup, structure and the differences to the Zitadel login

## Non-negotiable

- **Parity with the Zitadel login first**: page paths, query parameters, cookie names/formats
  (`sessions` with its HMAC signature, `NEXT_LOCALE`, `fingerprintId`), i18n keys and flow
  behaviour follow `zitadel/apps/login` v4.19.2. Check the upstream source before changing a flow and
  record intentional differences in the README.
- Zitadel is only reached as the **system API user** (`server/lib/zitadel/systemToken.ts`); the
  instance comes from the request host (`LoginContext.getServiceConfig`). No PAT / login client key.
- Nuxt 4 `app/` srcDir; Tailwind v4 CSS-first. Pages are client-rendered (`ssr: false`) and served
  under `app.baseURL` (`/ui/v2/login/`, `NUXT_APP_BASE_URL`).
- **Every branding (label policy) option must work** (colors, logos, icon, font, theme mode — see
  `utils/branding.ts`, `useBrandingTheme`). Use NuxtUI's semantic colors (`bg-default`,
  `bg-elevated`, `text-muted`, `border-default`, …) — never fixed `slate-*` / `white/*` classes —
  so both themes and the branded colors apply.
- The Hono API lives in `server/` and owns `<base>/api`; protocol routes (`/login`, `/healthy`,
  `/ready`, Zitadel proxy paths) are in `server/lib/protocol/`, dispatched by
  `server/middleware/protocol.ts`. Init in `server/plugins/startup.ts`.
- Every API response uses the `{ success, code, message, data }` envelope via `APIResponse.*`;
  login steps return `LoginModels.FlowStep` (`{ redirect?, samlData? }`) via `LoginResponses.flow`.
- Validate with `hono-openapi`'s validator (`import { validator as zValidator } from "hono-openapi"`);
  routes in `server/lib/api/versions/v<n>/routes/<resource>/{index.ts, model.ts}`.
- Frontend: API access only through `useAPI`; page data via `useLoginPage`, login steps via
  `useLoginFlow` (never navigate to a step result yourself); texts via `useTranslations(namespace)`;
  global state via `AbstractStore`. Every page renders one `<LoginCard>`.
- Lucide icons only (`i-lucide-*`); brand marks of IdPs are images in `components/img/`. Icons
  render as inline SVG (`icon.mode: "svg"`) because the Zitadel login CSP blocks `data:` images;
  icons missing from the client bundle come from this app (`<base>/_nuxt_icon`), never the Iconify CDN.
- Never hand-edit `app/api-client/*.gen.ts` (`bun run api-client:generate`) or
  `server/lib/zitadel/proto/**` (`bun run proto:generate`).
- Format with Biome before finishing. Conventional Commits.

## Divergences from the fullstack template

- Not dark-only: dark (LeiCraft_MC) by default, but the branding can force light, follow the system
  or offer the light / system / dark switch, like the Zitadel login.
- No database, email, cron or task queue; no bearer-token auth (the login state is the signed
  `sessions` cookie). Mutating API calls pass an `Origin` check instead (`API.isAllowedOrigin`).
- Generated client uses `@hey-api/client-fetch` (like LAVIAC): client-nuxt's generated code fails
  vue-tsc on Windows/Bun. `useAPI` unwraps `{ data, error }` to the envelope.
- `@unhead/*` is pinned to 3.4.0 via `overrides` (3.4.1 ships an unparsable `.d.ts`).
- Protos are generated in-process (`scripts/proto-generate.ts`: protobufjs → descriptors →
  protoc-gen-es) because the `buf` binary cannot be executed on the development machines.
