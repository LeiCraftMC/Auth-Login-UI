/**
 * Instance role sync for ZITADEL IdPs with `instanceRolesInfo` (e.g. support access) — port of the
 * Zitadel login's `lib/server/instance-roles.ts`.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { Logger } from "../utils/logger";
import { type ServiceConfig, ZitadelAPI } from "../zitadel/api";
import type { InstanceRolesInfo } from "../zitadel/proto/zitadel/idp/v2/idp_pb";

const ZITADEL_PROJECT_ROLES_CLAIM = "urn:zitadel:iam:org:project:roles";
const IAM_ROLE_PREFIX = "IAM_";

export class InstanceRoles {
	/**
	 * Instance roles (IAM_ prefix) from the project-roles claim (`{role: {orgId: orgDomain}}`),
	 * only for grants of an organization configured in `instanceRolesInfo` (id AND domain match).
	 * Mirrors login v1 (external_provider_handler.go).
	 */
	static instanceRolesFromClaim(
		rawInformation: unknown,
		rolesInfo: Pick<InstanceRolesInfo, "organizationId" | "organizationDomain">[],
	): string[] {
		const raw = rawInformation as Record<string, unknown> | undefined | null;
		const claim = raw?.[ZITADEL_PROJECT_ROLES_CLAIM];
		if (!claim || typeof claim !== "object" || Array.isArray(claim)) return [];

		const roles: string[] = [];
		for (const [role, orgs] of Object.entries(claim as Record<string, unknown>)) {
			if (!role.startsWith(IAM_ROLE_PREFIX)) continue;
			if (!orgs || typeof orgs !== "object" || Array.isArray(orgs)) continue;

			const granted = Object.entries(orgs as Record<string, unknown>).some(
				([orgId, orgDomain]) =>
					typeof orgDomain === "string" &&
					rolesInfo.some(
						(info) => info.organizationId === orgId && info.organizationDomain === orgDomain,
					),
			);
			if (granted) roles.push(role);
		}
		// deterministic role set (the claim is a map)
		return roles.sort();
	}

	/**
	 * Adds the claim's instance roles to the user's instance membership. Merge-only, never throws:
	 * a failed sync must not block the login (it is retried on the next login).
	 */
	static async syncFromIdpIntent({
		serviceConfig,
		intent,
		userId,
	}: {
		serviceConfig: ServiceConfig;
		intent: { idpInformation?: { idpId: string; rawInformation?: unknown } | undefined };
		userId: string;
	}): Promise<void> {
		const idpId = intent.idpInformation?.idpId;
		// never log rawInformation (profile PII); the filtered role keys are enough
		let attemptedRoles: string[] = [];
		try {
			if (!idpId || !userId) return;

			const idp = await ZitadelAPI.getIDPByID({ serviceConfig, id: idpId });
			const config = idp?.config?.config;
			if (config?.case !== "zitadel") return;

			const rolesInfo = config.value.instanceRolesInfo;
			if (!rolesInfo?.length) return;

			// Instance-wide grants only from an instance-scoped IdP (fails closed; an org owner must
			// never escalate to instance roles).
			const instanceId = await ZitadelAPI.getInstanceId({ serviceConfig });
			if (!instanceId || idp?.details?.resourceOwner !== instanceId) {
				Logger.warn("Instance role sync skipped: IdP with instanceRolesInfo is not instance-scoped", {
					idpId,
				});
				return;
			}

			const grantedRoles = InstanceRoles.instanceRolesFromClaim(
				intent.idpInformation?.rawInformation,
				rolesInfo,
			);
			if (!grantedRoles.length) return;
			attemptedRoles = grantedRoles;

			const permissions = await ZitadelAPI.permissionService(serviceConfig);
			const instanceResource = { resource: { case: "instance" as const, value: true } };

			// The v2 API rejects the entire write if any role key is unknown to this instance.
			const { administrators } = await permissions.listAdministrators({
				filters: [
					{ filter: { case: "inUserIdsFilter", value: { ids: [userId] } } },
					{ filter: { case: "resource", value: { resource: { case: "instance", value: true } } } },
				],
			});
			const existing = administrators?.find((a) => a.resource?.case === "instance");

			if (!existing) {
				await permissions.createAdministrator({
					userId,
					resource: instanceResource,
					roles: grantedRoles,
				});
				Logger.info("Added instance administrator from ZITADEL IdP roles", {
					userId,
					roles: grantedRoles,
				});
				return;
			}

			// Merge-only read-modify-write (known limitation, same as the Zitadel login).
			const merged = Array.from(new Set([...existing.roles, ...grantedRoles]));
			if (merged.length === existing.roles.length) return;
			attemptedRoles = merged;

			await permissions.updateAdministrator({ userId, resource: instanceResource, roles: merged });
			Logger.info("Updated instance administrator from ZITADEL IdP roles", { userId, roles: merged });
		} catch (error) {
			const context = { userId, idpId, roles: attemptedRoles };
			if (error instanceof ConnectError && error.code === Code.PermissionDenied) {
				Logger.error(
					"Instance role sync failed permanently: the system user lacks permission to manage instance administrators (iam.member.write)",
					{ ...context, message: error.message },
				);
				return;
			}
			if (error instanceof ConnectError && error.code === Code.InvalidArgument) {
				Logger.error(
					"Instance role sync failed permanently: administrator write rejected, likely a role key unknown to this instance",
					{ ...context, message: error.message },
				);
				return;
			}
			Logger.warn("Could not synchronize instance roles from IdP intent", { ...context, error });
		}
	}
}
