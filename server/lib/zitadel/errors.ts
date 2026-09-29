/**
 * Error classification for Zitadel RPC errors (port of the Zitadel login's
 * `lib/grpc/interceptors/error-classification.ts`).
 *
 * Every `ConnectError` thrown by a service call through {@link ZitadelClient} is re-thrown as a
 * {@link ClassifiedConnectError}, which carries the HTTP equivalent of the gRPC code and whether
 * it is a user error (4xx) or a server failure (5xx).
 */
import { Code, ConnectError, type Interceptor } from "@connectrpc/connect";

/** Unique brand symbol for ClassifiedConnectError type guard detection */
const CLASSIFIED_BRAND = Symbol.for("ClassifiedConnectError");

/** Canonical gRPC → HTTP status code mapping */
const GRPC_TO_HTTP: Readonly<Record<number, number>> = {
	[Code.InvalidArgument]: 400,
	[Code.FailedPrecondition]: 400,
	[Code.OutOfRange]: 400,
	[Code.Unauthenticated]: 401,
	[Code.PermissionDenied]: 403,
	[Code.NotFound]: 404,
	[Code.AlreadyExists]: 409,
	[Code.Aborted]: 409,
	[Code.ResourceExhausted]: 429,
	[Code.Canceled]: 499,
	[Code.Unimplemented]: 501,
	[Code.Unavailable]: 503,
	[Code.DeadlineExceeded]: 504,
	[Code.DataLoss]: 500,
	[Code.Internal]: 500,
	[Code.Unknown]: 500,
};

/** gRPC codes that represent user input errors (not genuine server failures) */
const CLIENT_ERROR_CODES: ReadonlySet<Code> = new Set([
	Code.InvalidArgument,
	Code.FailedPrecondition,
	Code.OutOfRange,
	Code.Unauthenticated,
	Code.PermissionDenied,
	Code.NotFound,
	Code.AlreadyExists,
	Code.Aborted,
	Code.ResourceExhausted,
	Code.Canceled,
]);

export class ClassifiedConnectError extends ConnectError {
	/** The equivalent HTTP status code for this gRPC error */
	readonly httpStatus: number;

	/** Whether this error represents a user input error (true) or a server failure (false) */
	readonly isUserError: boolean;

	readonly [CLASSIFIED_BRAND] = true as const;

	constructor(source: ConnectError) {
		super(source.rawMessage, source.code, source.metadata, undefined, source.cause);
		// Keep the name so ConnectError's duck-typed `instanceof` keeps working.
		this.name = "ConnectError";
		if (source.stack) {
			this.stack = source.stack;
		}
		this.httpStatus = GRPC_TO_HTTP[source.code] ?? 500;
		this.isUserError = CLIENT_ERROR_CODES.has(source.code);

		if (source.details.length > 0) {
			Object.defineProperty(this, "details", { value: source.details, writable: false });
		}
	}
}

export function isClassifiedError(error: unknown): error is ClassifiedConnectError {
	return error !== null && typeof error === "object" && CLASSIFIED_BRAND in error;
}

export function grpcCodeToHttpStatus(code: Code): number {
	return GRPC_TO_HTTP[code] ?? 500;
}

/** Transport interceptor that re-throws every `ConnectError` as a `ClassifiedConnectError`. */
export const errorClassificationInterceptor: Interceptor = (next) =>
	async function classifiedCall(req) {
		try {
			return await next(req);
		} catch (err) {
			if (err instanceof ConnectError) {
				throw new ClassifiedConnectError(err);
			}
			throw err;
		}
	};
