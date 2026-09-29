import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
	input: "./data/temp-api-openapi.json",
	output: "app/api-client",
	plugins: [
		// Divergence (as in LAVIAC): client-nuxt generates code that fails vue-tsc on
		// Windows/Bun — use client-fetch; useAPI unwraps `{ data, error }` to the envelope.
		"@hey-api/client-fetch",
		"@hey-api/typescript",
		"@hey-api/sdk",
		"zod",
	],
});
