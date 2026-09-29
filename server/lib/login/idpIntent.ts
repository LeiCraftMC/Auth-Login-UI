/**
 * Processing the IdP callback (port of the Zitadel login's `lib/server/idp-intent.ts`).
 *
 * Consumes the single-use intent token once and decides: explicit linking, sign-in of an existing
 * user, auto-linking, auto-creation, manual registration, or "account not found".
 */
import { create } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import { Code } from "@connectrpc/connect";
import { Logger } from "../utils/logger";
import { type ServiceConfig, type Translate, ZitadelAPI } from "../zitadel/api";
import { isClassifiedError } from "../zitadel/errors";
import { AutoLinkingOption } from "../zitadel/proto/zitadel/idp/v2/idp_pb";
import type { SetHumanEmail } from "../zitadel/proto/zitadel/user/v2/email_pb";
import type { SetHumanProfile } from "../zitadel/proto/zitadel/user/v2/user_pb";
import {
	type CreateUserRequest,
	CreateUserRequestSchema,
	type UpdateUserRequest,
	UpdateUserRequestSchema,
} from "../zitadel/proto/zitadel/user/v2/user_service_pb";
import type { LoginContext } from "./context";
import { LoginCookies, SessionCookies } from "./cookies";
import { LoginIdp } from "./idp";
import { InstanceRoles } from "./instanceRoles";
import { LoginSecurity } from "./security";
import type { FlowResult } from "./types";

const ORG_SUFFIX_REGEX = /(?<=@)(.+)/;

type IDPIntentResult = Awaited<ReturnType<typeof ZitadelAPI.retrieveIDPIntent>>;
type IDPConfig = Awaited<ReturnType<typeof ZitadelAPI.getIDPByID>>;

/** Flattened "create user" data of an intent (organization resolution, required fields, prefill). */
interface ResolvedCreateUser {
	username?: string;
	profile?: SetHumanProfile;
	email?: SetHumanEmail;
}

interface IDPHandlerContext {
	ctx: LoginContext;
	serviceConfig: ServiceConfig;
	t: Translate;
	intent: IDPIntentResult;
	idp: NonNullable<IDPConfig>;
	options: NonNullable<NonNullable<IDPConfig>["config"]>["options"];
	params: {
		provider: string;
		id: string;
		token: string;
		requestId?: string;
		organization?: string;
		postErrorRedirectUrl?: string;
		sessionId?: string;
		linkFingerprint?: string;
	};
	buildRedirectParams: (additionalParams?: Record<string, string>, includeToken?: boolean) => string;
}

type IDPHandlerResult = FlowResult | null;

export class LoginIdpIntent {
	/** Prefers the `user_action.create_user` oneof, falls back to the deprecated `add_human_user`. */
	static resolveCreateUser(intent: IDPIntentResult): ResolvedCreateUser | undefined {
		if (intent.userAction?.case === "createUser") {
			const request = intent.userAction.value;
			const human = request.userType?.case === "human" ? request.userType.value : undefined;
			return { username: request.username, profile: human?.profile, email: human?.email };
		}
		if (intent.addHumanUser) {
			return {
				username: intent.addHumanUser.username,
				profile: intent.addHumanUser.profile,
				email: intent.addHumanUser.email,
			};
		}
		return undefined;
	}

	/** Request for the non-deprecated CreateUser endpoint with the resolved organization injected. */
	static buildCreateUserRequest(intent: IDPIntentResult, organizationId: string): CreateUserRequest | undefined {
		if (intent.userAction?.case === "createUser") {
			return create(CreateUserRequestSchema, { ...intent.userAction.value, organizationId });
		}
		if (intent.addHumanUser) {
			const add = intent.addHumanUser;
			return create(CreateUserRequestSchema, {
				organizationId,
				username: add.username,
				userType: {
					case: "human",
					value: { profile: add.profile, email: add.email, phone: add.phone, idpLinks: add.idpLinks },
				},
				metadata: add.metadata?.map((entry) => ({ key: entry.key, value: entry.value })),
			});
		}
		return undefined;
	}

	/**
	 * Request for UpdateUser: only profile, email, phone and metadata are synced (not the username,
	 * which would invalidate sessions on every login).
	 */
	static buildUpdateUserRequest(intent: IDPIntentResult, userId: string): UpdateUserRequest | undefined {
		if (intent.userAction?.case === "updateUser") {
			const request = intent.userAction.value;
			const human = request.userType?.case === "human" ? request.userType.value : undefined;

			if (!human && (request.metadata?.length ?? 0) === 0) return undefined;

			return create(UpdateUserRequestSchema, {
				userId,
				userType: human
					? { case: "human", value: { profile: human.profile, email: human.email, phone: human.phone } }
					: undefined,
				metadata: request.metadata,
			});
		}

		if (intent.updateHumanUser) {
			const update = intent.updateHumanUser;
			return create(UpdateUserRequestSchema, {
				userId,
				userType: {
					case: "human",
					value: {
						profile: update.profile
							? {
									givenName: update.profile.givenName,
									familyName: update.profile.familyName,
									nickName: update.profile.nickName,
									displayName: update.profile.displayName,
									preferredLanguage: update.profile.preferredLanguage,
									gender: update.profile.gender,
								}
							: undefined,
						email: update.email,
						phone: update.phone,
					},
				},
			});
		}

		return undefined;
	}

	private static async resolveOrganizationForUser({
		organization,
		createUserData,
		serviceConfig,
	}: {
		organization?: string;
		createUserData?: ResolvedCreateUser;
		serviceConfig: ServiceConfig;
	}): Promise<string | undefined> {
		if (organization) return organization;

		if (createUserData?.username && ORG_SUFFIX_REGEX.test(createUserData.username)) {
			const suffix = ORG_SUFFIX_REGEX.exec(createUserData.username)?.[1] ?? "";
			const orgs = await ZitadelAPI.getOrgsByDomain({ serviceConfig, domain: suffix });
			const orgToCheck = orgs.result && orgs.result.length === 1 ? orgs.result[0]?.id : undefined;

			if (orgToCheck) {
				const orgLoginSettings = await ZitadelAPI.getLoginSettings({ serviceConfig, organization: orgToCheck });
				if (orgLoginSettings?.allowDomainDiscovery) return orgToCheck;
			}
		}

		// fallback: the default organization
		const defaultOrg = await ZitadelAPI.getDefaultOrg({ serviceConfig });
		return defaultOrg?.id;
	}

	/** The organization allows external IdPs and has this IdP active with linking allowed. */
	static async validateIDPLinkingPermissions({
		serviceConfig,
		userOrganizationId,
		idpId,
	}: {
		serviceConfig: ServiceConfig;
		userOrganizationId: string;
		idpId: string;
	}): Promise<boolean> {
		const loginSettings = await ZitadelAPI.getLoginSettings({ serviceConfig, organization: userOrganizationId });
		if (!loginSettings?.allowExternalIdp) return false;

		const activeIDPs = await ZitadelAPI.getActiveIdentityProviders({
			serviceConfig,
			orgId: userOrganizationId,
			linking_allowed: true,
		});
		return !!activeIDPs.identityProviders?.some((idp) => idp.id === idpId);
	}

	private static async sessionResult(
		ctx: LoginContext,
		t: Translate,
		userId: string,
		h: IDPHandlerContext,
	): Promise<FlowResult> {
		const sessionResult = await LoginIdp.createNewSessionFromIdpIntent(ctx, {
			userId,
			idpIntent: { idpIntentId: h.params.id, idpIntentToken: h.params.token },
			requestId: h.params.requestId,
			organization: h.params.organization,
		});

		if ("error" in sessionResult && sessionResult.error) {
			Logger.error("Error creating session", sessionResult.error);
			return { error: sessionResult.error };
		}
		if ("redirect" in sessionResult && sessionResult.redirect) return { redirect: sessionResult.redirect };
		if ("samlData" in sessionResult && sessionResult.samlData) return { samlData: sessionResult.samlData };
		return { error: t("errors.sessionCreationFailed") };
	}

	/** CASE 1 helper: the user of the session to link to, if the session may enroll. */
	private static async resolveUserIdFromSession(
		ctx: LoginContext,
		{ sessionId, serviceConfig, provider }: { sessionId: string; serviceConfig: ServiceConfig; provider: string },
	): Promise<{ userId?: string; redirect?: string }> {
		const failed = { redirect: `/idp/${provider}/linking-failed?error=session_invalid` };
		try {
			const sessionCookie = SessionCookies.getById(ctx, { sessionId });
			if (!sessionCookie) {
				Logger.warn("Session for linking not found or invalid");
				return failed;
			}

			const { session } = await ZitadelAPI.getSession({
				serviceConfig,
				sessionId: sessionCookie.id,
				sessionToken: sessionCookie.token,
			});

			if (!session?.factors?.user?.id) {
				Logger.warn("Session found but no userId associated for linking");
				return failed;
			}

			// An identify-only session must not be trusted to bind an external identity to the
			// account (account takeover); same gate as credential enrollment.
			const enrollmentError = await LoginSecurity.getEnrollmentAuthorizationError(ctx, {
				serviceConfig,
				session,
				userId: session.factors.user.id,
			});
			if (enrollmentError) {
				Logger.warn("Session for linking is not authorized", { enrollmentError });
				return failed;
			}

			return { userId: session.factors.user.id };
		} catch (error) {
			Logger.warn("Error retrieving session for linking", error);
			return failed;
		}
	}

	/** CASE 1: explicit linking — a signed-in user links an IdP to their account. */
	private static async handleExplicitLinking(h: IDPHandlerContext): Promise<IDPHandlerResult> {
		const { sessionId, linkFingerprint, provider } = h.params;
		const { userId } = h.intent;
		const { ctx, options, serviceConfig, intent, t, buildRedirectParams } = h;

		// a linking intent has no userId
		if (!sessionId || userId) return null;

		// 1. the link request must come from the browser that started it
		const fingerprintId = LoginCookies.getFingerprintId(ctx);
		if (!linkFingerprint || !fingerprintId) {
			Logger.warn("Missing fingerprint information for linking verification");
			return { redirect: `/idp/${provider}/linking-failed?error=session_mismatch` };
		}
		const expectedHash = createHash("sha256")
			.update(sessionId + fingerprintId)
			.digest("hex");
		if (linkFingerprint !== expectedHash) {
			Logger.warn("Session linking fingerprint mismatch");
			return { redirect: `/idp/${provider}/linking-failed?error=session_mismatch` };
		}

		// 2. resolve the user of the (authorized) session
		const resolved = await LoginIdpIntent.resolveUserIdFromSession(ctx, { sessionId, serviceConfig, provider });
		if (resolved.redirect || !resolved.userId) {
			return { redirect: resolved.redirect || `/idp/${provider}/linking-failed?error=session_invalid` };
		}

		// 3. link
		if (!options?.isLinkingAllowed) {
			Logger.error("Linking not allowed by IDP configuration");
			return { redirect: `/idp/${provider}/linking-failed?${buildRedirectParams()}&error=linking_not_allowed` };
		}

		try {
			const targetUser = await ZitadelAPI.getUserByID({ serviceConfig, userId: resolved.userId });

			if (!targetUser?.details?.resourceOwner) {
				Logger.error("User not found or missing organization");
				return { redirect: `/idp/${provider}/linking-failed?${buildRedirectParams()}&error=user_not_found` };
			}

			const isAllowed = await LoginIdpIntent.validateIDPLinkingPermissions({
				serviceConfig,
				userOrganizationId: targetUser.details.resourceOwner,
				idpId: intent.idpInformation?.idpId as string,
			});
			if (!isAllowed) {
				Logger.error("IDP linking validation failed");
				return { redirect: `/idp/${provider}/linking-failed?${buildRedirectParams()}&error=validation_failed` };
			}

			await ZitadelAPI.addIDPLink({
				serviceConfig,
				idp: {
					id: intent.idpInformation?.idpId as string,
					userId: intent.idpInformation?.userId as string,
					userName: intent.idpInformation?.userName as string,
				},
				userId: resolved.userId,
			});
			Logger.info("IDP linked successfully, creating session");

			return LoginIdpIntent.sessionResult(ctx, t, resolved.userId, h);
		} catch (error) {
			Logger.error("Error linking IDP", error);
			const errorMessage = error instanceof Error ? error.message : t("errors.unknownError");
			let params = buildRedirectParams({ error: errorMessage });
			if (isClassifiedError(error) && error.code === Code.AlreadyExists) {
				params = buildRedirectParams({ error: "external_idp_taken" });
			}
			return { redirect: `/idp/${provider}/linking-failed?${params}` };
		}
	}

	/** CASE 2: the user exists and signs in. */
	private static async handleUserExists(h: IDPHandlerContext): Promise<IDPHandlerResult> {
		const { sessionId } = h.params;
		const { userId } = h.intent;
		const { ctx, options, serviceConfig, t } = h;

		if (!userId || sessionId) return null;

		// Auto-update (UpdateUser applies the action's metadata in the same request)
		const updateUserRequest = options?.isAutoUpdate
			? LoginIdpIntent.buildUpdateUserRequest(h.intent, userId)
			: undefined;
		if (updateUserRequest) {
			try {
				await ZitadelAPI.updateUser({ serviceConfig, request: updateUserRequest });
			} catch (error) {
				Logger.warn("Failed to auto-update user", error);
			}
		}

		await InstanceRoles.syncFromIdpIntent({ serviceConfig, intent: h.intent, userId });

		return LoginIdpIntent.sessionResult(ctx, t, userId, h);
	}

	/** CASE 3: auto-linking by verified email or username. */
	private static async handleAutoLinking(h: IDPHandlerContext): Promise<IDPHandlerResult> {
		const { ctx, options, intent, serviceConfig, buildRedirectParams, t } = h;
		const { idpInformation } = intent;
		const createUserData = LoginIdpIntent.resolveCreateUser(intent);
		const { organization, provider } = h.params;

		if (!options?.autoLinking) return null;

		let foundUser: Awaited<ReturnType<typeof ZitadelAPI.listUsers>>["result"][number] | null | undefined;
		const email = createUserData?.email?.email;
		const emailVerified =
			createUserData?.email?.verification?.case === "isVerified" && createUserData?.email?.verification?.value;

		if (options.autoLinking === AutoLinkingOption.EMAIL && email && emailVerified) {
			foundUser = (await ZitadelAPI.listUsers({ serviceConfig, email, organizationId: organization })).result?.[0];
		} else if (options.autoLinking === AutoLinkingOption.USERNAME) {
			foundUser = (
				await ZitadelAPI.listUsers({
					serviceConfig,
					userName: idpInformation?.userName,
					organizationId: organization,
				})
			).result?.[0];
		}

		if (!foundUser) return null;

		try {
			if (!foundUser.details?.resourceOwner) {
				Logger.error("Found user missing organization information");
				return {
					redirect: `/idp/${provider}/linking-failed?${buildRedirectParams()}&error=missing_organization`,
				};
			}

			const isAllowed = await LoginIdpIntent.validateIDPLinkingPermissions({
				serviceConfig,
				userOrganizationId: foundUser.details.resourceOwner,
				idpId: idpInformation?.idpId as string,
			});
			if (!isAllowed) {
				Logger.error("Auto-linking validation failed");
				return { redirect: `/idp/${provider}/linking-failed?${buildRedirectParams()}&error=validation_failed` };
			}

			await ZitadelAPI.addIDPLink({
				serviceConfig,
				idp: {
					id: idpInformation?.idpId as string,
					userId: idpInformation?.userId as string,
					userName: idpInformation?.userName as string,
				},
				userId: foundUser.userId,
			});
			Logger.info("User auto-linked successfully, creating session");

			// otherwise an auto-linked user would only receive its roles on the next login
			await InstanceRoles.syncFromIdpIntent({ serviceConfig, intent, userId: foundUser.userId });

			return LoginIdpIntent.sessionResult(ctx, t, foundUser.userId, h);
		} catch (error) {
			Logger.error("Error auto-linking user", error);
			const errorMessage = error instanceof Error ? error.message : t("errors.unknownError");
			return { redirect: `/idp/${provider}/linking-failed?${buildRedirectParams({ error: errorMessage })}` };
		}
	}

	/** Parameters for the complete-registration form (the token is needed to create the session). */
	private static completeRegistrationParams(h: IDPHandlerContext, org: string, data: ResolvedCreateUser) {
		const { idpInformation } = h.intent;
		return h.buildRedirectParams(
			{
				organization: org,
				idpId: idpInformation?.idpId as string,
				idpUserId: idpInformation?.userId as string,
				idpUserName: idpInformation?.userName || "",
				givenName: data.profile?.givenName || "",
				familyName: data.profile?.familyName || "",
				email: data.email?.email || "",
			},
			true,
		);
	}

	/** CASE 4: auto-creation of the user. */
	private static async handleAutoCreation(h: IDPHandlerContext): Promise<IDPHandlerResult> {
		const { ctx, options, intent, serviceConfig, buildRedirectParams, t } = h;
		const { idpInformation } = intent;
		const createUserData = LoginIdpIntent.resolveCreateUser(intent);
		const { organization, provider } = h.params;

		if (!options?.isAutoCreation || !createUserData) return null;

		const orgToRegisterOn = await LoginIdpIntent.resolveOrganizationForUser({
			organization,
			createUserData,
			serviceConfig,
		});
		if (!orgToRegisterOn) {
			Logger.error("Could not determine organization for auto-creation (no default org available)");
			return { redirect: `/idp/${provider}/failure?${buildRedirectParams()}&error=no_organization_context` };
		}

		// required profile fields missing: let the user complete them
		if (!createUserData.profile?.givenName || !createUserData.profile?.familyName) {
			if (!idpInformation?.userId) {
				Logger.error("IDP intent missing userId, cannot redirect to complete registration");
				return { redirect: `/idp/${provider}/failure?${buildRedirectParams()}&error=missing_idp_user_info` };
			}
			const params = LoginIdpIntent.completeRegistrationParams(h, orgToRegisterOn, createUserData);
			return { redirect: `/idp/${provider}/complete-registration?${params}` };
		}

		const createUserRequest = LoginIdpIntent.buildCreateUserRequest(intent, orgToRegisterOn);
		if (!createUserRequest) {
			Logger.error("Could not build create user request from intent");
			return { redirect: `/idp/${provider}/failure?${buildRedirectParams()}&error=user_creation_failed` };
		}

		try {
			const newUser = await ZitadelAPI.createUser({ serviceConfig, request: createUserRequest });
			Logger.info("User auto-created successfully, creating session");

			await InstanceRoles.syncFromIdpIntent({ serviceConfig, intent, userId: newUser.id });

			return LoginIdpIntent.sessionResult(ctx, t, newUser.id, h);
		} catch (error) {
			Logger.error("Error auto-creating user", error);
			return { redirect: `/idp/${provider}/failure?${buildRedirectParams()}&error=user_creation_failed` };
		}
	}

	/** CASE 5: manual registration allowed. */
	private static async handleManualCreation(h: IDPHandlerContext): Promise<IDPHandlerResult> {
		const { options, intent, serviceConfig, buildRedirectParams } = h;
		const { idpInformation } = intent;
		const createUserData = LoginIdpIntent.resolveCreateUser(intent);
		const { organization, provider } = h.params;

		if (!options?.isCreationAllowed || !createUserData) return null;

		const orgToRegisterOn = await LoginIdpIntent.resolveOrganizationForUser({
			organization,
			createUserData,
			serviceConfig,
		});
		if (!orgToRegisterOn) {
			Logger.error("Could not determine organization for registration (no default org available)");
			return { redirect: `/idp/${provider}/registration-failed?${buildRedirectParams()}` };
		}

		if (!idpInformation?.userId) {
			Logger.error("IDP intent missing userId, cannot redirect to complete registration");
			return { redirect: `/idp/${provider}/failure?${buildRedirectParams()}&error=missing_idp_user_info` };
		}

		const params = LoginIdpIntent.completeRegistrationParams(h, orgToRegisterOn, createUserData);
		return { redirect: `/idp/${provider}/complete-registration?${params}` };
	}

	/** CASE 6: no matching user and creation not allowed. */
	private static async handleNoUserFound(h: IDPHandlerContext): Promise<IDPHandlerResult> {
		return { redirect: `/idp/${h.params.provider}/account-not-found?${h.buildRedirectParams()}` };
	}

	/** Consumes the intent token once and runs all IdP business logic. */
	static async processIDPCallback(
		ctx: LoginContext,
		{
			provider,
			id,
			token,
			requestId,
			organization,
			postErrorRedirectUrl,
			sessionId,
			linkFingerprint,
		}: {
			provider: string;
			id: string;
			token: string;
			requestId?: string;
			organization?: string;
			postErrorRedirectUrl?: string;
			sessionId?: string;
			linkFingerprint?: string;
		},
	): Promise<FlowResult> {
		const serviceConfig = ctx.serviceConfig;
		const t = await ctx.t("idp");

		if (!provider || !id || !token) {
			Logger.error("Missing required parameters", { provider, id, hasToken: !!token });
			const errorParams = new URLSearchParams();
			if (requestId) errorParams.set("requestId", requestId);
			if (organization) errorParams.set("organization", organization);
			if (postErrorRedirectUrl) errorParams.set("postErrorRedirectUrl", postErrorRedirectUrl);
			return { redirect: `/idp/${provider}/failure?${errorParams}` };
		}

		try {
			// consume the single-use token ONCE
			const intent = await ZitadelAPI.retrieveIDPIntent({ serviceConfig, id, token });

			if (!intent.idpInformation) {
				Logger.error("IDP information missing");
				return { redirect: `/idp/${provider}/failure?error=missing_idp_info` };
			}

			const idp = await ZitadelAPI.getIDPByID({ serviceConfig, id: intent.idpInformation.idpId });
			if (!idp) return { error: t("errors.idpNotFound") };

			const buildRedirectParams = (additionalParams?: Record<string, string>, includeToken = false) => {
				const params = new URLSearchParams();
				params.set("id", id);
				if (includeToken) params.set("token", token);
				if (requestId) params.set("requestId", requestId);
				if (organization) params.set("organization", organization);
				if (postErrorRedirectUrl) params.set("postErrorRedirectUrl", postErrorRedirectUrl);
				if (sessionId) params.set("linkToSessionId", sessionId);
				for (const [key, value] of Object.entries(additionalParams ?? {})) {
					if (value) params.set(key, value);
				}
				return params.toString();
			};

			const h: IDPHandlerContext = {
				ctx,
				serviceConfig,
				t,
				intent,
				idp,
				options: idp.config?.options,
				params: { provider, id, token, requestId, organization, postErrorRedirectUrl, sessionId, linkFingerprint },
				buildRedirectParams,
			};

			for (const handler of [
				LoginIdpIntent.handleExplicitLinking,
				LoginIdpIntent.handleUserExists,
				LoginIdpIntent.handleAutoLinking,
				LoginIdpIntent.handleAutoCreation,
				LoginIdpIntent.handleManualCreation,
				LoginIdpIntent.handleNoUserFound,
			]) {
				const result = await handler(h);
				if (result) return result;
			}

			return { error: t("errors.unknown") };
		} catch (error) {
			Logger.error("Error processing intent", error);

			const errorParams = new URLSearchParams();
			if (requestId) errorParams.set("requestId", requestId);
			if (organization) errorParams.set("organization", organization);
			if (postErrorRedirectUrl) errorParams.set("postErrorRedirectUrl", postErrorRedirectUrl);
			errorParams.set("error", error instanceof Error ? error.message : t("errors.unknownError"));
			return { redirect: `/idp/${provider}/failure?${errorParams}` };
		}
	}
}
