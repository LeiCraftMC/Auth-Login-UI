/**
 * The branding (label policy) of the page that is shown: every page loads it with its data and
 * hands it over through `<LoginCard>`; the layout applies it (useBrandingTheme) and keeps it
 * while the next page loads, so the theme doesn't flicker between login steps.
 */
import { ModifiableAbstractStore } from "~/utils/abstractStore";
import type { LoginBranding } from "~/utils/loginTypes";

class BrandingStore extends ModifiableAbstractStore<LoginBranding> {
	constructor() {
		super("lcmc_auth_login_branding");
	}

	/** Nothing to fetch: the branding comes with the page data. */
	protected async fetchData(): Promise<LoginBranding | null> {
		return this.useRaw().value;
	}

	/** Reactive view of the current branding (null until a page loaded one). */
	get data(): Readonly<Ref<LoginBranding | null>> {
		return this.useRaw();
	}

	async update(branding: LoginBranding) {
		this.useRaw().value = branding;
	}
}

export function useBrandingStore() {
	return new BrandingStore();
}
