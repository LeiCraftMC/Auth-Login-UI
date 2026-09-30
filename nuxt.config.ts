// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	compatibilityDate: "2026-09-01",
	devtools: { enabled: true },
	modules: ["@nuxt/ui"],

	// Served under the Zitadel login path (Zitadel's DefaultLoginURLV2 is
	// `/ui/v2/login/login?authRequest=`). Override at runtime with NUXT_APP_BASE_URL.
	app: {
		baseURL: "/ui/v2/login/",
		head: {
			meta: [{ name: "robots", content: "none" }],
		},
	},

	// Icons ship in the client bundle and render as inline SVG (CSS mode uses data: mask images,
	// which the Zitadel login CSP `img-src` blocks). Icons missing from the bundle load from this
	// app (`<base>/_nuxt_icon`, Lucide bundled into the server build) — never from
	// api.iconify.design, which the CSP `connect-src` blocks. With `ssr: false` Nuxt Icon would
	// default to that CDN. The endpoint must not live under /api (the Hono catch-all owns it).
	icon: {
		mode: "svg",
		provider: "server",
		localApiEndpoint: "/_nuxt_icon",
		fallbackToApi: false,
		serverBundle: { collections: ["lucide"] },
		clientBundle: { scan: true },
	},

	// Dark (LeiCraft_MC) unless the branding forces / allows another theme (useBrandingTheme).
	colorMode: {
		preference: "dark",
		fallback: "dark",
		classSuffix: "",
	},

	// Every page depends on the request's instance, cookies and flow state, all of which the
	// browser loads from the API — the pages are rendered client-side only.
	ssr: false,

	css: ["~/assets/css/main.css"],

	nitro: {
		// server/ runs on Bun.
		typescript: {
			tsConfig: { compilerOptions: { types: ["bun-types"] } },
		},

		esbuild: {
			options: {
				target: "esnext",
			},
		},
	},

	telemetry: false,
});
