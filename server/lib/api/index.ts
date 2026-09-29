import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { prettyJSON } from "hono/pretty-json";
import { openAPIRouteHandler } from "hono-openapi";
import { LoginContext } from "../login/context";
import { AppConstants } from "../utils/constants";
import { Logger } from "../utils/logger";
import type { APIVersionRouter } from "./utils/apiVersionRouter";
import { APIv1Router } from "./versions/v1";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class API {
	protected static app: Hono | null;

	protected static latestVersion: number | null = null;

	protected static registerVersion(versionRouter: APIVersionRouter, disableDocs: boolean) {
		if (!this.app) {
			throw new Error("API not initialized. Call API.init() first.");
		}

		this.app.route(`/v${versionRouter.version}`, versionRouter.router);

		if (!this.latestVersion || versionRouter.version > this.latestVersion) {
			this.latestVersion = versionRouter.version;
		}

		if (!disableDocs) {
			this.app.get(
				`/docs/v${versionRouter.version}/openapi`,
				openAPIRouteHandler(versionRouter.router, versionRouter.openAPIConfig),
			);

			this.app.get(
				`/docs/v${versionRouter.version}`,
				// Relative, so the docs page also finds its spec when the API is mounted under a prefix.
				Scalar({ url: `./v${versionRouter.version}/openapi` }),
			);
		}
	}

	/**
	 * Cookie-authenticated state changes must come from the login's own origin (Next's
	 * server-action origin check in the Zitadel login): the `Origin` of unsafe requests has to
	 * match the public host or one of the allowed origins.
	 */
	static isAllowedOrigin(headers: Headers, allowedOrigins: string[]): boolean {
		const origin = headers.get("origin");
		if (!origin) {
			// no Origin (non-browser client); browsers always send one for cross-site requests
			return headers.get("sec-fetch-site") !== "cross-site";
		}
		if (allowedOrigins.includes(origin)) return true;

		try {
			return new URL(origin).host === LoginContext.getPublicHost(headers);
		} catch {
			return false;
		}
	}

	/**
	 * Build the Hono app: prettyJSON, CORS (only the allowed extra origins — the login calls its
	 * API same-origin), CSRF origin check, error handler, versioned routes, docs, /health.
	 */
	static async init(allowedOrigins: string[], disableDocs: boolean) {
		this.app = new Hono();

		this.app.use(prettyJSON());

		this.app.use(
			"*",
			cors({
				origin: allowedOrigins,
				allowHeaders: ["Content-Type", "Authorization", "x-zitadel-i18n-organization"],
				allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
				maxAge: 600,
				credentials: true,
			}),
		);

		this.app.use("*", async (c, next) => {
			if (!SAFE_METHODS.has(c.req.method) && !API.isAllowedOrigin(c.req.raw.headers, allowedOrigins)) {
				return c.json({ success: false, code: 403, message: "Cross-origin request blocked" }, 403);
			}
			await next();
		});

		this.app.onError((err, c) => {
			if (err instanceof HTTPException) {
				// Return only safe error metadata — never leak Zod validation details
				return c.json(
					{
						success: false,
						code: err.status,
						message: "Your input is invalid",
					},
					err.status,
				);
			}

			Logger.error("Unhandled API error:", err);
			return c.json({ success: false, code: 500, message: "Internal Server Error" }, 500);
		});

		this.registerVersion(new APIv1Router(), disableDocs);

		this.app.get("/health", (c) => {
			return c.json({
				success: true,
				code: 200,
				message: `${AppConstants.APP_NAME} API is running`,
				data: null,
			});
		});

		if (!disableDocs) {
			this.app.get("/", (c) => {
				// Keep any mount prefix (e.g. `/api` in the full-stack template).
				const base = c.req.path.endsWith("/") ? c.req.path.slice(0, -1) : c.req.path;
				return c.redirect(`${base}/docs/v${this.latestVersion}`);
			});
		} else {
			this.app.get("/", (c) => {
				return c.json({
					success: true,
					code: 200,
					message: `${AppConstants.APP_NAME} API is running. Documentation is disabled.`,
					data: null,
				});
			});
		}
	}

	static getApp(): Hono {
		if (!this.app) {
			throw new Error(`${AppConstants.APP_NAME} API not initialized. Call API.init() first.`);
		}
		return this.app;
	}
}
