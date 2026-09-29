/**
 * useBrandingTheme — applies the Zitadel branding of the instance / organization to the
 * LeiCraftMC design: a customized primary color replaces NuxtUI's `--ui-primary` (with a
 * readable `--login-on-primary` for text on it, see app.config.ts). The layout stays dark-only.
 */
import type { MaybeRefOrGetter } from "vue";
import type { LoginBranding } from "~/utils/loginTypes";

export function useBrandingTheme(branding: MaybeRefOrGetter<LoginBranding | null | undefined>) {
	watchEffect(() => {
		if (!import.meta.client) return;

		const style = document.documentElement.style;
		const primaryColor = toValue(branding)?.primaryColor;

		if (primaryColor) {
			style.setProperty("--ui-primary", primaryColor);
			style.setProperty("--login-on-primary", contrastTextColor(primaryColor));
		} else if (toValue(branding) !== undefined) {
			// loaded without a custom color: back to the LeiCraftMC primary
			style.removeProperty("--ui-primary");
			style.removeProperty("--login-on-primary");
		}
	});
}
