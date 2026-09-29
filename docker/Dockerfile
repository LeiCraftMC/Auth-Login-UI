# Production image: the full-stack server bundle (.output/ — Nuxt + the Hono API, Bun preset) on
# the Bun runtime. Build it first (CI does this): `bun run build`. .output/ is self-contained; only
# the Drizzle migrations are copied next to it (DB.init reads ./drizzle/migrations on startup).
# Runtime config comes from env: set the public app URL twice — `APPPREFIX_APP_URL` (API side:
# CORS, links in emails) and `NUXT_PUBLIC_APP_URL` (the URL the browser's API client calls).
FROM oven/bun:1-slim

WORKDIR /app

COPY ./.output ./.output
COPY ./drizzle/migrations ./drizzle/migrations

ENV PORT=12520

EXPOSE 12520/tcp

CMD ["bun", "run", ".output/server/index.mjs"]
