/**
 * Shared bits of the page loaders (the server-component data loading of the Zitadel login pages).
 */
import type { LoginContext } from "../../login/context";
import { ZitadelAPI } from "../../zitadel/api";
import { LoginDTO } from "./shared-models/loginModels";

export class PageHelpers {
	/** The default organization's id, only when the request has no organization context. */
	static async defaultOrganization(
		ctx: LoginContext,
		organization?: string,
	): Promise<string | undefined> {
		if (organization) return undefined;
		const org = await ZitadelAPI.getDefaultOrg({ serviceConfig: ctx.serviceConfig });
		return org?.id || undefined;
	}

	static async branding(ctx: LoginContext, organization?: string) {
		const branding = await ZitadelAPI.getBrandingSettings({
			serviceConfig: ctx.serviceConfig,
			organization,
		});
		return LoginDTO.branding(branding);
	}
}
