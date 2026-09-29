/**
 * User discovery on the login-name page (port of the Zitadel login's `lib/server/loginname.ts`).
 *
 * Finds the user, creates an "identified" session, and routes to the next step (password,
 * passkey, IdP, verification/invite, registration) while keeping known and unknown users
 * indistinguishable when `ignoreUnknownUsernames` (enumeration protection) is on.
 */
import { create } from "@bufbuild/protobuf";
import { Logger } from "../utils/logger";
import { ZitadelAPI } from "../zitadel/api";
import { isClassifiedError } from "../zitadel/errors";
import { ChecksSchema } from "../zitadel/proto/zitadel/session/v2/session_service_pb";
import { PasskeysType } from "../zitadel/proto/zitadel/settings/v2/login_settings_pb";
import type { IDPLink } from "../zitadel/proto/zitadel/user/v2/idp_pb";
import { UserState } from "../zitadel/proto/zitadel/user/v2/user_pb";
import { AuthenticationMethodType } from "../zitadel/proto/zitadel/user/v2/user_service_pb";
import { LoginContext } from "./context";
import { IdpTypes } from "./idpTypes";
import { LoginSessionCookie } from "./sessionCookie";
import type { FlowResult } from "./types";
import { LoginVerify } from "./verify";

export type SendLoginnameCommand = {
	loginName: string;
	requestId?: string;
	organization?: string;
	defaultOrganization?: string;
	suffix?: string;
};

const ORG_SUFFIX_REGEX = /(?<=@)(.+)/;

export class LoginName {
	/** Absolute IdP callback URL (`/idp/<slug>/process|failure?…`) on the public host. */
	static idpCallbackUrl(
		ctx: LoginContext,
		provider: string,
		kind: "process" | "failure",
		params: URLSearchParams,
	) {
		const host = ctx.publicHost();
		return `${host.includes("localhost") ? "http://" : "https://"}${host}${LoginContext.getBasePath()}/idp/${provider}/${kind}?${new URLSearchParams(params)}`;
	}

	/**
	 * `undefined` = nothing to do (the Zitadel login returns nothing when an IdP-only user has no
	 * resolvable IdP; the page stays as it is).
	 */
	static async sendLoginname(
		ctx: LoginContext,
		command: SendLoginnameCommand,
	): Promise<FlowResult | undefined> {
		const serviceConfig = ctx.serviceConfig;
		const t = await ctx.t("loginname");

		const loginSettingsByContext = await ZitadelAPI.getLoginSettings({
			serviceConfig,
			organization: command.organization,
		});

		if (!loginSettingsByContext) {
			return { error: t("errors.couldNotGetLoginSettings") };
		}

		// Enumeration protection is derived server-side from the request-context settings; a
		// client-supplied flag must not be trusted.
		const ignoreUnknownUsernames = !!loginSettingsByContext.ignoreUnknownUsernames;

		const searchResult = await ZitadelAPI.searchUsers({
			serviceConfig,
			searchValue: command.loginName,
			organizationId: command.organization,
			loginSettings: loginSettingsByContext,
			suffix: command.suffix,
			t: await ctx.t("zitadel"),
		});

		if (!searchResult) {
			Logger.error("searchUsers returned undefined or null");
			return { error: t("errors.couldNotSearchUsers") };
		}
		if ("error" in searchResult && searchResult.error) {
			return { error: searchResult.error };
		}
		if (!("result" in searchResult)) {
			return { error: t("errors.couldNotSearchUsers") };
		}

		const users = searchResult.result ?? [];

		const preventUserEnumeration = (organization: string | undefined): FlowResult => {
			if (ignoreUnknownUsernames) {
				const params = new URLSearchParams({ loginName: command.loginName });
				if (command.requestId) params.append("requestId", command.requestId);
				if (organization) params.append("organization", organization);
				return { redirect: `/password?${params}` };
			}
			return { error: t("errors.userNotFound") };
		};

		// With an org domain suffix the user types only the local part.
		const concatLoginname = command.suffix
			? `${command.loginName}@${command.suffix}`
			: command.loginName;

		const startIdpFlow = async (
			idpId: string,
			provider: string,
			params: URLSearchParams,
			loginHint: string,
		): Promise<FlowResult> => {
			const response = await ZitadelAPI.startIdentityProviderFlow({
				serviceConfig,
				idpId,
				urls: {
					successUrl: LoginName.idpCallbackUrl(ctx, provider, "process", params),
					failureUrl: LoginName.idpCallbackUrl(ctx, provider, "failure", params),
					loginHint,
				},
			});

			if (!response?.url) {
				return { error: t("errors.couldNotStartIDPFlow") };
			}
			if (response.fields) {
				return { samlData: { url: response.url, fields: response.fields } };
			}
			return { redirect: response.url };
		};

		const redirectUserToIDP = async (
			userId?: string,
			organization?: string,
		): Promise<FlowResult | undefined> => {
			// user-specific IdP links first
			let identityProviders: IDPLink[] = [];
			if (userId) {
				identityProviders = (await ZitadelAPI.listIDPLinks({ serviceConfig, userId })).result;
			}

			const params = new URLSearchParams();
			if (userId) params.set("userId", userId);
			if (command.requestId) params.set("requestId", command.requestId);
			if (organization) params.set("organization", organization);

			// no links: exactly one active IdP of the organization that may create users
			if (identityProviders.length === 0) {
				const activeIdps = (
					await ZitadelAPI.getActiveIdentityProviders({ serviceConfig, orgId: organization })
				).identityProviders.filter(
					(idp) => idp.options?.isAutoCreation || idp.options?.isCreationAllowed,
				);

				if (activeIdps.length === 1 && activeIdps[0]) {
					const provider = IdpTypes.toSlug(activeIdps[0].type);
					return startIdpFlow(activeIdps[0].id, provider, params, concatLoginname);
				}
			}

			if (identityProviders.length === 1 && identityProviders[0]) {
				const idp = await ZitadelAPI.getIDPByID({ serviceConfig, id: identityProviders[0].idpId });
				const idpType = idp?.type;

				if (!idp || !idpType) {
					throw new Error(t("errors.couldNotFindIdentityProvider"));
				}

				const provider = IdpTypes.toSlug(IdpTypes.fromIdpType(idpType));
				// Already linked: prefer the username the IdP knows the user by (like Login V1).
				return startIdpFlow(idp.id, provider, params, identityProviders[0].userName || concatLoginname);
			}

			return undefined;
		};

		if (users.length > 1) {
			if (ignoreUnknownUsernames) return preventUserEnumeration(command.organization);
			return { error: t("errors.moreThanOneUserFound") };
		}

		if (users.length === 1 && users[0]?.userId) {
			const user = users[0];
			const userId = user.userId;

			const userLoginSettings = await ZitadelAPI.getLoginSettings({
				serviceConfig,
				organization: user.details?.resourceOwner,
			});

			const humanUser = user.type.case === "human" ? user.type.value : undefined;

			// recheck the login settings after discovery (the search may have had no org scope)
			if (userLoginSettings?.disableLoginWithEmail && userLoginSettings?.disableLoginWithPhone) {
				if (user.preferredLoginName !== concatLoginname) {
					return preventUserEnumeration(command.organization);
				}
			} else if (userLoginSettings?.disableLoginWithEmail) {
				if (
					user.preferredLoginName !== concatLoginname &&
					humanUser?.phone?.phone !== command.loginName
				) {
					return preventUserEnumeration(command.organization);
				}
			} else if (userLoginSettings?.disableLoginWithPhone) {
				if (
					user.preferredLoginName !== concatLoginname &&
					humanUser?.email?.email !== command.loginName
				) {
					return preventUserEnumeration(command.organization);
				}
			}

			// With protection on, no session (and no cookie) is created, so known and unknown users
			// stay indistinguishable for the /password page too.
			let session:
				| Awaited<ReturnType<typeof LoginSessionCookie.createSessionAndUpdateCookie>>["session"]
				| undefined;
			if (!ignoreUnknownUsernames) {
				try {
					const result = await LoginSessionCookie.createSessionAndUpdateCookie(ctx, {
						checks: create(ChecksSchema, { user: { search: { case: "userId", value: userId } } }),
						requestId: command.requestId,
					});
					session = result.session;
				} catch (error) {
					if (isClassifiedError(error) && error.message?.includes("Errors.User.NotActive")) {
						return { error: t("errors.userNotActive") };
					}
					throw error;
				}
			}

			if (session && !session.factors?.user?.id) {
				return { error: t("errors.couldNotCreateSession") };
			}

			// Under protection echo the raw input, otherwise use the session's loginName so the next
			// page can match the cookie.
			const redirectLoginName = ignoreUnknownUsernames
				? command.loginName
				: (session?.factors?.user?.loginName ?? user.preferredLoginName);

			if (user.state === UserState.INITIAL) {
				if (ignoreUnknownUsernames) return preventUserEnumeration(command.organization);
				return { error: t("errors.initialUserNotSupported") };
			}

			let organization =
				command.organization ?? session?.factors?.user?.organizationId ?? user.details?.resourceOwner;

			if (ignoreUnknownUsernames) {
				organization = command.organization;
				if (!organization && ORG_SUFFIX_REGEX.test(command.loginName)) {
					const suffix = ORG_SUFFIX_REGEX.exec(command.loginName)?.[1] ?? "";
					const orgs = await ZitadelAPI.getOrgsByDomain({ serviceConfig, domain: suffix });
					if (orgs.result && orgs.result.length === 1 && orgs.result[0]) {
						const orgToCheck = orgs.result[0].id;
						const orgLoginSettings = await ZitadelAPI.getLoginSettings({
							serviceConfig,
							organization: orgToCheck,
						});
						if (orgLoginSettings?.allowDomainDiscovery) {
							organization = orgToCheck;
						}
					}
				}
			}

			const methods = await ZitadelAPI.listAuthenticationMethodTypes({
				serviceConfig,
				userId: session?.factors?.user?.id ?? userId,
			});

			const hasPrimaryMethod =
				methods.authMethodTypes?.some(
					(m) =>
						m === AuthenticationMethodType.PASSWORD ||
						m === AuthenticationMethodType.PASSKEY ||
						m === AuthenticationMethodType.IDP,
				) ?? false;

			// no primary auth method: (re)send the invite / setup email
			if (!hasPrimaryMethod) {
				// An unverified email most likely already has a code from the initial email;
				// re-sending would invalidate it. Only auto-send for verified emails.
				const shouldSend = humanUser?.email?.isVerified === true;

				const codeSent = shouldSend
					? await LoginVerify.trySendVerification(ctx, {
							userId: session?.factors?.user?.id ?? user.userId,
							isInvite: true,
							requestId: command.requestId,
						})
					: false;

				const params = new URLSearchParams({
					loginName: (session?.factors?.user?.loginName ?? user.preferredLoginName) as string,
					invite: "true",
				});
				if (codeSent) params.append("codeSent", "true");
				if (command.requestId) params.append("requestId", command.requestId);
				if (organization) params.append("organization", organization);

				return { redirect: `/verify?${params}` };
			}

			const withContext = (params: URLSearchParams, orgFirst = true) => {
				if (orgFirst) {
					if (organization) params.append("organization", organization);
					if (command.requestId) params.append("requestId", command.requestId);
				} else {
					if (command.requestId) params.append("requestId", command.requestId);
					if (organization) params.append("organization", organization);
				}
				return params;
			};

			if (methods.authMethodTypes.length === 1) {
				const method = methods.authMethodTypes[0];
				switch (method) {
					case AuthenticationMethodType.PASSWORD: {
						if (!userLoginSettings?.allowLocalAuthentication) {
							// an IdP could still be used to register/link
							const idpResp = await redirectUserToIDP(userId, organization);
							if (idpResp && "redirect" in idpResp && idpResp.redirect) return idpResp;

							if (ignoreUnknownUsernames) return preventUserEnumeration(command.organization);
							return { error: t("errors.localAuthenticationNotAllowed") };
						}

						const params = withContext(new URLSearchParams({ loginName: redirectLoginName }));
						return { redirect: `/password?${params}` };
					}

					case AuthenticationMethodType.PASSKEY: {
						if (
							userLoginSettings?.passkeysType === PasskeysType.NOT_ALLOWED ||
							!userLoginSettings?.allowLocalAuthentication
						) {
							if (ignoreUnknownUsernames) return preventUserEnumeration(command.organization);
							return { error: t("errors.passkeysNotAllowed") };
						}

						const params = withContext(new URLSearchParams({ loginName: redirectLoginName }), false);
						return { redirect: `/passkey?${params}` };
					}

					case AuthenticationMethodType.IDP: {
						const resp = await redirectUserToIDP(userId, organization);
						if (resp && "error" in resp && resp.error) return { error: resp.error };
						return resp;
					}
				}
			} else {
				// prefer passkey over other methods
				if (
					methods.authMethodTypes.includes(AuthenticationMethodType.PASSKEY) &&
					userLoginSettings?.passkeysType !== PasskeysType.NOT_ALLOWED &&
					userLoginSettings?.allowLocalAuthentication
				) {
					const params = withContext(
						new URLSearchParams({
							loginName: redirectLoginName,
							// offer password as alternative only if allowed
							altPassword: `${methods.authMethodTypes.includes(AuthenticationMethodType.PASSWORD) && userLoginSettings?.allowLocalAuthentication}`,
						}),
						false,
					);
					return { redirect: `/passkey?${params}` };
				}

				if (methods.authMethodTypes.includes(AuthenticationMethodType.IDP)) {
					return redirectUserToIDP(userId, organization);
				} else if (methods.authMethodTypes.includes(AuthenticationMethodType.PASSWORD)) {
					if (!userLoginSettings?.allowLocalAuthentication) {
						if (ignoreUnknownUsernames) return preventUserEnumeration(command.organization);
						return { error: t("errors.localAuthenticationNotAllowed") };
					}

					const params = withContext(new URLSearchParams({ loginName: redirectLoginName }), false);
					return { redirect: `/password?${params}` };
				}
			}
		}

		// user not found: organization discovery if no org context was provided
		let discoveredOrganization = command.organization;
		let effectiveLoginSettings = loginSettingsByContext;

		if (!command.organization && command.defaultOrganization) {
			const defaultLoginSettings = await ZitadelAPI.getLoginSettings({
				serviceConfig,
				organization: command.defaultOrganization,
			});
			if (defaultLoginSettings) effectiveLoginSettings = defaultLoginSettings;
		}

		if (!discoveredOrganization && command.loginName && ORG_SUFFIX_REGEX.test(command.loginName)) {
			const suffix = ORG_SUFFIX_REGEX.exec(command.loginName)?.[1] ?? "";

			// orgs where the suffix is set as the organization domain
			const orgs = await ZitadelAPI.getOrgsByDomain({ serviceConfig, domain: suffix });
			const orgToCheck = orgs.result && orgs.result.length === 1 ? orgs.result[0]?.id : undefined;

			if (orgToCheck) {
				const orgLoginSettings = await ZitadelAPI.getLoginSettings({
					serviceConfig,
					organization: orgToCheck,
				});
				if (orgLoginSettings?.allowDomainDiscovery) {
					discoveredOrganization = orgToCheck;
					effectiveLoginSettings = orgLoginSettings;
				}
			}
		}

		// Redirect unknown users to an external IdP if local authentication is disabled, or domain
		// discovery resolved an organization (registration policy only governs local accounts).
		// Enumeration protection must not gate the redirect when local auth is disabled: in an
		// IdP-only org known users go to the IdP too, which keeps them indistinguishable.
		if (
			!effectiveLoginSettings?.allowLocalAuthentication ||
			(discoveredOrganization && !ignoreUnknownUsernames)
		) {
			const resp = await redirectUserToIDP(undefined, discoveredOrganization);
			if (resp) return resp;

			if (!effectiveLoginSettings?.allowLocalAuthentication) {
				return preventUserEnumeration(discoveredOrganization);
			}
		}

		if (effectiveLoginSettings?.allowRegister && effectiveLoginSettings?.allowLocalAuthentication) {
			// never register while ignoreUnknownUsernames is set
			if (discoveredOrganization && !effectiveLoginSettings?.ignoreUnknownUsernames) {
				const params = new URLSearchParams({ organization: discoveredOrganization });
				if (command.requestId) params.set("requestId", command.requestId);
				if (command.loginName) params.set("email", command.loginName);
				return { redirect: `/register?${params}` };
			}
		}

		return preventUserEnumeration(discoveredOrganization);
	}
}
