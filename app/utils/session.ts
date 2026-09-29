import type { LoginSession } from "./loginTypes";

/**
 * Whether a session has a verified primary factor (password, passkey or IdP) and has not expired,
 * and when that factor was verified (Zitadel login: `isSessionPrimaryFactorAndLifetimeValid`).
 */
export function sessionPrimaryFactorState(session: LoginSession): {
	valid: boolean;
	verifiedAt?: number;
} {
	const verifiedAt =
		session.factors?.password?.verifiedAt ||
		session.factors?.webAuthN?.verifiedAt ||
		session.factors?.intent?.verifiedAt;

	const stillValid = session.expirationDate ? session.expirationDate > Date.now() : true;

	return { valid: !!verifiedAt && stillValid, verifiedAt };
}

/** Most recently changed first, sessions without a login name dropped. */
export function sortSessions(sessions: LoginSession[]) {
	return sessions
		.filter((session) => session.factors?.user?.loginName)
		.sort((a, b) => (b.changeDate ?? 0) - (a.changeDate ?? 0));
}
