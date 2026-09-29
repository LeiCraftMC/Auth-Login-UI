import { type ConnectRouter, createRouterTransport } from "@connectrpc/connect";
import { ZitadelAPI } from "../../server/lib/zitadel/api";
import { type ServiceConfig, ZitadelClient } from "../../server/lib/zitadel/client";
import { OrganizationService } from "../../server/lib/zitadel/proto/zitadel/org/v2/org_service_pb";
import { SettingsService } from "../../server/lib/zitadel/proto/zitadel/settings/v2/settings_service_pb";

/**
 * Routes every Zitadel call of the login to an in-memory Connect router. Services and methods
 * that a test does not implement answer with `Code.Unimplemented`. Returns the service configs
 * the calls were made with (instance / public host routing).
 */
export function mockZitadel(routes: (router: ConnectRouter) => void) {
	const calls: ServiceConfig[] = [];

	ZitadelAPI.resetCache();
	ZitadelClient.setTransportFactory((_token, serviceConfig) => {
		calls.push(serviceConfig);
		return createRouterTransport(routes);
	});

	return { calls };
}

export function resetZitadelMock() {
	ZitadelAPI.resetCache();
	ZitadelClient.setTransportFactory(null);
}

/** Instance settings most pages load: local login allowed, default organization `default-org`. */
export function defaultInstanceRoutes(
	router: ConnectRouter,
	overrides: { loginSettings?: Record<string, unknown> } = {},
) {
	router.service(SettingsService, {
		getLoginSettings: () => ({
			settings: {
				allowLocalAuthentication: true,
				allowRegister: true,
				allowExternalIdp: true,
				...overrides.loginSettings,
			},
		}),
		getBrandingSettings: () => ({
			settings: { darkTheme: { primaryColor: "#2073c4", logoUrl: "https://assets.test/logo.png" } },
		}),
		getActiveIdentityProviders: () => ({ identityProviders: [] }),
		getGeneralSettings: () => ({ defaultLanguage: "en", allowedLanguages: ["en", "de"] }),
		getHostedLoginTranslation: () => ({}),
		getSecuritySettings: () => ({ settings: {} }),
	});
	router.service(OrganizationService, {
		listOrganizations: () => ({ result: [{ id: "default-org", name: "Default" }] }),
	});
}
