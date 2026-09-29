/**
 * ZitadelClient — creates typed Connect clients for the Zitadel v2 services.
 *
 * Every call carries the system-user JWT and the host headers that select the (virtual) instance:
 * `x-zitadel-instance-host` (instance routing) and `x-zitadel-public-host` (the host the user
 * sees — used by Zitadel for issuer/redirect URLs). Mirrors `createServerTransport` /
 * `createServiceForHost` of the Zitadel login, using the fetch-based Connect transport (binary
 * protobuf) so it runs natively on Bun.
 */
import type { DescService } from "@bufbuild/protobuf";
import { type Client, createClient, type Interceptor, type Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";
import { errorClassificationInterceptor } from "./errors";
import { ZitadelSystemToken } from "./systemToken";

export interface ServiceConfig {
	baseUrl: string;
	/** Host of the (virtual) instance the request is for. */
	instanceHost?: string;
	/** Host the user sees in the browser. */
	publicHost?: string;
}

/** Base type for all Zitadel API wrappers: `serviceConfig` is always required. */
export type WithServiceConfig<T = {}> = T & { serviceConfig: ServiceConfig };

export namespace ZitadelClient {
	export type TransportFactory = (token: string, serviceConfig: ServiceConfig) => Transport;
}

export class ZitadelClient {
	private static transportFactory: ZitadelClient.TransportFactory | null = null;

	/** Tests inject an in-memory transport (`createRouterTransport`) here. */
	static setTransportFactory(factory: ZitadelClient.TransportFactory | null) {
		ZitadelClient.transportFactory = factory;
	}

	/**
	 * Applies `CUSTOM_REQUEST_HEADERS` ("key:value" pairs, comma-separated; an empty value removes
	 * the header) — e.g. `Host:zitadel-internal:8080` to reach Zitadel on an internal address.
	 */
	static applyCustomHeaders(actions: {
		set: (key: string, value: string) => void;
		remove: (key: string) => void;
	}) {
		const raw = ConfigHandler.getConfig()?.CUSTOM_REQUEST_HEADERS;
		if (!raw) return;

		for (const header of raw.split(",")) {
			const separator = header.indexOf(":");
			if (separator > 0) {
				const key = header.slice(0, separator).trim();
				const value = header.slice(separator + 1).trim();
				if (value) actions.set(key, value);
				else actions.remove(key);
			} else if (header.trim()) {
				Logger.warn("Skipping malformed CUSTOM_REQUEST_HEADERS entry:", header);
			}
		}
	}

	static createTransport(token: string, serviceConfig: ServiceConfig): Transport {
		if (ZitadelClient.transportFactory) {
			return ZitadelClient.transportFactory(token, serviceConfig);
		}

		const authorizationInterceptor: Interceptor = (next) => (req) => {
			if (!req.header.get("Authorization")) {
				req.header.set("Authorization", `Bearer ${token}`);
			}
			return next(req);
		};

		const headerInterceptor: Interceptor = (next) => (req) => {
			if (serviceConfig.instanceHost) {
				req.header.set("x-zitadel-instance-host", serviceConfig.instanceHost);
			}
			if (serviceConfig.publicHost) {
				req.header.set("x-zitadel-public-host", serviceConfig.publicHost);
			}
			ZitadelClient.applyCustomHeaders({
				set: (key, value) => req.header.set(key, value),
				remove: (key) => req.header.delete(key),
			});
			return next(req);
		};

		return createConnectTransport({
			baseUrl: serviceConfig.baseUrl,
			useBinaryFormat: true,
			interceptors: [errorClassificationInterceptor, authorizationInterceptor, headerInterceptor],
		});
	}

	/** A client for `service`, authenticated as the system user, scoped to the request's instance. */
	static async service<T extends DescService>(
		service: T,
		serviceConfig: ServiceConfig,
	): Promise<Client<T>> {
		const token = await ZitadelSystemToken.get();
		return createClient(service, ZitadelClient.createTransport(token, serviceConfig));
	}

	/**
	 * A client that authenticates with a user's session token instead of the system user
	 * (the Zitadel login's `self.ts`, e.g. for users setting their own password).
	 */
	static serviceWithToken<T extends DescService>(
		service: T,
		serviceConfig: ServiceConfig,
		token: string,
	): Client<T> {
		return createClient(service, ZitadelClient.createTransport(token, serviceConfig));
	}
}
