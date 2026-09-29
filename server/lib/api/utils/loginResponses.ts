/**
 * Envelope helpers for login steps: a {@link FlowResult} becomes `200 { redirect | samlData }`
 * (or `{}` = nothing to do), a flow error becomes `400` with the user-facing (translated) message.
 */
import type { Context } from "hono";
import type { FlowResult } from "../../login/types";
import { APIResponse } from "./api-res";
import type { LoginModels } from "./shared-models/loginModels";

export class LoginResponses {
	static flow<Message extends string>(c: Context, message: Message, result: FlowResult | undefined) {
		if (result && "error" in result) {
			return APIResponse.badRequest(c, result.error);
		}

		const data: LoginModels.FlowStep = {};
		if (result && "redirect" in result) data.redirect = result.redirect;
		if (result && "samlData" in result) data.samlData = result.samlData;

		return APIResponse.success(c, message, data);
	}

	/** `{ error? }` results of actions without a next step. */
	static done<Message extends string>(
		c: Context,
		message: Message,
		result: { error?: string } | undefined,
	) {
		if (result?.error) {
			return APIResponse.badRequest(c, result.error);
		}
		return APIResponse.successNoData(c, message);
	}
}
