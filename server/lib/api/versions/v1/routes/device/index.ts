import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { LoginContext } from "../../../../../login/context";
import { SessionCookies } from "../../../../../login/cookies";
import { LoginLogout } from "../../../../../login/logout";
import { Logger } from "../../../../../utils/logger";
import { ZitadelAPI } from "../../../../../zitadel/api";
import { APIResponse } from "../../../../utils/api-res";
import { PageHelpers } from "../../../../utils/pageHelpers";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { DeviceModel } from "./model";

export const router = new Hono().basePath("/device");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Device code page",
		description: "Branding for entering the code shown on the device.",
		tags: [DOCS_TAGS.DEVICE],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", DeviceModel.Page.Response),
		),
	}),

	zValidator("query", DeviceModel.Page.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { organization } = c.req.valid("query");
		const defaultOrganization = await PageHelpers.defaultOrganization(ctx, organization);

		return APIResponse.success(c, "Page data loaded", {
			branding: await PageHelpers.branding(ctx, organization ?? defaultOrganization),
		} satisfies DeviceModel.Page.Response);
	},
);

router.get(
	"/consent",

	APIRouteSpec.unauthenticated({
		summary: "Device consent page",
		description: "The device authorization request (app name, scopes) to allow or deny.",
		tags: [DOCS_TAGS.DEVICE],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Page data loaded", DeviceModel.ConsentPage.Response),
		),
	}),

	zValidator("query", DeviceModel.ConsentPage.Query),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { user_code: userCode, requestId, organization } = c.req.valid("query");

		const params = new URLSearchParams();
		if (requestId) params.append("requestId", requestId);
		if (organization) params.append("organization", organization);
		const nextUrl = `/loginname?${params}`;

		if (!userCode || !requestId) {
			return APIResponse.success(c, "Page data loaded", {
				error: "noUserCode",
				branding: null,
				deviceAuthorizationRequest: null,
				nextUrl,
			} satisfies DeviceModel.ConsentPage.Response);
		}

		const { deviceAuthorizationRequest } = await ZitadelAPI.getDeviceAuthorizationRequest({
			serviceConfig: ctx.serviceConfig,
			userCode,
		}).catch(() => ({ deviceAuthorizationRequest: undefined }));

		if (!deviceAuthorizationRequest) {
			return APIResponse.success(c, "Page data loaded", {
				error: "noDeviceRequest",
				branding: null,
				deviceAuthorizationRequest: null,
				nextUrl,
			} satisfies DeviceModel.ConsentPage.Response);
		}

		const defaultOrganization = await PageHelpers.defaultOrganization(ctx, organization);

		return APIResponse.success(c, "Page data loaded", {
			branding: await PageHelpers.branding(ctx, organization ?? defaultOrganization),
			deviceAuthorizationRequest: {
				id: deviceAuthorizationRequest.id,
				appName: deviceAuthorizationRequest.appName,
				scope: deviceAuthorizationRequest.scope,
			},
			nextUrl,
		} satisfies DeviceModel.ConsentPage.Response);
	},
);

router.post(
	"/code",

	APIRouteSpec.unauthenticated({
		summary: "Look up device code",
		description: "Finds the device authorization request of a user code.",
		tags: [DOCS_TAGS.DEVICE],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Device request found", DeviceModel.Code.Response),
			APIResponseSpec.badRequest("Could not continue the request"),
		),
	}),

	zValidator("json", DeviceModel.Code.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { userCode } = c.req.valid("json");

		const response = await ZitadelAPI.getDeviceAuthorizationRequest({
			serviceConfig: ctx.serviceConfig,
			userCode,
		}).catch((error) => {
			Logger.warn("Could not load device authorization request:", error);
			return undefined;
		});

		if (!response?.deviceAuthorizationRequest?.id) {
			return APIResponse.badRequest(c, "Could not continue the request");
		}

		return APIResponse.success(c, "Device request found", {
			deviceAuthorizationRequestId: response.deviceAuthorizationRequest.id,
		} satisfies DeviceModel.Code.Response);
	},
);

router.post(
	"/deny",

	APIRouteSpec.unauthenticated({
		summary: "Deny device",
		description: "Denies the device authorization request.",
		tags: [DOCS_TAGS.DEVICE],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Device request denied"),
			APIResponseSpec.badRequest("Could not deny the request"),
		),
	}),

	zValidator("json", DeviceModel.Deny.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		try {
			await LoginLogout.completeDeviceAuthorization(
				ctx.serviceConfig,
				c.req.valid("json").deviceAuthorizationId,
			);
			return APIResponse.successNoData(c, "Device request denied");
		} catch (error) {
			Logger.warn("Could not deny device authorization:", error);
			return APIResponse.badRequest(c, "Could not deny the request");
		}
	},
);

router.post(
	"/authorize",

	APIRouteSpec.unauthenticated({
		summary: "Authorize device",
		description: "Approves the device authorization request with the session of this browser.",
		tags: [DOCS_TAGS.DEVICE],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Device authorized"),
			APIResponseSpec.badRequest("Could not authorize the device"),
		),
	}),

	zValidator("json", DeviceModel.Authorize.Body),

	async (c) => {
		const ctx = LoginContext.from(c);
		const { requestId, sessionId, loginName, organization } = c.req.valid("json");

		if (!requestId.startsWith("device_")) {
			return APIResponse.badRequest(c, "Not a device authorization request");
		}

		const cookie = sessionId
			? SessionCookies.getById(ctx, { sessionId, organization })
			: SessionCookies.getMostRecentWithLoginName(ctx, { loginName, organization });

		if (!cookie) {
			return APIResponse.badRequest(c, "Could not authorize the device");
		}

		try {
			await LoginLogout.completeDeviceAuthorization(
				ctx.serviceConfig,
				requestId.replace("device_", ""),
				{
					sessionId: cookie.id,
					sessionToken: cookie.token,
				},
			);
			return APIResponse.successNoData(c, "Device authorized");
		} catch (error) {
			Logger.warn("Could not authorize device:", error);
			return APIResponse.badRequest(
				c,
				error instanceof Error ? error.message : "Could not authorize the device",
			);
		}
	},
);
