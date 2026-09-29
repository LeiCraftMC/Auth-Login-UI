# CLAUDE.md — Claude Code specifics

Read `AGENTS.md` first. This file adds Claude-Code-specific notes.

## Slash commands

Defined in `.claude/settings.json`:

- `/api-client` — regenerate the typed API client (boots the API in-process; no dev server needed).
- `/proto` — regenerate the Zitadel protobuf code for the pinned Zitadel tag.
- `/verify` — typecheck + tests.
- `/typecheck` — `bun run typecheck` (`nuxt typecheck` + `tsc`, includes `server/`).
- `/test` — `bun test`.
- `/dev` — start/inspect the dev setup (port 12192, served under `/ui/v2/login/`).

## MCP servers

`mcpServers` in `.claude/settings.json` and `.vscode/mcp.json` both register `nuxt` and `nuxt-ui`.

## Backend in `server/`

Hono lives in `server/lib/api`, mounted at `<base>/api` by `server/routes/api/[...].ts`; the
Zitadel-shaped routes (`/login`, `/healthy`, `/ready`, proxy paths) are in `server/lib/protocol/`.
Both are initialized by `server/plugins/startup.ts`. After changing a backend route, regenerate the
client with `bun run api-client:generate`. Never hand-edit `app/api-client/*.gen.ts`.

The upstream Zitadel login source is the reference for every flow: when porting or fixing, compare
with `apps/login/src/lib/server/*` and the page/component of the same name in the tag named in
`server/lib/utils/constants.ts` (`ZITADEL_VERSION`).

## Frontend conventions

- Pages live at the Zitadel login paths; each renders one `<LoginCard>` and loads its data with
  `useLoginPage`, runs steps with `useLoginFlow`.
- Reference components by their Nuxt auto-import names (`LoginCard`, `LoginIdpButtons`,
  `ImgIdpLogo`, `PasskeyLogin`, …). Don't add explicit imports that only the `<template>` uses:
  Biome can't see template usage, reports them as unused, and an `--unsafe` fix would delete them.
- If a `<script>` binding is used as a type there and as a value in the `<template>` (e.g. a Zod
  schema for `UForm :schema`), also reference it as a value in `<script>`. Otherwise Biome's
  `useImportType` safe fix turns it into `import type` and breaks the page at runtime.
- In `.vue` files, Biome *warnings* about unused variables/imports are expected (template usage).
  Biome *errors* are not.
- Stores live in `app/composables/stores/` (`useI18nStore`) and are imported explicitly.
