/** Password policy checks (Zitadel login: `helpers/validators.ts`). */
export function passwordHasSymbol(value: string): boolean {
	return /[^a-zA-Z0-9]/.test(value);
}

export function passwordHasNumber(value: string): boolean {
	return /[0-9]/.test(value);
}

export function passwordHasUppercase(value: string): boolean {
	return /[A-Z]/.test(value);
}

export function passwordHasLowercase(value: string): boolean {
	return /[a-z]/.test(value);
}

/** Whether a password satisfies every rule of the policy (the submit buttons wait for it). */
export function passwordMatchesComplexity(
	password: string,
	settings: {
		minLength: number;
		requiresSymbol: boolean;
		requiresNumber: boolean;
		requiresUppercase: boolean;
		requiresLowercase: boolean;
	},
) {
	return (
		password.length >= settings.minLength &&
		(!settings.requiresSymbol || passwordHasSymbol(password)) &&
		(!settings.requiresNumber || passwordHasNumber(password)) &&
		(!settings.requiresUppercase || passwordHasUppercase(password)) &&
		(!settings.requiresLowercase || passwordHasLowercase(password))
	);
}
