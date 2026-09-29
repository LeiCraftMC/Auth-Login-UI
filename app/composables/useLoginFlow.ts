/**
 * useLoginFlow — runs a login step and follows its result (Zitadel login:
 * `handleServerActionResponse`). A step answers with `{ redirect }` (a login page, a server route
 * such as `/login`, or an external URL like an OIDC callback), `{ samlData }` (POSTed by
 * `<LoginAutoSubmitForm>`), or an error message shown by `<LoginFlowState>`.
 */
import type { LoginFlowStep, LoginSamlData } from "~/utils/loginTypes";

/** Paths answered by Nitro (server/lib/protocol), not by a page — they need a full navigation. */
const SERVER_ROUTE_PREFIXES = [
	"/.well-known/",
	"/oauth/",
	"/oidc/",
	"/idps/callback/",
	"/saml/",
	"/assets/",
];

function isServerRoute(path: string) {
	const pathname = path.split(/[?#]/)[0] ?? path;
	return (
		pathname === "/login" || SERVER_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
	);
}

type StepResult<T> = { success: true; data: T } | { success: false; message: string };

export function useLoginFlow() {
	const { baseURL } = useRuntimeAppConfigs();

	const error = ref("");
	const samlData = ref<LoginSamlData | null>(null);
	const loading = ref(false);

	/** Leaves the page for `target`; returns false (and shows an error) for an unsafe target. */
	async function navigate(target: string): Promise<boolean> {
		if (!isSafeRedirectUri(target)) {
			console.warn("Blocked unsafe redirect URI:", target);
			error.value = "Unsafe redirect URI was blocked";
			return false;
		}

		if (isExternalUrl(target)) {
			// validated above: no javascript:, data:, file:, blob: or about: URLs
			window.location.href = target;
		} else if (isServerRoute(target)) {
			window.location.href = `${baseURL}${target}`;
		} else {
			await navigateTo(target);
		}
		return true;
	}

	/** Follows a flow step; true when the page is being left. */
	async function follow(step: LoginFlowStep | null | undefined): Promise<boolean> {
		if (step?.redirect) {
			return navigate(step.redirect);
		}
		if (step?.samlData) {
			if (!isSafeRedirectUri(step.samlData.url)) {
				console.warn("Blocked unsafe SAML post URL:", step.samlData.url);
				error.value = "Unsafe redirect URI was blocked";
				return false;
			}
			samlData.value = step.samlData;
			return true;
		}
		return false;
	}

	/**
	 * Runs `request` with the loading state; a failed request shows its message. Returns the
	 * response data (after following it when `follow` is set), or null on failure.
	 */
	async function run<T>(
		request: () => Promise<StepResult<T>>,
		options: { follow?: boolean } = { follow: true },
	): Promise<T | null> {
		loading.value = true;
		error.value = "";
		try {
			const result = await request();
			if (!result.success) {
				error.value = result.message;
				return null;
			}
			if (options.follow !== false) {
				await follow(result.data as LoginFlowStep);
			}
			return result.data;
		} finally {
			loading.value = false;
		}
	}

	return { error, samlData, loading, run, follow, navigate };
}
