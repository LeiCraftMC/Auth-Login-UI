/**
 * Identity provider type mapping (Zitadel login: `lib/idp.ts`). The slug is part of the IdP
 * callback URLs (`/idp/<slug>/process`, `/idp/<slug>/failure`), so it must stay identical.
 */
import { IDPType } from "../zitadel/proto/zitadel/idp/v2/idp_pb";
import { IdentityProviderType } from "../zitadel/proto/zitadel/settings/v2/login_settings_pb";

export type IdpSlug =
	| "github"
	| "github_es"
	| "gitlab"
	| "gitlab_es"
	| "apple"
	| "google"
	| "azure"
	| "saml"
	| "oauth"
	| "oidc"
	| "ldap"
	| "jwt"
	| "zitadel";

export const IDP_SLUGS = [
	"github",
	"github_es",
	"gitlab",
	"gitlab_es",
	"apple",
	"google",
	"azure",
	"saml",
	"oauth",
	"oidc",
	"ldap",
	"jwt",
	"zitadel",
] as const satisfies readonly IdpSlug[];

export class IdpTypes {
	static toSlug(idpType: IdentityProviderType): IdpSlug {
		switch (idpType) {
			case IdentityProviderType.GITHUB:
				return "github";
			case IdentityProviderType.GITHUB_ES:
				return "github_es";
			case IdentityProviderType.GITLAB:
				return "gitlab";
			case IdentityProviderType.GITLAB_SELF_HOSTED:
				return "gitlab_es";
			case IdentityProviderType.APPLE:
				return "apple";
			case IdentityProviderType.GOOGLE:
				return "google";
			case IdentityProviderType.AZURE_AD:
				return "azure";
			case IdentityProviderType.SAML:
				return "saml";
			case IdentityProviderType.OAUTH:
				return "oauth";
			case IdentityProviderType.OIDC:
				return "oidc";
			case IdentityProviderType.LDAP:
				return "ldap";
			case IdentityProviderType.JWT:
				return "jwt";
			case IdentityProviderType.ZITADEL:
				return "zitadel";
			default:
				throw new Error("Unknown identity provider type");
		}
	}

	/** `getIDPByID` returns an `IDPType`, the settings an `IdentityProviderType`. */
	static fromIdpType(idpType: IDPType): IdentityProviderType {
		switch (idpType) {
			case IDPType.IDP_TYPE_GITHUB:
				return IdentityProviderType.GITHUB;
			case IDPType.IDP_TYPE_GITHUB_ES:
				return IdentityProviderType.GITHUB_ES;
			case IDPType.IDP_TYPE_GITLAB:
				return IdentityProviderType.GITLAB;
			case IDPType.IDP_TYPE_GITLAB_SELF_HOSTED:
				return IdentityProviderType.GITLAB_SELF_HOSTED;
			case IDPType.IDP_TYPE_APPLE:
				return IdentityProviderType.APPLE;
			case IDPType.IDP_TYPE_GOOGLE:
				return IdentityProviderType.GOOGLE;
			case IDPType.IDP_TYPE_AZURE_AD:
				return IdentityProviderType.AZURE_AD;
			case IDPType.IDP_TYPE_SAML:
				return IdentityProviderType.SAML;
			case IDPType.IDP_TYPE_OAUTH:
				return IdentityProviderType.OAUTH;
			case IDPType.IDP_TYPE_OIDC:
				return IdentityProviderType.OIDC;
			case IDPType.IDP_TYPE_JWT:
				return IdentityProviderType.JWT;
			case IDPType.IDP_TYPE_ZITADEL:
				return IdentityProviderType.ZITADEL;
			default:
				throw new Error("Unknown identity provider type");
		}
	}
}
