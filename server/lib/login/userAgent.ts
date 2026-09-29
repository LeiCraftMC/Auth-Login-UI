/**
 * User agent helpers (Zitadel login: `getUserAgent` in `lib/fingerprint.ts` and the passkey/U2F
 * name derivation). Uses ua-parser-js, the parser behind Next's `userAgent()`.
 */
import { create } from "@bufbuild/protobuf";
import UAParser from "ua-parser-js";
import { type UserAgent, UserAgentSchema } from "../zitadel/proto/zitadel/session/v2/session_pb";
import type { LoginContext } from "./context";
import { LoginCookies } from "./cookies";

export class LoginUserAgent {
	static parse(ctx: LoginContext) {
		return new UAParser(ctx.header("user-agent") ?? "").getResult();
	}

	/** The `UserAgent` attached to every session Zitadel creates for this browser. */
	static forSession(ctx: LoginContext): UserAgent {
		const fingerprintId = LoginCookies.getOrSetFingerprintId(ctx);
		const { device, engine, os, browser } = LoginUserAgent.parse(ctx);
		const userAgentHeaderValues = ctx.header("user-agent")?.split(",");

		const deviceDescription = `${device?.type ? `${device.type},` : ""} ${device?.vendor ? `${device.vendor},` : ""} ${device?.model ? `${device.model},` : ""} `;
		const osDescription = `${os?.name ? `${os.name},` : ""} ${os?.version ? `${os.version},` : ""} `;
		const engineDescription = `${engine?.name ? `${engine.name},` : ""} ${engine?.version ? `${engine.version},` : ""} `;
		const browserDescription = `${browser?.name ? `${browser.name},` : ""} ${browser?.version ? `${browser.version},` : ""} `;

		return create(UserAgentSchema, {
			ip: ctx.header("x-forwarded-for") ?? ctx.header("remoteAddress") ?? "",
			header: { "user-agent": { values: userAgentHeaderValues } },
			description: `${browserDescription}, ${deviceDescription}, ${engineDescription}, ${osDescription}`,
			fingerprintId,
		});
	}

	/** Default name of a new passkey / security key, e.g. "Apple Macintosh, Mac OS, Safari". */
	static authenticatorName(ctx: LoginContext): string {
		const { browser, device, os } = LoginUserAgent.parse(ctx);
		return `${device.vendor ?? ""} ${device.model ?? ""}${
			device.vendor || device.model ? ", " : ""
		}${os.name}${os.name ? ", " : ""}${browser.name}`;
	}
}
