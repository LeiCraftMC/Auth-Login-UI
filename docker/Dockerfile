# Production image: the full-stack server bundle (.output/ — Nuxt + the Hono API, Bun preset) on
# the Bun runtime. Build it first (CI does this): `bun run build`. .output/ is self-contained.
# Configuration comes from the LCMC_AUTH_LOGIN_* env (see example.env) and NUXT_APP_BASE_URL.
# Health probes: GET /ui/v2/login/healthy (liveness), /ui/v2/login/ready (readiness).
FROM oven/bun:1-slim

WORKDIR /opt/leicraftmc/auth/login-ui

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY .output ./app/.output

EXPOSE 12192/tcp

ENV NODE_ENV=production
ENV NITRO_HOST=::
ENV NITRO_PORT=12192

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
	CMD curl -f http://localhost:12192/ui/v2/login/healthy || exit 1

CMD ["bun", "run", "/opt/leicraftmc/auth/login-ui/app/.output/server/index.mjs"]
