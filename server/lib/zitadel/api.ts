/**
 * ZitadelAPI — every Zitadel v2 call the login makes (port of the Zitadel login's `lib/zitadel.ts`).
 *
 * Settings lookups go through a per-instance stale-while-revalidate cache (`API_CACHE_ENABLED`,
 * `API_CACHE_CONFIG`), exactly like the Zitadel login. All methods take a `serviceConfig` that
 * selects the instance (see {@link ZitadelClient}).
 */
import { create } from "@bufbuild/protobuf";
import type { Duration } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";
import { PromiseCache } from "./cache";
import { type ServiceConfig, type WithServiceConfig, ZitadelClient } from "./client";
import { isClassifiedError } from "./errors";
import { IdentityProviderService } from "./proto/zitadel/idp/v2/idp_service_pb";
import { InternalPermissionService } from "./proto/zitadel/internal_permission/v2/internal_permission_service_pb";
import {
	OrganizationSchema,
	RequestContextSchema,
	TextQueryMethod,
} from "./proto/zitadel/object/v2/object_pb";
import { type CreateCallbackRequest, OIDCService } from "./proto/zitadel/oidc/v2/oidc_service_pb";
import type { Organization } from "./proto/zitadel/org/v2/org_pb";
import { OrganizationService } from "./proto/zitadel/org/v2/org_service_pb";
import { type CreateResponseRequest, SAMLService } from "./proto/zitadel/saml/v2/saml_service_pb";
import type { RequestChallenges } from "./proto/zitadel/session/v2/challenge_pb";
import type { UserAgent } from "./proto/zitadel/session/v2/session_pb";
import { type Checks, SessionService } from "./proto/zitadel/session/v2/session_service_pb";
import type { LoginSettings } from "./proto/zitadel/settings/v2/login_settings_pb";
import { SettingsService } from "./proto/zitadel/settings/v2/settings_service_pb";
import { SendEmailVerificationCodeSchema } from "./proto/zitadel/user/v2/email_pb";
import { type FormData, RedirectURLsSchema } from "./proto/zitadel/user/v2/idp_pb";
import { NotificationType, SendPasswordResetLinkSchema } from "./proto/zitadel/user/v2/password_pb";
import { type SearchQuery, SearchQuerySchema } from "./proto/zitadel/user/v2/query_pb";
import { SendInviteCodeSchema } from "./proto/zitadel/user/v2/user_pb";
import {
	type AddHumanUserRequest,
	AddHumanUserRequestSchema,
	type CreateUserRequest,
	type ResendEmailCodeRequest,
	ResendEmailCodeRequestSchema,
	SendEmailCodeRequestSchema,
	type SetPasswordRequest,
	SetPasswordRequestSchema,
	type UpdateUserRequest,
	UserService,
	type VerifyPasskeyRegistrationRequest,
	type VerifyU2FRegistrationRequest,
} from "./proto/zitadel/user/v2/user_service_pb";

export type { ServiceConfig, WithServiceConfig };

/** `(key, data?) => string` for one message namespace. */
export type Translate = (key: string, data?: Record<string, string | number | undefined>) => string;

type CacheConfig = Record<string, number>;

// RedirectURLs.login_hint is validated with max_len 200 by the API.
const MAX_LOGIN_HINT_LENGTH = 200;

const USER_LOOKUP_QUERY = { limit: 2 };

export class ZitadelAPI {
	private static cache: PromiseCache | null = null;
	private static cacheConfig: CacheConfig | null = null;

	private static getCacheConfig(): CacheConfig {
		if (ZitadelAPI.cacheConfig) return ZitadelAPI.cacheConfig;
		let parsed: CacheConfig = {};
		const raw = ConfigHandler.getConfig()?.API_CACHE_CONFIG;
		if (raw) {
			try {
				parsed = JSON.parse(raw);
			} catch (error) {
				Logger.error("Failed to parse API_CACHE_CONFIG", error);
			}
		}
		ZitadelAPI.cacheConfig = parsed;
		return parsed;
	}

	private static getCache() {
		ZitadelAPI.cache ??= new PromiseCache(Number(ZitadelAPI.getCacheConfig().maxSize) || 100);
		return ZitadelAPI.cache;
	}

	/** Test helper: drop cached settings and the parsed cache config. */
	static resetCache() {
		ZitadelAPI.cache = null;
		ZitadelAPI.cacheConfig = null;
	}

	private static ttl(key: string, long: boolean) {
		const config = ZitadelAPI.getCacheConfig();
		const configured = config[key];
		if (typeof configured === "number" && !Number.isNaN(configured)) {
			return configured * 60 * 1000;
		}
		return (long ? (config.longMinutes ?? 60) : (config.defaultMinutes ?? 15)) * 60 * 1000;
	}

	/** Cache key scoped to the instance (`instanceHost`, or "default" for single-tenant setups). */
	private static cached<T>(
		serviceConfig: ServiceConfig,
		key: string,
		ttlKey: string,
		long: boolean,
		fetcher: () => Promise<T>,
	): Promise<T> {
		if (ConfigHandler.getConfig()?.API_CACHE_ENABLED === false) {
			return fetcher();
		}
		return ZitadelAPI.getCache().getOrFetch(
			`${serviceConfig.instanceHost || "default"}:${key}`,
			fetcher,
			ZitadelAPI.ttl(ttlKey, long),
		);
	}

	static makeReqCtx(orgId: string | undefined) {
		return create(RequestContextSchema, {
			resourceOwner: orgId ? { case: "orgId", value: orgId } : { case: "instance", value: true },
		});
	}

	// --- Settings ----------------------------------------------------------------

	static getHostedLoginTranslation({
		serviceConfig,
		organization,
		locale,
	}: WithServiceConfig<{ organization?: string; locale?: string }>) {
		return ZitadelAPI.cached(
			serviceConfig,
			`getHostedLoginTranslation-${organization || "instance"}-${locale || "default"}`,
			"getHostedLoginTranslation",
			true,
			async () => {
				const settings = await ZitadelClient.service(SettingsService, serviceConfig);
				const resp = await settings.getHostedLoginTranslation({
					level: organization
						? { case: "organizationId", value: organization }
						: { case: "instance", value: true },
					locale,
				});
				return resp.translations ? resp.translations : undefined;
			},
		);
	}

	static getBrandingSettings({
		serviceConfig,
		organization,
	}: WithServiceConfig<{ organization?: string }>) {
		return ZitadelAPI.cached(
			serviceConfig,
			`getBrandingSettings-${organization || "instance"}`,
			"getBrandingSettings",
			true,
			async () => {
				const settings = await ZitadelClient.service(SettingsService, serviceConfig);
				const resp = await settings.getBrandingSettings({ ctx: ZitadelAPI.makeReqCtx(organization) });
				return resp.settings ? resp.settings : undefined;
			},
		);
	}

	/**
	 * The ID of the instance the login is serving: the default login settings (queried without
	 * organization context) are owned by the instance.
	 */
	static getInstanceId({ serviceConfig }: WithServiceConfig) {
		return ZitadelAPI.cached(serviceConfig, "getInstanceId", "getLoginSettings", false, async () => {
			const settings = await ZitadelClient.service(SettingsService, serviceConfig);
			const resp = await settings.getLoginSettings({ ctx: ZitadelAPI.makeReqCtx(undefined) });
			return resp.details?.resourceOwner;
		});
	}

	static getLoginSettings({
		serviceConfig,
		organization,
	}: WithServiceConfig<{ organization?: string }>) {
		return ZitadelAPI.cached(
			serviceConfig,
			`getLoginSettings-${organization || "instance"}`,
			"getLoginSettings",
			false,
			async () => {
				const settings = await ZitadelClient.service(SettingsService, serviceConfig);
				const resp = await settings.getLoginSettings({ ctx: ZitadelAPI.makeReqCtx(organization) });
				return resp.settings ? resp.settings : undefined;
			},
		);
	}

	static getSecuritySettings({ serviceConfig }: WithServiceConfig) {
		return ZitadelAPI.cached(
			serviceConfig,
			"getSecuritySettings-instance",
			"getSecuritySettings",
			false,
			async () => {
				const settings = await ZitadelClient.service(SettingsService, serviceConfig);
				const resp = await settings.getSecuritySettings({});
				return resp.settings ? resp.settings : undefined;
			},
		);
	}

	static getLockoutSettings({ serviceConfig, orgId }: WithServiceConfig<{ orgId?: string }>) {
		return ZitadelAPI.cached(
			serviceConfig,
			`getLockoutSettings-${orgId || "instance"}`,
			"getLockoutSettings",
			false,
			async () => {
				const settings = await ZitadelClient.service(SettingsService, serviceConfig);
				const resp = await settings.getLockoutSettings({ ctx: ZitadelAPI.makeReqCtx(orgId) });
				return resp.settings ? resp.settings : undefined;
			},
		);
	}

	static getPasswordExpirySettings({ serviceConfig, orgId }: WithServiceConfig<{ orgId?: string }>) {
		return ZitadelAPI.cached(
			serviceConfig,
			`getPasswordExpirySettings-${orgId || "instance"}`,
			"getPasswordExpirySettings",
			false,
			async () => {
				const settings = await ZitadelClient.service(SettingsService, serviceConfig);
				const resp = await settings.getPasswordExpirySettings({ ctx: ZitadelAPI.makeReqCtx(orgId) });
				return resp.settings ? resp.settings : undefined;
			},
		);
	}

	static getAllowedLanguages({ serviceConfig }: WithServiceConfig) {
		return ZitadelAPI.cached(
			serviceConfig,
			"getGeneralSettings-instance",
			"getGeneralSettings",
			true,
			async () => {
				const settings = await ZitadelClient.service(SettingsService, serviceConfig);
				const resp = await settings.getGeneralSettings({});
				return { allowedLanguages: resp.allowedLanguages, defaultLanguage: resp.defaultLanguage };
			},
		);
	}

	static getLegalAndSupportSettings({
		serviceConfig,
		organization,
	}: WithServiceConfig<{ organization?: string }>) {
		return ZitadelAPI.cached(
			serviceConfig,
			`getLegalAndSupportSettings-${organization || "instance"}`,
			"getLegalAndSupportSettings",
			true,
			async () => {
				const settings = await ZitadelClient.service(SettingsService, serviceConfig);
				const resp = await settings.getLegalAndSupportSettings({
					ctx: ZitadelAPI.makeReqCtx(organization),
				});
				return resp.settings ? resp.settings : undefined;
			},
		);
	}

	static getPasswordComplexitySettings({
		serviceConfig,
		organization,
	}: WithServiceConfig<{ organization?: string }>) {
		return ZitadelAPI.cached(
			serviceConfig,
			`getPasswordComplexitySettings-${organization || "instance"}`,
			"getPasswordComplexitySettings",
			false,
			async () => {
				const settings = await ZitadelClient.service(SettingsService, serviceConfig);
				const resp = await settings.getPasswordComplexitySettings({
					ctx: ZitadelAPI.makeReqCtx(organization),
				});
				return resp.settings ? resp.settings : undefined;
			},
		);
	}

	static async getActiveIdentityProviders({
		serviceConfig,
		orgId,
		linking_allowed,
	}: WithServiceConfig<{ orgId?: string; linking_allowed?: boolean }>) {
		const settings = await ZitadelClient.service(SettingsService, serviceConfig);
		return settings.getActiveIdentityProviders({
			ctx: ZitadelAPI.makeReqCtx(orgId),
			...(linking_allowed ? { linkingAllowed: linking_allowed } : {}),
		});
	}

	// --- Sessions ----------------------------------------------------------------

	static async createSessionFromChecksAndChallenges({
		serviceConfig,
		checks,
		challenges,
		lifetime,
		userAgent,
	}: WithServiceConfig<{
		checks: Checks;
		challenges?: RequestChallenges;
		lifetime: Duration;
		userAgent: UserAgent;
	}>) {
		const sessions = await ZitadelClient.service(SessionService, serviceConfig);
		return sessions.createSession({
			checks,
			lifetime,
			userAgent,
			...(challenges ? { challenges } : {}),
		});
	}

	static async createSessionForUserIdAndIdpIntent({
		serviceConfig,
		userId,
		idpIntent,
		lifetime,
		userAgent,
	}: WithServiceConfig<{
		userId: string;
		idpIntent: { idpIntentId?: string; idpIntentToken?: string };
		lifetime: Duration;
		userAgent: UserAgent;
	}>) {
		const sessions = await ZitadelClient.service(SessionService, serviceConfig);
		return sessions.createSession({
			checks: {
				user: { search: { case: "userId", value: userId } },
				idpIntent,
			},
			lifetime,
			userAgent,
		});
	}

	static async setSession({
		serviceConfig,
		sessionId,
		sessionToken,
		challenges,
		checks,
		lifetime,
	}: WithServiceConfig<{
		sessionId: string;
		sessionToken: string;
		challenges: RequestChallenges | undefined;
		checks?: Checks;
		lifetime: Duration;
	}>) {
		const sessions = await ZitadelClient.service(SessionService, serviceConfig);
		return sessions.setSession({
			sessionId,
			sessionToken,
			challenges,
			checks: checks ? checks : {},
			metadata: {},
			lifetime,
		});
	}

	static async getSession({
		serviceConfig,
		sessionId,
		sessionToken,
	}: WithServiceConfig<{ sessionId: string; sessionToken: string }>) {
		const sessions = await ZitadelClient.service(SessionService, serviceConfig);
		return sessions.getSession({ sessionId, sessionToken });
	}

	static async deleteSession({
		serviceConfig,
		sessionId,
		sessionToken,
	}: WithServiceConfig<{ sessionId: string; sessionToken: string }>) {
		const sessions = await ZitadelClient.service(SessionService, serviceConfig);
		return sessions.deleteSession({ sessionId, sessionToken });
	}

	static async listSessions({ serviceConfig, ids }: WithServiceConfig<{ ids: string[] }>) {
		const sessions = await ZitadelClient.service(SessionService, serviceConfig);
		return sessions.listSessions({
			queries: [{ query: { case: "idsQuery", value: { ids } } }],
		});
	}

	// --- Users -------------------------------------------------------------------

	static async addHumanUser({
		serviceConfig,
		email,
		firstName,
		lastName,
		password,
		organization,
	}: WithServiceConfig<{
		firstName: string;
		lastName: string;
		email: string;
		password?: string;
		organization: string;
	}>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);

		let request: AddHumanUserRequest = create(AddHumanUserRequestSchema, {
			email: { email, verification: { case: "isVerified", value: false } },
			username: email,
			profile: { givenName: firstName, familyName: lastName },
			passwordType: password ? { case: "password", value: { password } } : undefined,
		});

		if (organization) {
			request = {
				...request,
				organization: create(OrganizationSchema, { org: { case: "orgId", value: organization } }),
			};
		}

		return users.addHumanUser(request);
	}

	/** Non-deprecated CreateUser (supports user metadata). */
	static async createUser({
		serviceConfig,
		request,
	}: WithServiceConfig<{ request: CreateUserRequest }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.createUser(request);
	}

	/** Non-deprecated UpdateUser (can update metadata in the same request). */
	static async updateUser({
		serviceConfig,
		request,
	}: WithServiceConfig<{ request: UpdateUserRequest }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.updateUser(request);
	}

	static async getUserByID({ serviceConfig, userId }: WithServiceConfig<{ userId: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.getUserByID({ userId });
	}

	static async humanMFAInitSkipped({
		serviceConfig,
		userId,
	}: WithServiceConfig<{ userId: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.humanMFAInitSkipped({ userId });
	}

	static async listAuthenticationMethodTypes({
		serviceConfig,
		userId,
	}: WithServiceConfig<{ userId: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.listAuthenticationMethodTypes({ userId });
	}

	static async listIDPLinks({ serviceConfig, userId }: WithServiceConfig<{ userId: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.listIDPLinks({ userId });
	}

	static async addIDPLink({
		serviceConfig,
		idp,
		userId,
	}: WithServiceConfig<{ idp: { id: string; userId: string; userName: string }; userId: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.addIDPLink({
			idpLink: { userId: idp.userId, idpId: idp.id, userName: idp.userName },
			userId,
		});
	}

	static async addOTPEmail({ serviceConfig, userId }: WithServiceConfig<{ userId: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.addOTPEmail({ userId });
	}

	static async addOTPSMS({ serviceConfig, userId }: WithServiceConfig<{ userId: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.addOTPSMS({ userId });
	}

	static async registerTOTP({ serviceConfig, userId }: WithServiceConfig<{ userId: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.registerTOTP({ userId });
	}

	static async verifyTOTPRegistration({
		serviceConfig,
		code,
		userId,
	}: WithServiceConfig<{ code: string; userId: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.verifyTOTPRegistration({ code, userId });
	}

	static async verifyInviteCode({
		serviceConfig,
		userId,
		verificationCode,
	}: WithServiceConfig<{ userId: string; verificationCode: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.verifyInviteCode({ userId, verificationCode });
	}

	static async verifyEmail({
		serviceConfig,
		userId,
		verificationCode,
	}: WithServiceConfig<{ userId: string; verificationCode: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.verifyEmail({ userId, verificationCode });
	}

	static async sendEmailCode({
		serviceConfig,
		userId,
		urlTemplate,
	}: WithServiceConfig<{ userId: string; urlTemplate: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.sendEmailCode(
			create(SendEmailCodeRequestSchema, {
				userId,
				verification: {
					case: "sendCode",
					value: create(SendEmailVerificationCodeSchema, { urlTemplate }),
				},
			}),
		);
	}

	static async resendEmailCode({
		serviceConfig,
		userId,
		urlTemplate,
	}: WithServiceConfig<{ userId: string; urlTemplate: string }>) {
		let request: ResendEmailCodeRequest = create(ResendEmailCodeRequestSchema, { userId });
		request = {
			...request,
			verification: {
				case: "sendCode",
				value: create(SendEmailVerificationCodeSchema, { urlTemplate }),
			},
		};

		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.resendEmailCode(request);
	}

	static async createInviteCode({
		serviceConfig,
		urlTemplate,
		userId,
	}: WithServiceConfig<{ urlTemplate: string; userId: string }>) {
		const medium = create(SendInviteCodeSchema, {
			applicationName: ConfigHandler.getConfig()?.APPLICATION_NAME ?? "LeiCraftMC Auth",
			urlTemplate,
		});

		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.createInviteCode({ userId, verification: { case: "sendCode", value: medium } });
	}

	static async passwordReset({
		serviceConfig,
		userId,
		urlTemplate,
	}: WithServiceConfig<{ userId: string; urlTemplate?: string }>) {
		const medium = create(SendPasswordResetLinkSchema, {
			notificationType: NotificationType.Email,
			urlTemplate,
		});

		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.passwordReset({ userId, medium: { case: "sendLink", value: medium } });
	}

	static async setUserPassword({
		serviceConfig,
		userId,
		password,
		code,
	}: WithServiceConfig<{ userId: string; password: string; code?: string }>) {
		let payload = create(SetPasswordRequestSchema, { userId, newPassword: { password } });

		if (code) {
			payload = { ...payload, verification: { case: "verificationCode", value: code } };
		}

		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.setPassword(payload).catch((error) => {
			// Failed precondition (e.g. the user is not initialized yet) is reported, not thrown.
			if (isClassifiedError(error) && error.code === Code.FailedPrecondition && error.message) {
				return { error: error.message };
			}
			throw error;
		});
	}

	static async setPassword({
		serviceConfig,
		payload,
	}: WithServiceConfig<{ payload: SetPasswordRequest }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.setPassword(payload);
	}

	static async createPasskeyRegistrationLink({
		serviceConfig,
		userId,
	}: WithServiceConfig<{ userId: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.createPasskeyRegistrationLink({ userId, medium: { case: "returnCode", value: {} } });
	}

	static async registerPasskey({
		serviceConfig,
		userId,
		code,
		domain,
	}: WithServiceConfig<{ userId: string; code: { id: string; code: string }; domain: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.registerPasskey({ userId, code, domain });
	}

	static async verifyPasskeyRegistration({
		serviceConfig,
		request,
	}: WithServiceConfig<{ request: VerifyPasskeyRegistrationRequest }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.verifyPasskeyRegistration(request);
	}

	static async registerU2F({
		serviceConfig,
		userId,
		domain,
	}: WithServiceConfig<{ userId: string; domain: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.registerU2F({ userId, domain });
	}

	static async verifyU2FRegistration({
		serviceConfig,
		request,
	}: WithServiceConfig<{ request: VerifyU2FRegistrationRequest }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.verifyU2FRegistration(request);
	}

	static async listUsers({
		serviceConfig,
		loginName,
		userName,
		phone,
		email,
		organizationId,
	}: WithServiceConfig<{
		loginName?: string;
		userName?: string;
		email?: string;
		phone?: string;
		organizationId?: string;
	}>) {
		const queries: SearchQuery[] = [];

		// either use loginName or userName, email, phone
		if (loginName) {
			queries.push(
				create(SearchQuerySchema, {
					query: { case: "loginNameQuery", value: { loginName, method: TextQueryMethod.EQUALS } },
				}),
			);
		} else if (userName || email || phone) {
			const orQueries: SearchQuery[] = [];
			if (userName) {
				orQueries.push(
					create(SearchQuerySchema, {
						query: { case: "userNameQuery", value: { userName, method: TextQueryMethod.EQUALS } },
					}),
				);
			}
			if (email) {
				orQueries.push(
					create(SearchQuerySchema, {
						query: { case: "emailQuery", value: { emailAddress: email, method: TextQueryMethod.EQUALS } },
					}),
				);
			}
			if (phone) {
				orQueries.push(
					create(SearchQuerySchema, {
						query: { case: "phoneQuery", value: { number: phone, method: TextQueryMethod.EQUALS } },
					}),
				);
			}
			queries.push(
				create(SearchQuerySchema, { query: { case: "orQuery", value: { queries: orQueries } } }),
			);
		}

		if (organizationId) {
			queries.push(
				create(SearchQuerySchema, {
					query: { case: "organizationIdQuery", value: { organizationId } },
				}),
			);
		}

		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.listUsers({ query: USER_LOOKUP_QUERY, queries });
	}

	/**
	 * The dedicated user search of the login-name page: loginName (or `<value>@<suffix>`) first,
	 * then email/phone unless disabled by the login settings.
	 */
	static async searchUsers({
		serviceConfig,
		searchValue,
		loginSettings,
		organizationId,
		suffix,
		t,
	}: WithServiceConfig<{
		searchValue: string;
		loginSettings: LoginSettings;
		organizationId?: string;
		suffix?: string;
		/** Translations of the `zitadel` namespace. */
		t: Translate;
	}>) {
		const phoneQuery = (value: string) =>
			create(SearchQuerySchema, {
				query: { case: "phoneQuery", value: { number: value, method: TextQueryMethod.EQUALS } },
			});
		const loginNameQuery = (value: string) =>
			create(SearchQuerySchema, {
				query: {
					case: "loginNameQuery",
					value: { loginName: value, method: TextQueryMethod.EQUALS_IGNORE_CASE },
				},
			});
		const emailQuery = (value: string) =>
			create(SearchQuerySchema, {
				query: {
					case: "emailQuery",
					value: { emailAddress: value, method: TextQueryMethod.EQUALS_IGNORE_CASE },
				},
			});
		const orgQuery = (id: string) =>
			create(SearchQuerySchema, {
				query: { case: "organizationIdQuery", value: { organizationId: id } },
			});

		const queries: SearchQuery[] = [
			loginNameQuery(suffix ? `${searchValue}@${suffix}` : searchValue),
		];
		if (organizationId) {
			queries.push(orgQuery(organizationId));
		}

		const users = await ZitadelClient.service(UserService, serviceConfig);

		const loginNameResult = await users.listUsers({ query: USER_LOOKUP_QUERY, queries });

		if (!loginNameResult?.details) {
			return { error: t("errors.errorOccured") };
		}
		if (loginNameResult.result.length > 1) {
			return { error: t("errors.multipleUsersFound") };
		}
		if (loginNameResult.result.length === 1) {
			return loginNameResult;
		}

		const emailAndPhoneQueries: SearchQuery[] = [];
		if (loginSettings.disableLoginWithEmail && loginSettings.disableLoginWithPhone) {
			// Both email and phone login are disabled, return empty result
			return { result: [] };
		} else if (loginSettings.disableLoginWithEmail && searchValue.length <= 20) {
			emailAndPhoneQueries.push(phoneQuery(searchValue));
		} else if (loginSettings.disableLoginWithPhone) {
			emailAndPhoneQueries.push(emailQuery(searchValue));
		} else {
			const orQuery: SearchQuery[] = [emailQuery(searchValue)];
			if (searchValue.length <= 20) {
				orQuery.push(phoneQuery(searchValue));
			}
			emailAndPhoneQueries.push(
				create(SearchQuerySchema, { query: { case: "orQuery", value: { queries: orQuery } } }),
			);
		}

		if (organizationId) {
			emailAndPhoneQueries.push(orgQuery(organizationId));
		}

		const emailOrPhoneResult = await users.listUsers({
			query: USER_LOOKUP_QUERY,
			queries: emailAndPhoneQueries,
		});

		if (!emailOrPhoneResult?.details) {
			return { error: t("errors.errorOccured") };
		}
		if (emailOrPhoneResult.result.length > 1) {
			return { error: t("errors.multipleUsersFound") };
		}
		if (emailOrPhoneResult.result.length === 1) {
			return emailOrPhoneResult;
		}

		// No users found - return empty result, not an error
		return { result: [] };
	}

	// --- Organizations -------------------------------------------------------------

	static getDefaultOrg({ serviceConfig }: WithServiceConfig): Promise<Organization | null> {
		return ZitadelAPI.cached(
			serviceConfig,
			"getDefaultOrg-instance",
			"getDefaultOrg",
			false,
			async () => {
				const orgs = await ZitadelClient.service(OrganizationService, serviceConfig);
				const resp = await orgs.listOrganizations({
					queries: [{ query: { case: "defaultQuery", value: {} } }],
				});
				return resp?.result?.[0] ?? null;
			},
		);
	}

	static async getOrgsByDomain({ serviceConfig, domain }: WithServiceConfig<{ domain: string }>) {
		const orgs = await ZitadelClient.service(OrganizationService, serviceConfig);
		return orgs.listOrganizations({
			queries: [{ query: { case: "domainQuery", value: { domain, method: TextQueryMethod.EQUALS } } }],
		});
	}

	// --- Identity providers --------------------------------------------------------

	static async startIdentityProviderFlow({
		serviceConfig,
		idpId,
		urls,
	}: WithServiceConfig<{
		idpId: string;
		urls: { successUrl: string; failureUrl: string; loginHint?: string };
	}>): Promise<{ url: string; fields?: Record<string, string> } | null> {
		// An empty publicHost keeps Zitadel from pointing the IdP redirect URIs at the login UI.
		const users = await ZitadelClient.service(UserService, { ...serviceConfig, publicHost: "" });

		// The login hint only improves the UX at the IdP, so a hint the API would reject (e.g. an
		// overlong login_hint sent by the RP) is dropped instead of failing the whole IdP flow.
		const { loginHint, ...redirectUrls } = urls;
		const content = create(RedirectURLsSchema, {
			...redirectUrls,
			...(loginHint && loginHint.length <= MAX_LOGIN_HINT_LENGTH && { loginHint }),
		});

		const resp = await users.startIdentityProviderIntent({
			idpId,
			content: { case: "urls", value: content },
		});

		if (resp.nextStep.case === "authUrl" && resp.nextStep.value) {
			return { url: resp.nextStep.value };
		}
		if (resp.nextStep.case === "formData" && resp.nextStep.value) {
			const formData: FormData = resp.nextStep.value;
			return { url: formData.url, fields: formData.fields };
		}
		return null;
	}

	static async startLDAPIdentityProviderFlow({
		serviceConfig,
		idpId,
		username,
		password,
	}: WithServiceConfig<{ idpId: string; username: string; password: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.startIdentityProviderIntent({
			idpId,
			content: { case: "ldap", value: { username, password } },
		});
	}

	static async retrieveIDPIntent({
		serviceConfig,
		id,
		token,
	}: WithServiceConfig<{ id: string; token: string }>) {
		const users = await ZitadelClient.service(UserService, serviceConfig);
		return users.retrieveIdentityProviderIntent({ idpIntentId: id, idpIntentToken: token });
	}

	static async getIDPByID({ serviceConfig, id }: WithServiceConfig<{ id: string }>) {
		const idps = await ZitadelClient.service(IdentityProviderService, serviceConfig);
		return idps.getIDPByID({ id }).then((resp) => resp.idp);
	}

	// --- OIDC / SAML / device --------------------------------------------------------

	static async getAuthRequest({
		serviceConfig,
		authRequestId,
	}: WithServiceConfig<{ authRequestId: string }>) {
		const oidc = await ZitadelClient.service(OIDCService, serviceConfig);
		return oidc.getAuthRequest({ authRequestId });
	}

	static async createCallback({
		serviceConfig,
		req,
	}: WithServiceConfig<{ req: CreateCallbackRequest }>) {
		const oidc = await ZitadelClient.service(OIDCService, serviceConfig);
		return oidc.createCallback(req);
	}

	static async getDeviceAuthorizationRequest({
		serviceConfig,
		userCode,
	}: WithServiceConfig<{ userCode: string }>) {
		const oidc = await ZitadelClient.service(OIDCService, serviceConfig);
		return oidc.getDeviceAuthorizationRequest({ userCode });
	}

	static async authorizeOrDenyDeviceAuthorization({
		serviceConfig,
		deviceAuthorizationId,
		session,
	}: WithServiceConfig<{
		deviceAuthorizationId: string;
		session?: { sessionId: string; sessionToken: string };
	}>) {
		const oidc = await ZitadelClient.service(OIDCService, serviceConfig);
		return oidc.authorizeOrDenyDeviceAuthorization({
			deviceAuthorizationId,
			decision: session ? { case: "session", value: session } : { case: "deny", value: {} },
		});
	}

	static async getSAMLRequest({
		serviceConfig,
		samlRequestId,
	}: WithServiceConfig<{ samlRequestId: string }>) {
		const saml = await ZitadelClient.service(SAMLService, serviceConfig);
		return saml.getSAMLRequest({ samlRequestId });
	}

	static async createResponse({
		serviceConfig,
		req,
	}: WithServiceConfig<{ req: CreateResponseRequest }>) {
		const saml = await ZitadelClient.service(SAMLService, serviceConfig);
		return saml.createResponse(req);
	}

	// --- Instance administrators (IdP role sync) ---------------------------------------

	static permissionService(serviceConfig: ServiceConfig) {
		return ZitadelClient.service(InternalPermissionService, serviceConfig);
	}
}
