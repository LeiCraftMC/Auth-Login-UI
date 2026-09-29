/**
 * The resolved translations of the current request: locale (`NEXT_LOCALE` cookie → Accept-Language
 * → instance default), the allowed languages and the messages with the Zitadel custom texts of
 * the organization applied. Loaded by the layout, refreshed when the language or the
 * `?organization=` of the page changes.
 */
import { BasicAbstractStoreWithMetadata } from "~/utils/abstractStore";
import type { LoginI18n } from "~/utils/loginTypes";

type I18nMetadata = { organization?: string };

class I18nStore extends BasicAbstractStoreWithMetadata<LoginI18n, I18nMetadata> {
	constructor() {
		super("lcmc_auth_login_i18n", { enableAutoFetchIfEmpty: true, defaultMetadata: {} });
	}

	protected async fetchData(): Promise<LoginI18n | null> {
		const organization = this.useMetadataRaw().value.organization;
		const result = await useAPI((api) => api.getSettingsI18N({ query: { organization } }));
		return result.success ? result.data : null;
	}

	/** Reactive view of the loaded translations (null until loaded). */
	get data(): Readonly<Ref<LoginI18n | null>> {
		return this.useRaw();
	}

	/** Loads the texts of another organization (custom texts), if it changed. */
	async setOrganization(organization: string | undefined) {
		const metadata = this.useMetadataRaw();
		if (metadata.value.organization === organization && this.isValid(this.useRaw())) return;
		metadata.value = { organization };
		await this.refresh();
	}

	/** Stores the language in the `NEXT_LOCALE` cookie and reloads the messages. */
	async setLanguage(language: string) {
		const result = await useAPI((api) => api.putSettingsLanguage({ body: { language } }));
		if (result.success) {
			await this.refresh();
		}
		return result;
	}
}

export function useI18nStore() {
	return new I18nStore();
}
