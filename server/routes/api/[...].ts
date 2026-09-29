import { defineEventHandler, setResponseStatus } from "h3";
import { Hono } from "hono";
import { API } from "../../lib/api";
import { LoginContext } from "../../lib/login/context";
import { HonoBridge } from "../../lib/utils/honoBridge";

// Catch-all: forward every <base>/api/** request to the Hono app (mounted at <base>/api, where
// <base> is NUXT_APP_BASE_URL, default /ui/v2/login). Hono then handles /api/v1/**, /api/health
// and /api/docs/v1.
let wrapper: Hono | null = null;

// Only cache the wrapper once `API.getApp()` succeeds. A request that arrives while
// `server/plugins/startup.ts` is still running `API.init()` must not cache an empty router.
function getWrapper(): Hono | null {
	if (wrapper) return wrapper;
	try {
		const app = new Hono();
		app.route(`${LoginContext.getBasePath()}/api`, API.getApp());
		wrapper = app;
		return wrapper;
	} catch {
		return null;
	}
}

export default defineEventHandler(async (event) => {
	const app = getWrapper();
	if (!app) {
		setResponseStatus(event, 503);
		return {
			success: false,
			code: 503,
			message: "API is starting, please retry shortly",
		};
	}

	return app.fetch(await HonoBridge.toRequest(event));
});
